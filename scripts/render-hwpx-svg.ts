/** HWPX → rhwp SVG 쪽 파일들. Usage: tsx scripts/render-hwpx-svg.ts <in.hwpx> <outdir> */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { renderPagesSvg } from "../lib/hwpx/validate";
async function main() {
  const [src, out] = process.argv.slice(2);
  mkdirSync(out, { recursive: true });
  const pages = await renderPagesSvg(new Uint8Array(readFileSync(src)));
  pages.forEach((svg, i) => writeFileSync(join(out, `page-${i}.svg`), svg));
  console.log("pages:", pages.length, "→", out);
}
main().catch((e) => { console.error(e); process.exit(1); });
