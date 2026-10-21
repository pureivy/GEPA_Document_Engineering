/**
 * 한글(한컴오피스) 자동화로 쪽을 그리고 쪽별 글을 읽는다 — 미리보기를 내려받는 파일과 똑같이 보이게.
 *
 * rhwp(미리보기 엔진)는 한글과 배치가 다르다: 작은 문단 위 간격(5pt 등)을 버리고, 쪽 맨 위 문단의 위 간격을 빼고,
 * 글자 폭도 조금 다르다. 그래서 미리보기에는 2쪽에 들어간 "※ 근거" 가 한글에서는 3쪽으로 넘어갔다(담당자 2026-10-13).
 * 이 PC 처럼 한글이 깔린 Windows 에서는 한글이 직접 그린 쪽 그림을 미리보기로 쓰고, 쪽 수·쪽별 글도 한글에서 읽는다.
 * 한글이 없으면(다른 OS·미설치) undefined 를 돌려주고 호출하는 쪽이 rhwp 로 떨어진다.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeSync } from "../fsSafe";

export interface HangulLayout {
  /** 쪽마다 PNG */
  pngs: Uint8Array[];
  /** 쪽마다 한글이 읽어 준 글(표 안 글은 빠진다) */
  texts: string[];
}

const SCRIPT = String.raw`param([string]$src, [string]$out, [int]$dpi, [int]$images)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$before = @(Get-Process Hwp -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$h = New-Object -ComObject HWPFrame.HwpObject
# the automation hwp.exe this script started - written first so the caller can kill it if we are cut off
$mine = @(Get-CimInstance Win32_Process -Filter "Name='Hwp.exe'" | Where-Object { $before -notcontains $_.ProcessId -and $_.CommandLine -match '-Automation' } | ForEach-Object { $_.ProcessId })
[IO.File]::WriteAllText((Join-Path $out "pid.txt"), ($mine -join ","))
try {
  try { $h.XHwpWindows.Item(0).Visible = $false } catch {}
  $h.SetMessageBoxMode(0x00010000) | Out-Null
  if (-not $h.Open($src, "HWPX", "forceopen:true")) { throw "open failed" }
  $n = $h.PageCount
  for ($i = 0; $i -lt $n; $i++) {
    [IO.File]::WriteAllText((Join-Path $out ("text-{0}.txt" -f $i)), [string]$h.GetPageText($i, 0), [Text.Encoding]::UTF8)
    if ($images -eq 1) {
      $bmp = Join-Path $out ("page-{0}.bmp" -f $i)
      $null = $h.CreatePageImage($bmp, $i, $dpi, 24, "bmp")
      $img = [System.Drawing.Image]::FromFile($bmp)
      $img.Save((Join-Path $out ("page-{0}.png" -f $i)), [System.Drawing.Imaging.ImageFormat]::Png)
      $img.Dispose(); Remove-Item $bmp
    }
  }
  [IO.File]::WriteAllText((Join-Path $out "pages.txt"), [string]$n)
} finally {
  try { $h.Clear(1) } catch {}
  try { $h.Quit() } catch {}
  Start-Sleep -Milliseconds 500
  foreach ($p in $mine) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
}
`;

/**
 * 스크립트가 띄운 한글을 끝낸다. 시간 초과로 PowerShell 이 끊기면 finally 의 Quit 이 돌지 않아 한글이 남는다 —
 * 화면에 빈 까만 창이 뜨고, 보이지 않는 hwp.exe 가 하나에 70MB 씩 쌓였다(담당자 2026-10-21, 5개).
 */
function killHangul(out: string): void {
  const f = join(out, "pid.txt");
  if (!existsSync(f)) return;
  for (const pid of readFileSync(f, "utf8").split(",").map(Number).filter((n) => n > 0)) {
    try {
      process.kill(pid);
    } catch {
      /* 이미 끝남 */
    }
  }
}

let available: boolean | undefined;
/** 한글 자동화 개체가 등록돼 있는지(HKCR\HWPFrame.HwpObject) — 한 번만 본다. GEPA_NO_HANGUL=1 이면 끈다 */
export function hangulAvailable(): boolean {
  if (available !== undefined) return available;
  if (process.platform !== "win32" || process.env.GEPA_NO_HANGUL === "1") return (available = false);
  try {
    execFileSync("reg", ["query", "HKCR\\HWPFrame.HwpObject"], { stdio: "ignore", windowsHide: true });
    available = true;
  } catch {
    available = false;
  }
  return available;
}

// 한글은 한 번에 하나씩 — 동시에 여러 개를 띄우면 느려지고 서로 막는다
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** 한글로 열어 쪽 글(과 images 면 쪽 그림)을 얻는다. 실패하면 undefined */
export function hangulLayout(bytes: Uint8Array, opts: { images?: boolean; dpi?: number; timeoutMs?: number } = {}): Promise<HangulLayout | undefined> {
  if (!hangulAvailable()) return Promise.resolve(undefined);
  return serial(async () => {
    const dir = mkdtempSync(join(tmpdir(), "gepa-hwp-"));
    try {
      const src = join(dir, "doc.hwpx");
      const out = join(dir, "out");
      mkdirSync(out);
      writeFileSync(src, bytes);
      const ps1 = join(dir, "render.ps1");
      // PowerShell 5.1 은 BOM 없는 UTF-8 스크립트를 ANSI 로 읽는다 — 스크립트에는 ASCII 만 둔다
      writeFileSync(ps1, SCRIPT, "utf8");
      await new Promise<void>((resolve, reject) => {
        execFile(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1, src, out, String(opts.dpi ?? 96), opts.images ? "1" : "0"],
          { timeout: opts.timeoutMs ?? 90_000, windowsHide: true },
          (err, _stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 300))) : resolve()),
        );
      });
      if (!existsSync(join(out, "pages.txt"))) return undefined;
      const n = Number(readFileSync(join(out, "pages.txt"), "utf8").trim());
      if (!(n > 0)) return undefined;
      const texts: string[] = [];
      const pngs: Uint8Array[] = [];
      for (let i = 0; i < n; i++) {
        texts.push(readFileSync(join(out, `text-${i}.txt`), "utf8").replace(/^﻿/, ""));
        if (opts.images) pngs.push(new Uint8Array(readFileSync(join(out, `page-${i}.png`))));
      }
      return { pngs, texts };
    } catch {
      return undefined;
    } finally {
      killHangul(join(dir, "out"));
      removeSync(dir);
    }
  });
}

/** 한글 쪽 그림을 미리보기 SVG 로 감싼다(A4 등 쪽 크기는 그림 비율 그대로) */
export function pngPageSvg(png: Uint8Array): string {
  // PNG IHDR: 가로·세로(빅엔디안) 16~23 바이트
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const w = dv.getUint32(16), h = dv.getUint32(20);
  const b64 = Buffer.from(png).toString("base64");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" xlink:href="data:image/png;base64,${b64}" href="data:image/png;base64,${b64}"/></svg>`;
}
