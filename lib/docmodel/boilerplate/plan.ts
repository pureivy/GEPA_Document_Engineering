/**
 * Fixed text for the 사업계획서 family (docs/design-system/plan.md §4 outline). plan.md only
 * names the "※ 정산 관련 문구" slot without quoting it, so the wording below is the agreed
 * canonical sentence.
 */
import type { MacroArgs } from "./notice";

export const PLAN_정산문구 = "예산은 사업 진행 상황에 따라 항목 간 변경 가능하며, 정산은 관련 규정에 따름";

/** House convention: the document closes with `.  끝.` (two spaces) on the last bullet. */
export const 끝_SUFFIX = ".  끝.";
export const 끝_LINE = "끝.";

export const PLAN_MACROS: Record<string, (args: MacroArgs) => string[]> = {
  정산문구: () => [`※ ${PLAN_정산문구}`],
  /**
   * `끝` is special-cased by the parser (it appends `.  끝.` to the previous paragraph).
   * This fallback is what gets emitted when there is no previous paragraph.
   */
  끝: () => [끝_LINE],
};

export function expandPlanBoilerplate(name: string, args: MacroArgs = {}): string[] | undefined {
  const fn = PLAN_MACROS[name];
  return fn ? fn(args) : undefined;
}
