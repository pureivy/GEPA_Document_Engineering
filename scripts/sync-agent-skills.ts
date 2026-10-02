/** Copies reference material (design-system reports, DSL grammar) into agent/.claude/skills/<name>/reference. */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const pairs: [string, string][] = [
  ["docs/design-system/plan.md", "agent/.claude/skills/gepa-plan-design/reference/design-system.md"],
  ["docs/design-system/notice.md", "agent/.claude/skills/gepa-notice-design/reference/design-system.md"],
  ["lib/docmodel/dsl/grammar.md", "agent/.claude/skills/gepa-dsl/reference/grammar.md"],
  ["docs/design-system/bumpis.md", "agent/.claude/skills/gepa-plan-design/reference/bumpis.md"],
  ["docs/design-system/press.md", "agent/.claude/skills/gepa-press-style/reference/design-system.md"],
  ["docs/design-system/gov-manual.md", "agent/.claude/skills/gepa-plan-design/reference/gov-manual.md"],
  ["docs/design-system/gov-manual.md", "agent/.claude/skills/gepa-notice-design/reference/gov-manual.md"],
  ["docs/design-system/official.md", "agent/.claude/skills/gepa-official-design/reference/design-system.md"],
  ["docs/design-system/gov-manual.md", "agent/.claude/skills/gepa-official-design/reference/gov-manual.md"],
  // 업무보고는 편람 2타 사다리가 아니라 참고본 실측 사다리를 쓴다 — gov-manual 을 딸려 보내지 않는다
  ["docs/design-system/report.md", "agent/.claude/skills/gepa-report-design/reference/design-system.md"],
  // 정산·결과보고 — 2026년 실문서 조사 3편(정산보고서·결과보고서·커버 공문)
  ["docs/design-system/closeout-settlement.md", "agent/.claude/skills/gepa-closeout-design/reference/settlement.md"],
  ["docs/design-system/closeout-result.md", "agent/.claude/skills/gepa-closeout-design/reference/result.md"],
  ["docs/design-system/closeout-cover.md", "agent/.claude/skills/gepa-closeout-design/reference/cover.md"],
  // 결과보고서 표준 서식 — "사업 결과보고" 212건에서 필수 항목만 추린 것(장 4개 + 유형 모듈 A~F)
  ["docs/design-system/closeout-result-standard.md", "agent/.claude/skills/gepa-closeout-design/reference/result-standard.md"],
];
for (const [src, dst] of pairs) {
  const s = join(root, src), d = join(root, dst);
  if (!existsSync(s)) { console.warn("skip (missing):", src); continue; }
  mkdirSync(join(d, ".."), { recursive: true });
  copyFileSync(s, d);
  console.log("copied", src, "→", dst);
}
