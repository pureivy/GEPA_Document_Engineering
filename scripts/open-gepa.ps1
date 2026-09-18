<#
  GEPA 문서 엔지니어링 - 바로 열기.

  1) 서버가 살아 있는지 "포트"가 아니라 "HTTP 응답"으로 확인한다.
     메모리 부족으로 렌더 워커가 죽으면 포트는 열려 있는데 500만 뱉는 상태가 되는데,
     포트만 보면 멀쩡하다고 착각하게 된다.
  2) 죽어 있거나 먹통이면 정리하고 새로 띄운다.
  3) 크롬으로 연다(없으면 기본 브라우저).

  포트는 GEPA_PORT 환경변수로 바꿀 수 있다(기본 3117).
#>
$ErrorActionPreference = "Stop"

$proj = Split-Path -Parent $PSScriptRoot
$port = if ($env:GEPA_PORT) { $env:GEPA_PORT } else { "3117" }
$url  = "http://localhost:$port"

function Show-Msg($text) {
    [void][Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")
    [void][Windows.Forms.MessageBox]::Show($text, "GEPA 문서 엔지니어링")
}

function Get-PortOwners {
    netstat -ano | Select-String ":$port\s.*LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
}

# 포트가 아니라 실제 응답으로 판정한다.
function Test-ServerHealthy {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
    } catch { return $false }
}

function Open-Browser {
    $chrome = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($chrome) { Start-Process $chrome $url } else { Start-Process $url }
}

if (Test-ServerHealthy) { Open-Browser; exit 0 }

# 포트는 잡고 있는데 응답이 없다 = 먹통. 치우고 새로 띄운다.
$stale = Get-PortOwners
if ($stale) {
    foreach ($p in $stale) {
        $parent = (Get-CimInstance Win32_Process -Filter "ProcessId = $p" -ErrorAction SilentlyContinue).ParentProcessId
        try { Stop-Process -Id $p -Force -ErrorAction Stop } catch {}
        if ($parent) { try { Stop-Process -Id $parent -Force -ErrorAction Stop } catch {} }
    }
    Start-Sleep -Seconds 3
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Show-Msg "pnpm 을 찾을 수 없습니다. Node 와 pnpm 설치를 확인하세요."
    exit 1
}

$env:PORT = $port
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "title GEPA dev server && pnpm dev" -WorkingDirectory $proj -WindowStyle Minimized

for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if (Test-ServerHealthy) { Open-Browser; exit 0 }
}

Show-Msg "서버가 90초 안에 응답하지 않았습니다.`n작업표시줄의 최소화된 'GEPA dev server' 창에서 오류를 확인하세요.`n메모리가 부족하면 크롬 탭을 줄인 뒤 다시 시도하세요."
exit 1
