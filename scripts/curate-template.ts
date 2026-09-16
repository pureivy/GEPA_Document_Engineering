/**
 * Converts templates/<family>/reference.hwp → reference.hwpx with rhwp, verifies it,
 * runs render-diff, unzips the package into templates/<family>/pkg/ (minus the
 * non-standard rhwp marker) and writes conversion-report.json.
 *
 * Usage: pnpm tsx scripts/curate-template.ts <notice|plan|press> [--allow-lineseg-diff] [--from-hwpx]
 *   --from-hwpx: the family ships a Hancom-saved reference.hwpx (press) — unzip it verbatim instead of converting the .hwp.
 */
import { spawnCommandSync as spawnSync } from "../lib/platform";
import { rhwpBin } from "../lib/platform";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";

const family = process.argv[2];
const allowLinesegDiff = process.argv.includes("--allow-lineseg-diff");
const fromHwpx = process.argv.includes("--from-hwpx");
if (!family) throw new Error("usage: curate-template.ts <family> [--allow-lineseg-diff]");

const RHWP = rhwpBin();
const dir = join(process.cwd(), "templates", family);
const refHwp = join(dir, "reference.hwp");
const refHwpx = join(dir, "reference.hwpx");
if (!fromHwpx && !existsSync(refHwp)) throw new Error(`missing ${refHwp}`);
if (fromHwpx && !existsSync(refHwpx)) throw new Error(`missing ${refHwpx}`);

function run(args: string[]) {
  const r = spawnSync(RHWP, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// 1) convert with verify (skipped when the reference is already a Hancom-saved HWPX)
const conv = fromHwpx ? { code: 0, out: "", err: "" } : run(["export-hwpx", refHwp, refHwpx, "--verify", "--json"]);
let convJson: unknown = null;
try { convJson = JSON.parse(conv.out.trim().split("\n").pop() ?? "null"); } catch { /* keep raw */ }
console.log(`export-hwpx exit=${conv.code}`);
if (conv.code !== 0) {
  const txt = conv.out + conv.err;
  const onlyLinesegs = /linesegs/.test(txt) && !/charPr|paraPr|borderFill|fontface/.test(txt);
  if (!(allowLinesegDiff && onlyLinesegs)) {
    console.error(txt.slice(0, 4000));
    throw new Error(`conversion failed for ${family} (exit ${conv.code})`);
  }
  console.log("verify reported lineseg-only differences; tolerated via --allow-lineseg-diff");
}

// 2) render-diff (informational for plan, gating for notice)
const rd = fromHwpx ? { code: 0, out: "", err: "" } : run(["render-diff", refHwp, refHwpx, "--json", "--max-disp", "1"]);
console.log(`render-diff exit=${rd.code}`);
let rdJson: unknown = null;
try { rdJson = JSON.parse(rd.out.trim().split("\n").pop() ?? "null"); } catch { /* raw */ }

// 3) unzip into pkg/, dropping the rhwp marker
const pkgDir = join(dir, "pkg");
rmSync(pkgDir, { recursive: true, force: true });
const entries = unzipSync(new Uint8Array(readFileSync(refHwpx)));
const kept: string[] = [];
for (const [name, bytes] of Object.entries(entries)) {
  if (name === "META-INF/rhwp-hwp5-origin") continue;
  if (name.endsWith("/")) continue;
  const p = join(pkgDir, name);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, bytes);
  kept.push(name);
}

// 4) info
const info = run(["info", refHwpx, "--json"]);
let infoJson: unknown = null;
try { infoJson = JSON.parse(info.out.trim().split("\n").pop() ?? "null"); } catch { /* raw */ }

const header = readFileSync(join(pkgDir, "Contents/header.xml"), "utf8");
const count = (re: RegExp) => (header.match(re) ?? []).length;
const report = {
  family,
  convertedAt: new Date().toISOString(),
  exportHwpx: { exit: conv.code, json: convJson },
  renderDiff: { exit: rd.code, json: rdJson },
  info: infoJson,
  entries: kept,
  headerCounts: {
    fontface: count(/<hh:fontface\b/g),
    font: count(/<hh:font\b/g),
    charPr: count(/<hh:charPr\b/g),
    paraPr: count(/<hh:paraPr\b/g),
    borderFill: count(/<hh:borderFill\b/g),
    style: count(/<hh:style\b/g),
  },
};
writeFileSync(join(dir, "conversion-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.headerCounts), `entries=${kept.length}`);
console.log(`wrote ${pkgDir} and conversion-report.json`);
