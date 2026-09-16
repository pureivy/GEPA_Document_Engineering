/**
 * Dumps every top-level table of templates/<family>/pkg/Contents/section0.xml as a raw XML
 * fragment (the whole anchoring <hp:p>) into templates/<family>/geometry/tNN.xml and writes
 * geometry/index.json. Named aliases (used by the writer) are copied to geometry/<name>.xml.
 *
 * Usage: pnpm tsx scripts/extract-geometry.ts <notice|plan>
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseXml, serialize } from "../lib/hwpx/xml";
import { summarizeTables, topLevelParagraphs } from "../lib/hwpx/section";

const family = process.argv[2];
if (!family) throw new Error("usage: extract-geometry.ts <family>");
const dir = join(process.cwd(), "templates", family);
const sec = parseXml(readFileSync(join(dir, "pkg/Contents/section0.xml"), "utf8"));
const gdir = join(dir, "geometry");
rmSync(gdir, { recursive: true, force: true });
mkdirSync(gdir, { recursive: true });
const paras = topLevelParagraphs(sec);
const tables = summarizeTables(sec);
for (const t of tables) writeFileSync(join(gdir, `t${String(t.tableIndex).padStart(2, "0")}.xml`), serialize(paras[t.paraIndex]));
writeFileSync(join(gdir, "index.json"), JSON.stringify(tables, null, 2));
// also dump every top-level paragraph without a table for reference (cover lines, body lines)
const plain = paras.map((p, i) => ({ i, xml: serialize(p) })).filter((x) => !x.xml.includes("<hp:tbl"));
writeFileSync(join(gdir, "paragraphs.xml"), plain.map((x) => `<!-- para ${x.i} -->\n${x.xml}`).join("\n"));
// plan cover pieces (docs/design-system/plan.md): grouped-shape title (para 6), spacer (7/18), bottom logo (19)
const COVER_ALIASES: Record<string, Record<string, number>> = { plan: { "cover-title": 6, "cover-blank": 7, "cover-blank2": 18, "cover-logo": 19 } };
for (const [name, idx] of Object.entries(COVER_ALIASES[family] ?? {})) writeFileSync(join(gdir, `${name}.xml`), serialize(paras[idx]));
console.log(`${family}: ${tables.length} top-level tables, ${paras.length} paragraphs`);
for (const t of tables) console.log(`  t${String(t.tableIndex).padStart(2, "0")} para=${t.paraIndex} ${t.rowCnt}x${t.colCnt} w=${t.width} h=${t.height} tac=${t.treatAsChar} | ${t.preview}`);
