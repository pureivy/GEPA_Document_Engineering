/** 저장된 단계 문서(doc.json)를 지금 코드로 다시 빌드해 쪽 PNG 로 낸다. tsx scripts/closeout-render-doc.ts <doc.json> <outdir> */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { DocModelSchema } from "../lib/docmodel/schema";
import { renderPagesSvg, validateHwpx } from "../lib/hwpx/validate";
import { buildLaidOut } from "../lib/hwpx/keepPass";
async function main() {
  const [src, out] = process.argv.slice(2);
  mkdirSync(out, { recursive: true });
  const doc = DocModelSchema.parse(JSON.parse(readFileSync(src, "utf8")));
  const { bytes, report } = await buildLaidOut(doc);
  writeFileSync(join(out, "out.hwpx"), bytes);
  console.log("warnings:", report.warnings);
  const v = await validateHwpx(bytes);
  console.log(JSON.stringify({ ok: v.ok, pages: v.pageCount, loss: v.contentLoss?.count ?? 0 }));
  (await renderPagesSvg(bytes)).forEach((svg, i) => writeFileSync(join(out, `page-${i + 1}.png`), new Resvg(svg, { fitTo: { mode: "width", value: 900 }, font: { fontDirs: [join(process.cwd(), "public/fonts")], loadSystemFonts: true, defaultFontFamily: "휴먼명조" } }).render().asPng()));
}
main();
