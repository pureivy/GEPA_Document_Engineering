/** Validation and rendering through @rhwp/core (WASM, Node). */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { unzipSync } from "fflate";
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
    pageCount = doc.pageCount();
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
  const doc = new m.HwpDocument(bytes);
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
