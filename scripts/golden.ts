/**
 * Golden check: templates/<family>/golden/<name>.dsl.md → HWPX → validate → compare the
 * paragraph text sequence with the reference document → rhwp render-diff (informational).
 * Usage: pnpm tsx scripts/golden.ts notice 6-1
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rhwpBin, spawnCommandSync as spawnSync } from "../lib/platform";
import { parseDsl } from "../lib/docmodel/dsl";
import { buildHwpx } from "../lib/hwpx/build";
import { validateHwpx, extractText } from "../lib/hwpx/validate";

const family = process.argv[2] ?? "notice";
const name = process.argv[3] ?? "6-1";
const dir = join(process.cwd(), "templates", family);
const dsl = readFileSync(join(dir, "golden", `${name}.dsl.md`), "utf8");

function norm(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[‧·]/g, "·").trim();
}

async function main() {
  const { doc, warnings } = parseDsl(dsl);
  if (warnings.length) console.log("parser warnings:", warnings.slice(0, 10));
  const { bytes, report } = buildHwpx(doc, { now: new Date("2026-09-15T00:00:00Z") });
  mkdirSync(join(process.cwd(), "data", "golden"), { recursive: true });
  const out = join(process.cwd(), "data", "golden", `${family}-${name}.hwpx`);
  writeFileSync(out, bytes);
  console.log("built", out, JSON.stringify({ paragraphs: report.paragraphs, tables: report.tables, pictures: report.pictures, appended: report.appendedStyles.length, warnings: report.warnings.length }));
  const v = await validateHwpx(bytes);
  console.log("validate", JSON.stringify({ ok: v.ok, pages: v.pageCount, contentLoss: v.contentLoss?.count, errors: v.errors }));

  // text comparison with the reference (non-empty lines, whitespace-normalized)
  const refPath = join(dir, "reference.text.txt");
  if (existsSync(refPath)) {
    const ref = readFileSync(refPath, "utf8").split("\n").map(norm).filter(Boolean);
    const got = (await extractText(bytes)).split("\n").map(norm).filter(Boolean);
    const refSet = new Set(ref);
    const gotSet = new Set(got);
    const missing = ref.filter((l) => !gotSet.has(l));
    const extra = got.filter((l) => !refSet.has(l));
    console.log(`text lines: reference ${ref.length}, generated ${got.length}, missing ${missing.length}, extra ${extra.length}`);
    if (missing.length) console.log("MISSING (first 25):\n  " + missing.slice(0, 25).join("\n  "));
    if (extra.length) console.log("EXTRA (first 25):\n  " + extra.slice(0, 25).join("\n  "));
    // leading-space ladder check on body lines
    const ladder = (lines: string[]) => lines.filter((l) => /^ *[□ㅇ○◦※*\-·]/.test(l)).map((l) => `${l.length - l.trimStart().length}${l.trim()[0]}`);
    const refRaw = readFileSync(refPath, "utf8").split("\n");
    const gotRaw = (await extractText(bytes)).split("\n");
    const lr = ladder(refRaw), lg = ladder(gotRaw);
    const ladderMismatch = lr.filter((x, i) => lg[i] !== x).length;
    console.log(`ladder entries: reference ${lr.length}, generated ${lg.length}, mismatched positions ${ladderMismatch}`);
  }
  // rhwp verify + render-diff (informational)
  const rhwp = rhwpBin();
  if (existsSync(rhwp)) {
    const ver = spawnSync(rhwp, ["verify", out, "--expect-min-pages", "5", "--expect-contains", "1. 모집개요", "--expect-contains", "www.gepa.kr", "--expect-contains", "기업게좌"], { encoding: "utf8" });
    console.log("rhwp verify:", ver.stdout.trim().split("\n").pop());
    const rd = spawnSync(rhwp, ["render-diff", join(dir, "reference.hwpx"), out, "--json", "--max-disp", "2"], { encoding: "utf8" });
    console.log("render-diff exit", rd.status, (rd.stdout.trim().split("\n").pop() ?? "").slice(0, 300));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
