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
];
for (const [src, dst] of pairs) {
  const s = join(root, src), d = join(root, dst);
  if (!existsSync(s)) { console.warn("skip (missing):", src); continue; }
  mkdirSync(join(d, ".."), { recursive: true });
  copyFileSync(s, d);
  console.log("copied", src, "→", dst);
}
