/**
 * Reads templates/<family>/pkg/Contents/header.xml and writes
 * templates/<family>/catalog.json (all charPr/paraPr/borderFill signatures + fonts).
 * The hand-curated role map lives in templates/<family>/style-map.json (not overwritten).
 *
 * Usage: pnpm tsx scripts/extract-style-map.ts <notice|plan>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseXml } from "../lib/hwpx/xml";
import { parseHeaderCatalog, charPrSignature, paraPrSignature, borderFillSignature } from "../lib/hwpx/header";

const family = process.argv[2];
if (!family) throw new Error("usage: extract-style-map.ts <family>");
const dir = join(process.cwd(), "templates", family);
const head = parseXml(readFileSync(join(dir, "pkg/Contents/header.xml"), "utf8"));
const cat = parseHeaderCatalog(head);
const out = {
  family,
  counts: cat.counts,
  fonts: cat.fonts,
  charPr: cat.charPr.map((c) => ({ ...c, sig: charPrSignature(c) })),
  paraPr: cat.paraPr.map((p) => ({ ...p, sig: paraPrSignature(p) })),
  borderFill: cat.borderFill.map((b) => ({ ...b, sig: borderFillSignature(b) })),
};
writeFileSync(join(dir, "catalog.json"), JSON.stringify(out, null, 2));
console.log(family, JSON.stringify(cat.counts));
// quick human summary of the charPr actually used by hangul text faces
const byFace: Record<string, number[]> = {};
for (const c of cat.charPr) (byFace[`${c.hangul} ${c.pt}pt${c.bold ? " B" : ""}${c.color !== "#000000" ? " " + c.color : ""}${c.spacing ? " sp" + c.spacing : ""}${c.ratio !== 100 ? " w" + c.ratio : ""}`] ??= []).push(c.id);
for (const [k, v] of Object.entries(byFace).sort()) console.log("  ", k.padEnd(40), v.join(","));
