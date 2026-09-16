/**
 * Text extraction for an uploaded 기존 사업계획서 (reference document) — the agents read the
 * result as `<project>/reference/base-plan.md`.
 *   .hwpx  → every Contents/section*.xml in order (hp:t text, table cells included)
 *   .hwp   → converted once with `bin/rhwp export-hwpx`, then as .hwpx
 *   .pdf   → `pdftotext -layout` (poppler; Homebrew `brew install poppler`)
 *   .docx  → word/document.xml (w:t runs, paragraphs → lines)
 *   .md/.txt → as is (UTF-8)
 */
import { pdftotextBin, rhwpBin, spawnCommandSync as spawnSync } from "../platform";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { sectionText } from "../hwpx/validate";

export const REFERENCE_EXTENSIONS = [".hwpx", ".hwp", ".pdf", ".docx", ".md", ".txt"] as const;
/** keep the prompt input bounded (a 30-page plan is ~40k chars) */
export const REFERENCE_MAX_CHARS = 80_000;

export function referenceExtension(fileName: string): (typeof REFERENCE_EXTENSIONS)[number] | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName);
  const ext = m ? `.${m[1].toLowerCase()}` : "";
  return (REFERENCE_EXTENSIONS as readonly string[]).includes(ext) ? (ext as (typeof REFERENCE_EXTENSIONS)[number]) : null;
}

export function hwpxText(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const names = Object.keys(entries)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => Number(/section(\d+)/.exec(a)![1]) - Number(/section(\d+)/.exec(b)![1]));
  const dec = new TextDecoder();
  return names.map((n) => sectionText(dec.decode(entries[n]))).join("\n\n");
}

export function docxText(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const xml = new TextDecoder().decode(entries["word/document.xml"] ?? new Uint8Array());
  const out: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\/>|<w:tab\/>|<\/w:p>/g;
  let m: RegExpExecArray | null;
  let cur = "";
  while ((m = re.exec(xml))) {
    if (m[0] === "</w:p>") {
      out.push(cur);
      cur = "";
    } else if (m[0] === "<w:br/>") {
      out.push(cur);
      cur = "";
    } else if (m[0] === "<w:tab/>") cur += "\t";
    else cur += decodeEntities(m[1]);
  }
  if (cur) out.push(cur);
  return out.join("\n");
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
}

export function hwpToHwpx(bytes: Uint8Array, bin = rhwpBin()): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "gepa-ref-"));
  try {
    const src = join(dir, "in.hwp");
    const dst = join(dir, "out.hwpx");
    writeFileSync(src, bytes);
    const r = spawnSync(bin, ["export-hwpx", src, dst], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`HWP 변환 도구(rhwp)가 없습니다: ${bin} — https://github.com/edwardkim/rhwp/releases 의 실행 파일을 bin/ 에 두거나 RHWP_BIN 을 설정하세요`);
    if (r.status !== 0) throw new Error(`rhwp export-hwpx failed (${r.status}): ${(r.stderr || r.stdout || "").slice(0, 300)}`);
    return new Uint8Array(readFileSync(dst));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function pdfText(bytes: Uint8Array, bin = pdftotextBin()): string {
  const dir = mkdtempSync(join(tmpdir(), "gepa-ref-"));
  try {
    const src = join(dir, "in.pdf");
    writeFileSync(src, bytes);
    const r = spawnSync(bin, ["-layout", "-enc", "UTF-8", src, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("PDF 텍스트 추출 도구(pdftotext)가 없습니다 — macOS `brew install poppler`, Windows는 poppler 릴리스를 풀고 PATH 또는 PDFTOTEXT_BIN 에 지정하세요");
    if (r.status !== 0) throw new Error(`pdftotext failed (${r.status}): ${(r.stderr || "").slice(0, 300)}`);
    // pdftotext -layout pads columns with spaces and separates pages with form feeds
    return r.stdout.replace(/\f/g, "\n\n").replace(/[ \t]{3,}/g, "  ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Plain text of a reference document, or throws for unsupported/undecodable files. */
export function extractReferenceText(fileName: string, bytes: Uint8Array): { text: string; truncated: boolean } {
  const ext = referenceExtension(fileName);
  if (!ext) throw new Error(`지원하지 않는 파일 형식입니다 (${REFERENCE_EXTENSIONS.join(", ")})`);
  let text: string;
  if (ext === ".hwpx") text = hwpxText(bytes);
  else if (ext === ".hwp") text = hwpxText(hwpToHwpx(bytes));
  else if (ext === ".pdf") text = pdfText(bytes);
  else if (ext === ".docx") text = docxText(bytes);
  else text = new TextDecoder().decode(bytes);
  text = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("문서에서 글자를 읽지 못했습니다");
  const truncated = text.length > REFERENCE_MAX_CHARS;
  return { text: truncated ? text.slice(0, REFERENCE_MAX_CHARS) + "\n\n[… 이하 생략 …]" : text, truncated };
}

/** The markdown the agents read: a short header + the extracted body. */
export function referenceMarkdown(fileName: string, changes: string, text: string): string {
  return [`# 기존 사업계획서 — ${fileName}`, "", "## 이번 프로젝트에서 바뀌는 내용", "", changes.trim() || "(변경 사항 미기재 — 연도·일정·담당만 갱신)", "", "## 기존 사업계획서 원문", "", text, ""].join("\n");
}
