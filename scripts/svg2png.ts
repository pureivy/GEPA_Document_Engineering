/** Rasterize rhwp SVG pages to PNG (for visual checks / previews). Usage: tsx scripts/svg2png.ts <svgdir|svgfile> [outdir] [width] */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { Resvg } from "@resvg/resvg-js";
const src = process.argv[2];
const out = process.argv[3] ?? src;
const width = Number(process.argv[4] ?? 1000);
mkdirSync(out, { recursive: true });
const files = statSync(src).isDirectory() ? readdirSync(src).filter((f) => f.endsWith(".svg")).map((f) => join(src, f)) : [src];
for (const f of files) {
  const svg = readFileSync(f, "utf8");
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontDirs: [join(process.cwd(), "public/fonts")], loadSystemFonts: true, defaultFontFamily: "휴먼명조" } });
  const png = r.render().asPng();
  const o = join(out, basename(f).replace(/\.svg$/, ".png"));
  writeFileSync(o, png);
  console.log(o, png.length);
}
