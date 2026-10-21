/**
 * 스캔 PDF(글자 층이 없는 그림 PDF)를 에이전트가 읽을 수 있게 — 쪽 그림 + 한국어 OCR 글.
 *
 * 지급 공문 붙임(신청서·결과물·영수증), 용역 완료보고서는 대개 종이를 스캔한 PDF라 pdftotext 가 빈 글을 낸다.
 * 에이전트의 Read 는 PDF 를 그림으로 바꾸는 pdftoppm 이 있어야 읽는데 이 PC 에는 없어서, 향토뿌리 성과 분석이
 * 48개(804쪽)를 하나도 열지 못했다 — 우수사례 전후 수치·만족도가 빈 원인(담당자 2026-10-21).
 *   - 쪽 그림: PyMuPDF 로 `materials/pages/<자료이름>/p001.jpg` (회색조 150dpi JPEG)
 *   - 글: Windows 내장 OCR(한국어)로 읽어 `materials/text/<자료이름>.md` — 숫자·고유명사가 틀릴 수 있어 쪽 그림 경로를 함께 적는다
 * 한 쪽에 1초 남짓이라 프로젝트 하나에 십여 분 걸린다. 올릴 때는 뒤에서 돌리고(startScanPending),
 * 정산자료·성과 분석 단계는 시작 전에 끝나기를 기다린다(awaitScans, runIntegration.prepareStage).
 * PyMuPDF·한국어 OCR 이 없으면(다른 OS 등) 아무것도 하지 않는다 — 예전처럼 원본 직접 읽기 안내가 남는다.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeSync } from "../fsSafe";
import { materialsDir, writeMaterialsIndex } from "./materials";

/** 쪽이 아주 많은 PDF(지급 공문 붙임 121쪽 등)도 받되, 끝없이 돌지 않게 */
const MAX_PAGES = 150;
const DPI = 150;

const RENDER_PY = String.raw`import sys, fitz
src, out, dpi, maxp = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
doc = fitz.open(src)
for i in range(min(doc.page_count, maxp)):
    pix = doc[i].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
    pix.save("%s/p%03d.jpg" % (out, i + 1), jpg_quality=70)
print(doc.page_count)
`;

// PowerShell 5.1 은 BOM 없는 UTF-8 스크립트를 ANSI 로 읽는다 — 스크립트에는 ASCII 만 둔다
const OCR_PS1 = String.raw`param([string]$dir, [string]$outFile)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`" + String.raw`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language("ko")))
if ($null -eq $engine) { throw "no korean ocr" }
$sb = New-Object System.Text.StringBuilder
foreach ($f in (Get-ChildItem $dir -Filter *.jpg | Sort-Object Name)) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($f.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    [void]$sb.AppendLine("=== " + $f.BaseName)
    foreach ($l in $res.Lines) { [void]$sb.AppendLine($l.Text) }
  } finally { $stream.Dispose() }
}
[IO.File]::WriteAllText($outFile, $sb.ToString(), [Text.Encoding]::UTF8)
`;

function pythonBin(): string {
  return process.env.GEPA_PYTHON?.trim() || "python";
}

let available: boolean | undefined;
/** PyMuPDF 와 Windows 한국어 OCR 이 있는가 — 한 번만 본다. GEPA_NO_OCR=1 이면 끈다 */
export function scanAvailable(): boolean {
  if (available !== undefined) return available;
  if (process.platform !== "win32" || process.env.GEPA_NO_OCR === "1") return (available = false);
  try {
    execFileSync(pythonBin(), ["-E", "-c", "import fitz"], { stdio: "ignore", windowsHide: true, timeout: 30_000 });
    available = true;
  } catch {
    available = false;
  }
  return available;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim().slice(0, 300))) : resolve(String(stdout)),
    ),
  );
}

export function pagesDirOf(dir: string, name: string): string {
  return join(dir, "pages", name.replace(/\.pdf$/i, ""));
}

/** 글자 층이 없어 원본 직접 읽기로 남은 PDF(아직 OCR 하지 않은 것) */
export function pendingScans(projectId: string): string[] {
  const dir = materialsDir(projectId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /\.pdf$/i.test(n) && !existsSync(join(dir, "text", `${n}.md`)) && !existsSync(join(dir, "text", `${n}.scanfail`)));
}

/** 글자 인식이 아직 남았는가(단계 실행 전에 본다). 도구가 없는 PC 에서는 늘 0 */
export function scanBacklog(projectId: string): { pending: number; running: boolean } {
  if (!scanAvailable()) return { pending: 0, running: false };
  return { pending: pendingScans(projectId).length, running: running.has(projectId) };
}

/** OCR 결과를 에이전트가 읽을 글로 — 쪽마다 그림 경로를 달아 숫자를 그림으로 확인하게 한다 */
export function ocrMarkdown(name: string, ocr: string, pageCount: number, rendered: number): string {
  const rel = `materials/pages/${name.replace(/\.pdf$/i, "")}`;
  const pages = ocr.split(/^=== (p\d{3})\s*$/m);
  const out = [
    `# 자료 — ${name} (스캔 PDF, 글자 인식)`,
    "",
    `> 종이를 스캔한 PDF라 Windows 글자 인식(OCR)으로 옮겼다(${pageCount}쪽${rendered < pageCount ? `, 앞 ${rendered}쪽만` : ""}). 금액·날짜·상호는 틀릴 수 있다 —`,
    `> 보고서에 옮길 수치는 그 쪽 그림(\`${rel}/pNNN.jpg\`)을 Read 로 열어 확인한다. 도장·손글씨 자리의 깨진 글자는 무시한다.`,
    "",
  ];
  for (let i = 1; i < pages.length; i += 2) {
    const body = pages[i + 1].trim();
    out.push(`## ${Number(pages[i].slice(1))}쪽 — \`${rel}/${pages[i]}.jpg\``, "", body || "(글자 없음 — 사진·도장 쪽)", "");
  }
  return out.join("\n");
}

/** PDF 하나: 쪽 그림 → OCR → text/<이름>.md. 실패하면 false(원본 직접 읽기 안내가 그대로 남는다) */
export async function scanPdf(projectId: string, name: string): Promise<boolean> {
  const dir = materialsDir(projectId);
  const pagesDir = pagesDirOf(dir, name);
  const work = mkdtempSync(join(tmpdir(), "gepa-ocr-"));
  try {
    removeSync(pagesDir);
    mkdirSync(pagesDir, { recursive: true });
    const py = join(work, "render.py");
    const ps1 = join(work, "ocr.ps1");
    writeFileSync(py, RENDER_PY, "utf8");
    writeFileSync(ps1, OCR_PS1, "utf8");
    // -E -P: 환경 변수·스크립트 폴더의 모듈을 끌어오지 않는다(PyMuPDF 는 사용자 site-packages 에 있어 -I 는 못 쓴다)
    const pageCount = Number((await run(pythonBin(), ["-E", "-P", py, join(dir, name), pagesDir, String(DPI), String(MAX_PAGES)], 10 * 60_000)).trim()) || 0;
    const rendered = readdirSync(pagesDir).filter((f) => f.endsWith(".jpg")).length;
    if (!rendered) return false;
    const outFile = join(work, "ocr.txt");
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1, pagesDir, outFile], Math.max(5 * 60_000, rendered * 15_000));
    const ocr = readFileSync(outFile, "utf8").replace(/^﻿/, "");
    writeFileSync(join(dir, "text", `${name}.md`), ocrMarkdown(name, ocr, pageCount || rendered, rendered), "utf8");
    writeFileSync(join(dir, "text", `${name}.note`), "스캔 PDF — 글자 인식(OCR) 결과, 수치는 쪽 그림으로 확인", "utf8");
    return true;
  } catch (e) {
    console.error(`[scanPdf] ${name}: ${(e as Error).message}`);
    removeSync(pagesDir);
    // 다시 올리면(saveMaterial) 지워져 한 번 더 시도한다 — 그 전에는 단계마다 같은 실패를 되풀이하지 않는다
    writeFileSync(join(dir, "text", `${name}.scanfail`), (e as Error).message, "utf8");
    return false;
  } finally {
    removeSync(work);
  }
}

// 프로젝트마다 하나씩만 돌린다 — 올리는 중에 또 올리면 앞의 작업 뒤에 잇는다.
// Next 는 라우트마다 모듈을 따로 묶을 수 있어(업로드 라우트·실행 라우트) 표를 globalThis 에 둬 한 프로세스에서 같이 쓴다
const running: Map<string, Promise<number>> = ((globalThis as { __gepaScanRunning?: Map<string, Promise<number>> }).__gepaScanRunning ??= new Map());

/** 남은 스캔 PDF 를 뒤에서 처리한다(이미 돌고 있으면 그 작업을 돌려준다) */
export function startScanPending(projectId: string): Promise<number> {
  if (!scanAvailable()) return Promise.resolve(0);
  const prev = running.get(projectId);
  const job = (prev ?? Promise.resolve(0)).then(async () => {
    let done = 0;
    // 처리 중에 새로 올린 PDF 도 잡도록 매번 다시 본다
    for (let names = pendingScans(projectId), tried = new Set<string>(); names.some((n) => !tried.has(n)); names = pendingScans(projectId)) {
      for (const n of names) {
        if (tried.has(n)) continue;
        tried.add(n);
        if (await scanPdf(projectId, n)) done++;
      }
      writeMaterialsIndex(projectId);
    }
    return done;
  });
  const tracked = job.finally(() => {
    if (running.get(projectId) === tracked) running.delete(projectId);
  });
  running.set(projectId, tracked);
  return tracked;
}

/** 단계 시작 전: 남은 스캔 PDF 를 처리하고 끝나기를 기다린다 */
export function awaitScans(projectId: string): Promise<number> {
  return pendingScans(projectId).length || running.has(projectId) ? startScanPending(projectId) : Promise.resolve(0);
}
