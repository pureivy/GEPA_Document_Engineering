/**
 * 정산·결과보고 DSL(매크로 포함) + 원장 → HWPX 와 쪽 PNG. 서식 확인용 진단 스크립트.
 *   pnpm exec tsx scripts/closeout-preview.ts <draft.dsl.md> <ledger.json> <출력폴더>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { LedgerSchema } from "../lib/closeout/ledger";
import { expandLedgerMacros } from "../lib/closeout/macros";
import { parseDsl } from "../lib/docmodel/dsl";
import { normalizeDocMeta, normalizeDslText } from "../lib/docmodel/govNormalize";
import { buildHwpx } from "../lib/hwpx/build";
import { renderPagesSvg, validateHwpx } from "../lib/hwpx/validate";

async function main() {
  const [src, ledgerPath, outDir] = process.argv.slice(2);
  if (!src || !ledgerPath || !outDir) throw new Error("usage: tsx scripts/closeout-preview.ts <draft.dsl.md> <ledger.json> <outdir>");
  mkdirSync(outDir, { recursive: true });
  const ledger = LedgerSchema.parse(JSON.parse(readFileSync(resolve(ledgerPath), "utf8")));
  const x = expandLedgerMacros(readFileSync(resolve(src), "utf8"), ledger);
  if (x.warnings.length) console.log("매크로 경고:", x.warnings);
  const n = normalizeDslText(x.text);
  writeFileSync(join(outDir, "expanded.dsl.md"), n.text);
  const parsed = parseDsl(n.text);
  for (const w of parsed.warnings) console.log(`  L${w.line}: ${w.message}`);
  const { bytes, report } = buildHwpx(normalizeDocMeta(parsed.doc).doc);
  writeFileSync(join(outDir, "out.hwpx"), bytes);
  for (const w of report.warnings) console.log("  build:", w);
  const v = await validateHwpx(bytes);
  console.log("검증:", JSON.stringify({ ok: v.ok, 쪽수: v.pageCount, 손실: v.contentLoss?.count ?? 0, 오류: v.errors }));
  const svgs = await renderPagesSvg(bytes);
  svgs.forEach((svg, i) => {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 900 }, font: { fontDirs: [join(process.cwd(), "public/fonts")], loadSystemFonts: true, defaultFontFamily: "휴먼명조" } }).render().asPng();
    writeFileSync(join(outDir, `page-${i + 1}.png`), png);
  });
  console.log("→", outDir, svgs.length, "쪽");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
