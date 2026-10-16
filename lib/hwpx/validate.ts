/** Validation and rendering through @rhwp/core (WASM, Node). */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

type RhwpModule = {
  default: (opts?: { module_or_path?: Uint8Array | string }) => Promise<unknown>;
  HwpDocument: new (data: Uint8Array) => RhwpDoc;
};
export interface RhwpDoc {
  pageCount(): number;
  exportHwpx(): Uint8Array;
  exportHwpxWithReport(): { contentLoss(): string; hasBytes(): boolean; takeBytes(): Uint8Array };
  renderPageSvg(page: number): string;
  getTextRange?(sec: number, para: number, off: number, count: number): string;
  free?(): void;
}

let modPromise: Promise<RhwpModule> | null = null;
export async function rhwp(): Promise<RhwpModule> {
  if (!modPromise) {
    modPromise = (async () => {
      // Next.js bundles this module; resolve the wasm from the real node_modules on disk first
      // (require.resolve from a bundled chunk points at a virtual "[externals]" path).
      const candidates = [join(process.cwd(), "node_modules", "@rhwp", "core", "rhwp_bg.wasm")];
      try {
        const require = createRequire(import.meta.url);
        candidates.push(require.resolve("@rhwp/core/package.json").replace(/package\.json$/, "rhwp_bg.wasm"));
      } catch {
        /* bundled context without a usable require */
      }
      const wasmPath = candidates.find((p) => existsSync(p));
      if (!wasmPath) throw new Error(`@rhwp/core wasm not found (looked in ${candidates.join(", ")})`);
      const mod = (await import("@rhwp/core")) as unknown as RhwpModule;
      const wasm = readFileSync(wasmPath);
      await mod.default({ module_or_path: new Uint8Array(wasm) });
      return mod;
    })();
  }
  return modPromise;
}

/**
 * rhwp 배치를 한글에 맞춘 사본 — rhwp 는 문단 위·아래 간격이 600 HWPUNIT(약 6pt) 미만이면 통째로 버리고(실측: 500 → 0,
 * 600 → 600), 한글은 그대로 더한다. 5pt 간격 문단이 열 개 남짓인 쪽은 rhwp 가 두 줄쯤 짧게 재서 미리보기에는 들어간
 * "※ 근거" 가 한글에서는 다음 쪽으로 넘어갔다(결과보고서 2쪽, 2026-10-13). 쪽 배치를 재거나 미리보기를 그릴 때만 그런
 * 간격을 600 으로 올린다 — 한글보다 조금(문단마다 1pt 안쪽) 길게 재므로 넘침 쪽으로 틀리지 않는다. 내려받는 파일은 그대로.
 */
export const RHWP_MIN_SPACING = 600;
export function asLaidOutByHangul(bytes: Uint8Array): Uint8Array {
  const entries = unzipSync(bytes);
  const name = "Contents/header.xml";
  const header = new TextDecoder().decode(entries[name]);
  // hp:case(HwpUnitChar)와 hp:default(두 배 값) 둘 다 올려야 rhwp 가 받는다(실측: case 600·default 1000 이면 여전히 버림)
  const lift = (xml: string, min: number) =>
    xml.replace(/(<hc:(?:prev|next) value=")(\d+)(")/g, (m, a: string, v: string, b: string) => (Number(v) > 0 && Number(v) < min ? `${a}${min}${b}` : m));
  const fixed = header.replace(/<hp:case [\s\S]*?<\/hp:case>/g, (x) => lift(x, RHWP_MIN_SPACING)).replace(/<hp:default>[\s\S]*?<\/hp:default>/g, (x) => lift(x, RHWP_MIN_SPACING * 2));
  if (fixed === header) return bytes;
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [n, data] of Object.entries(entries)) files[n] = [n === name ? new TextEncoder().encode(fixed) : data, { level: n === "mimetype" || n.startsWith("BinData/") ? 0 : 6 }];
  return zipSync(files, { mtime: new Date("1980-01-01T00:00:00Z") });
}

export interface ValidationReport {
  ok: boolean;
  pageCount: number;
  contentLoss: { count: number; losses: unknown[] } | null;
  zipOrderOk: boolean;
  xmlWellFormed: boolean;
  errors: string[];
}

export async function validateHwpx(bytes: Uint8Array): Promise<ValidationReport> {
  const errors: string[] = [];
  // zip layout: mimetype first
  let zipOrderOk = false;
  try {
    const names = Object.keys(unzipSync(bytes));
    zipOrderOk = names[0] === "mimetype";
    if (!zipOrderOk) errors.push(`zip: first entry is ${names[0]}, expected mimetype`);
    const parser = new XMLParser({ ignoreAttributes: true, allowBooleanAttributes: true });
    const entries = unzipSync(bytes);
    for (const n of ["Contents/header.xml", "Contents/section0.xml", "Contents/content.hpf"]) {
      try {
        parser.parse(new TextDecoder().decode(entries[n]), true);
      } catch (e) {
        errors.push(`xml: ${n} not well-formed: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    errors.push(`zip: ${(e as Error).message}`);
  }
  const xmlWellFormed = !errors.some((e) => e.startsWith("xml:"));
  let pageCount = 0;
  let contentLoss: ValidationReport["contentLoss"] = null;
  try {
    const m = await rhwp();
    const doc = new m.HwpDocument(bytes);
    const laid = new m.HwpDocument(asLaidOutByHangul(bytes));
    pageCount = laid.pageCount();
    laid.free?.();
    if (pageCount <= 0) errors.push("rhwp: pageCount is 0");
    const rep = doc.exportHwpxWithReport();
    contentLoss = JSON.parse(rep.contentLoss());
    if (contentLoss && contentLoss.count > 0) errors.push(`rhwp: contentLoss.count=${contentLoss.count}`);
    const svg = doc.renderPageSvg(0);
    if (!svg || svg.length < 100) errors.push("rhwp: renderPageSvg(0) empty");
    doc.free?.();
  } catch (e) {
    errors.push(`rhwp: ${(e as Error).message}`);
  }
  return { ok: errors.length === 0, pageCount, contentLoss, zipOrderOk, xmlWellFormed, errors };
}

export async function renderPagesSvg(bytes: Uint8Array): Promise<string[]> {
  const m = await rhwp();
  const doc = new m.HwpDocument(asLaidOutByHangul(bytes));
  const n = doc.pageCount();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(doc.renderPageSvg(i));
  doc.free?.();
  return out;
}

export async function extractText(bytes: Uint8Array): Promise<string> {
  // text from section0.xml in document order (hp:t contents; lineBreak → \n; paragraphs → \n)
  const entries = unzipSync(bytes);
  const xml = new TextDecoder().decode(entries["Contents/section0.xml"]);
  return sectionText(xml);
}

export function sectionText(xml: string): string {
  const out: string[] = [];
  const re = /<hp:t>([\s\S]*?)<\/hp:t>|<hp:lineBreak\/>|<\/hp:p>/g;
  let m: RegExpExecArray | null;
  let cur = "";
  while ((m = re.exec(xml))) {
    if (m[0] === "</hp:p>") {
      out.push(cur);
      cur = "";
    } else if (m[0] === "<hp:lineBreak/>") cur += "\n";
    else cur += m[1].replace(/<hp:lineBreak\/>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  }
  return out.join("\n");
}
