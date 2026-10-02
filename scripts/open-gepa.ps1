<#
  GEPA 문서 엔지니어링 - 바로 열기.

  - 서버 생존은 "포트 열림"이 아니라 "HTTP 응답"으로 판정한다.
  - 뜨는 중일 수 있으니 바로 죽이지 않고 먼저 기다려 본다.
  - 무슨 일이 있었는지 로그로 남긴다(창이 번쩍이고 사라져도 원인을 알 수 있게).
  - 크롬으로 연다.

  포트: GEPA_PORT (기본 3117)
  로그: %LOCALAPPDATA%\GEPA\launcher.log , 서버 출력은 server.log
#>
$ErrorActionPreference = "Continue"

$proj    = Split-Path -Parent $PSScriptRoot
$port    = if ($env:GEPA_PORT) { $env:GEPA_PORT } else { "3117" }
$url     = "http://localhost:$port"
$logDir  = Join-Path $env:LOCALAPPDATA "GEPA"
$log     = Join-Path $logDir "launcher.log"
$srvLog  = Join-Path $logDir "server.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Say($m) {
    $line = "{0}  {1}" -f (Get-Date -Format "HH:mm:ss"), $m
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

function Show-Msg($text) {
    [void][Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")
    [void][Windows.Forms.MessageBox]::Show($text, "GEPA 문서 엔지니어링")
}

# 서버가 "살아 있다"의 기준: 홈 화면이 아니라 렌더 워커가 필요한 페이지까지 떠야 한다.
# 메모리가 부족하면 워커만 죽어서, 홈은 200 인데 프로젝트 페이지는 500 이 되는 상태가 생긴다.
function Test-Healthy {
    try {
        $rootPage = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        if ($rootPage.StatusCode -lt 200 -or $rootPage.StatusCode -ge 400) { return $false }
    } catch { return $false }

    # 프로젝트가 하나라도 있으면 그 페이지까지 확인한다.
    try {
        $list = Invoke-RestMethod -Uri "$url/api/projects" -TimeoutSec 10 -ErrorAction Stop
        $id = @($list.projects)[0].id
        if (-not $id) { return $true }   # 프로젝트가 없으면 홈만으로 판정
        $page = Invoke-WebRequest -Uri "$url/projects/$id" -UseBasicParsing -TimeoutSec 25 -ErrorAction Stop
        return ($page.StatusCode -ge 200 -and $page.StatusCode -lt 400)
    } catch {
        Say "  홈은 뜨는데 프로젝트 페이지가 실패 - 렌더 워커가 죽은 상태로 판단"
        return $false
    }
}

function Get-PortOwners {
    netstat -ano | Select-String ":$port\s.*LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
}

function Open-Browser {
    $chrome = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($chrome) { Say "크롬으로 엽니다: $chrome"; Start-Process $chrome $url }
    else         { Say "크롬을 못 찾아 기본 브라우저로 엽니다"; Start-Process $url }
}

Say "=== 시작 (port=$port, proj=$proj) ==="

if (Test-Healthy) { Say "서버 정상 - 브라우저만 엽니다"; Open-Browser; exit 0 }

# 포트가 열려 있으면 아직 뜨는 중일 수 있다. 죽이기 전에 기다린다.
$owners = Get-PortOwners
if ($owners) {
    Say "포트는 열려 있으나 응답 없음(owner=$($owners -join ',')). 기동 중일 수 있어 30초 기다립니다."
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Healthy) { Say "응답 시작 - 브라우저를 엽니다"; Open-Browser; exit 0 }
    }
    Say "여전히 무응답 = 먹통으로 판단하고 정리합니다."
    foreach ($p in Get-PortOwners) {
        $parent = (Get-CimInstance Win32_Process -Filter "ProcessId = $p" -ErrorAction SilentlyContinue).ParentProcessId
        try { Stop-Process -Id $p -Force -ErrorAction Stop; Say "  종료 $p" } catch { Say "  종료 실패 $p" }
        if ($parent) { try { Stop-Process -Id $parent -Force -ErrorAction Stop; Say "  부모 종료 $parent" } catch {} }
    }
    Start-Sleep -Seconds 3
}

$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { Say "pnpm 없음"; Show-Msg "pnpm 을 찾을 수 없습니다. Node 와 pnpm 설치를 확인하세요."; exit 1 }
Say "pnpm = $pnpm"

# 운영 모드(next start)로 띄운다. 개발 모드(next dev)는 코드 감시와 렌더 워커 풀 때문에
# 메모리를 7배 넘게 쓰고, 메모리가 모자라면 워커만 죽어 500 만 뱉는 상태가 된다.
# next start 는 미리 빌드된 결과만 서빙하므로 단일 프로세스 100 MB 수준이다.
$buildId = Join-Path $proj ".next\BUILD_ID"
if (-not (Test-Path $buildId)) {
    Say "빌드 결과가 없어 먼저 빌드합니다(몇 분 걸립니다)."
    Show-Msg "처음 실행이라 빌드가 필요합니다.`n최소화된 창에서 진행되며 몇 분 걸립니다.`n끝나면 브라우저가 자동으로 열립니다."
    $b = Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Set-Location '$proj'; pnpm build *>&1 | Tee-Object -FilePath '$srvLog'" `
        -WorkingDirectory $proj -WindowStyle Minimized -Wait -PassThru
    Say "빌드 종료 코드 = $($b.ExitCode)"
    if (-not (Test-Path $buildId)) {
        $tail = if (Test-Path $srvLog) { (Get-Content $srvLog -Tail 15) -join "`n" } else { "(로그 없음)" }
        Show-Msg "빌드에 실패했습니다.`n`n$tail`n`n전체 로그: $srvLog"
        exit 1
    }
}

Remove-Item $srvLog -ErrorAction SilentlyContinue
$inner = "`$env:PORT='$port'; Set-Location '$proj'; pnpm start *>&1 | Tee-Object -FilePath '$srvLog'"
Say "서버를 시작합니다(운영 모드). 출력: $srvLog"
Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command", $inner `
    -WorkingDirectory $proj -WindowStyle Minimized

for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Healthy) { Say "기동 완료 ($i 초)"; Open-Browser; exit 0 }
}

Say "120초 안에 응답 없음 - 실패"
$tail = if (Test-Path $srvLog) { (Get-Content $srvLog -Tail 15) -join "`n" } else { "(server.log 없음)" }
Show-Msg "서버가 120초 안에 응답하지 않았습니다.`n`n서버 출력 마지막 부분:`n$tail`n`n전체 로그: $srvLog"
exit 1
