/**
 * DSL 파일 하나 → HWPX 파일 하나. 웹앱을 거치지 않는 CLI 경로다.
 * 플랫폼(lib/stages/service.ts)과 같은 순서로 처리한다: 정규화 → 파싱 → 빌드 → 검증.
 *
 *   pnpm exec tsx scripts/make-doc.ts <입력.dsl.md> <출력.hwpx>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseDsl } from "../lib/docmodel/dsl";
import { normalizeDslText, normalizeDocMeta } from "../lib/docmodel/govNormalize";
import { buildHwpx } from "../lib/hwpx/build";
import { validateHwpx } from "../lib/hwpx/validate";

async function main() {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error("usage: tsx scripts/make-doc.ts <입력.dsl.md> <출력.hwpx>");
    process.exit(2);
  }

  const raw = readFileSync(resolve(src), "utf8");

  // 플랫폼이 에이전트 산출물에 적용하는 것과 같은 편람 정규화
  const n = normalizeDslText(raw);
  const parsed = parseDsl(n.text);
  const m = normalizeDocMeta(parsed.doc);
  const changes = [...n.changes, ...m.changes];
  if (changes.length) console.log("정규화:", changes.map((c) => `${c.rule}×${c.count}`).join(", "));

  const errors = parsed.warnings.filter((w) => /error/i.test(String((w as { severity?: string }).severity ?? "")));
  if (parsed.warnings.length) {
    console.log(`파서 경고 ${parsed.warnings.length}건`);
    for (const w of parsed.warnings.slice(0, 20)) console.log(`  L${w.line}: ${w.message}`);
  }
  if (errors.length) {
    console.error("front-matter 오류로 중단합니다.");
    process.exit(1);
  }

  const { bytes, report } = buildHwpx(m.doc);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), bytes);
  console.log(
    "빌드:",
    JSON.stringify({
      문단: report.paragraphs,
      표: report.tables,
      그림: report.pictures,
      추가스타일: report.appendedStyles.length,
      경고: report.warnings.length,
    }),
  );
  for (const w of report.warnings.slice(0, 20)) console.log(`  ${w}`);

  const v = await validateHwpx(bytes);
  console.log("검증:", JSON.stringify({ ok: v.ok, 쪽수: v.pageCount, 손실: v.contentLoss?.count ?? 0, 오류: v.errors }));
  console.log("→", resolve(out));
  if (!v.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
