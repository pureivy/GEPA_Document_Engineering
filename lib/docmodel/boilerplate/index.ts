/**
 * `expandBoilerplate(name, args)` — the single entry point used by the DSL parser for
 * `{{boilerplate:NAME key=value …}}` macros. Returns DSL lines, or undefined for an unknown
 * macro (the parser then degrades the macro line to plain text with a warning).
 *
 * Macros are family-agnostic on purpose: a plan may legitimately reuse a notice sentence.
 */
import { expandNoticeBoilerplate, type MacroArgs } from "./notice";
import { expandPlanBoilerplate } from "./plan";

export type { MacroArgs } from "./notice";
export * from "./notice";
export * from "./plan";

export const BOILERPLATE_NAMES = ["참여제한대상", "일정변경", "예산상황", "기업부담금", "지급방법", "기타유의사항", "이의제기", "정산문구", "끝"] as const;
export type BoilerplateName = (typeof BOILERPLATE_NAMES)[number];

export function expandBoilerplate(name: string, args: MacroArgs = {}): string[] | undefined {
  return expandNoticeBoilerplate(name, args) ?? expandPlanBoilerplate(name, args);
}

export function isBoilerplateName(name: string): name is BoilerplateName {
  return (BOILERPLATE_NAMES as readonly string[]).includes(name);
}
