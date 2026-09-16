/**
 * Build an HWPX from a saved doc.json using only a subset of its blocks — the tool used to
 * bisect "Hancom refuses to open this file" down to one block kind (see ADR 0004).
 *
 *   pnpm exec tsx scripts/build-subset.ts <doc.json> <out.hwpx> [all | 0-40 | ids:b001,b002 | kinds:para,table | not:approvalBlock]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildHwpx } from "../lib/hwpx/build";
import type { DocModel } from "../lib/docmodel/schema";

async function main() {
  const [src, out, spec] = process.argv.slice(2);
  const raw = JSON.parse(readFileSync(src, "utf8"));
  const doc: DocModel = raw.doc ?? raw;
  let blocks = doc.blocks;
  if (spec && spec !== "all") {
    // spec: "0-40" range (inclusive indices) or "ids:b001,b002" or "kinds:para,blank"
    if (spec.startsWith("ids:")) {
      const ids = new Set(spec.slice(4).split(","));
      blocks = blocks.filter((b) => ids.has(b.id));
    } else if (spec.startsWith("kinds:")) {
      const ks = new Set(spec.slice(6).split(","));
      blocks = blocks.filter((b) => ks.has(b.k));
    } else if (spec.startsWith("not:")) {
      const ks = new Set(spec.slice(4).split(","));
      blocks = blocks.filter((b) => !ks.has(b.k));
    } else {
      const [a, b] = spec.split("-").map(Number);
      blocks = blocks.slice(a, b + 1);
    }
  }
  const sub: DocModel = { ...doc, blocks };
  const { bytes, report } = buildHwpx(sub, { now: new Date("2026-09-15T00:00:00Z") });
  writeFileSync(out, bytes);
  console.log(`${out}: blocks ${blocks.length}, warnings ${report.warnings.length}, appended styles ${report.appendedStyles.length}`);
  for (const w of report.warnings) console.log("  warn:", w.message);
}
main().catch((e) => { console.error(e); process.exit(1); });
