/**
 * Stage export: DocModel → out.hwpx (+ validation report) and page SVG cache, all under a
 * stage directory (data/projects/<id>/<stage>/).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildHwpx, type BuildOptions } from "./build";
import { validateHwpx, renderPagesSvg } from "./validate";
import { embedPreview } from "./preview";
import type { DocModel } from "../docmodel/schema";
import type { ExportReportDTO } from "../contracts";

export interface ExportResult {
  report: ExportReportDTO;
  hwpxPath: string;
  bytes: Uint8Array;
}

export function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex").slice(0, 16);
}

export async function exportStageDoc(stageDir: string, doc: DocModel, opts: BuildOptions = {}): Promise<ExportResult> {
  mkdirSync(stageDir, { recursive: true });
  const built = buildHwpx(doc, opts);
  const v = await validateHwpx(built.bytes);
  // page SVGs are rendered once here: they seed the render cache and page 0 becomes the
  // Preview/PrvImage.png thumbnail (a repack that does not change the layout)
  let bytes = built.bytes;
  let svgs: string[] = [];
  const warnings = built.report.warnings.map((w) => (w.blockId ? `[${w.blockId}] ${w.message}` : w.message));
  if (v.ok) {
    try {
      svgs = await renderPagesSvg(built.bytes);
      const pv = await embedPreview(built.bytes, svgs[0]);
      bytes = pv.bytes;
      if (!pv.embedded && pv.error) warnings.push(`미리보기 이미지 생성 실패: ${pv.error}`);
    } catch (e) {
      warnings.push(`렌더 실패: ${(e as Error).message}`);
    }
  }
  const hash = sha1(bytes);
  const hwpxPath = join(stageDir, "out.hwpx");
  writeFileSync(hwpxPath, bytes);
  writeFileSync(join(stageDir, "out.section0.xml"), built.sectionXml);
  if (svgs.length) writeRenderCache(stageDir, hash, svgs);
  const report: ExportReportDTO = {
    ok: v.ok,
    pageCount: v.pageCount,
    contentLossCount: v.contentLoss?.count ?? null,
    appendedStyles: built.report.appendedStyles.length,
    warnings,
    errors: v.errors,
    builtAt: new Date().toISOString(),
    hash,
  };
  writeFileSync(join(stageDir, "export-report.json"), JSON.stringify(report, null, 2));
  return { report, hwpxPath, bytes };
}

function writeRenderCache(stageDir: string, hash: string, svgs: string[]): string {
  const dir = join(stageDir, "render", hash);
  mkdirSync(dir, { recursive: true });
  svgs.forEach((svg, i) => writeFileSync(join(dir, `page-${i}.svg`), svg));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ pages: svgs.length, hash, renderedAt: new Date().toISOString() }));
  // prune older renders (keep the 3 newest)
  const renderRoot = join(stageDir, "render");
  const dirs = readdirSync(renderRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ name: d.name, t: statMtime(join(renderRoot, d.name)) })).sort((a, b) => b.t - a.t);
  for (const d of dirs.slice(3)) rmSync(join(renderRoot, d.name), { recursive: true, force: true });
  return dir;
}

export function readExportReport(stageDir: string): ExportReportDTO | null {
  const p = join(stageDir, "export-report.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as ExportReportDTO;
}

/** Render (or reuse cached) page SVGs for the current out.hwpx. Returns page count and hash. */
export async function ensureRendered(stageDir: string): Promise<{ pages: number; hash: string; dir: string } | null> {
  const hwpxPath = join(stageDir, "out.hwpx");
  if (!existsSync(hwpxPath)) return null;
  const bytes = new Uint8Array(readFileSync(hwpxPath));
  const hash = sha1(bytes);
  const dir = join(stageDir, "render", hash);
  if (existsSync(join(dir, "manifest.json"))) {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { pages: number };
    return { pages: m.pages, hash, dir };
  }
  const svgs = await renderPagesSvg(bytes);
  writeRenderCache(stageDir, hash, svgs);
  return { pages: svgs.length, hash, dir };
}

function statMtime(p: string): number {
  try {
    return readFileSync(join(p, "manifest.json"), "utf8").length > 0 ? Date.parse(JSON.parse(readFileSync(join(p, "manifest.json"), "utf8")).renderedAt ?? 0) || 0 : 0;
  } catch {
    return 0;
  }
}

export function readPageSvg(stageDir: string, hash: string, page: number): string | null {
  const p = join(stageDir, "render", hash, `page-${page}.svg`);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}
