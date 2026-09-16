/**
 * The references indent bullet levels with literal leading half-width spaces, not
 * paragraph margins. These are the canonical counts per family (from docs/design-system).
 */
import type { Family, Glyph, ParaRole } from "./schema";

const NOTICE: Record<string, number> = { "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 1 };
const PLAN: Record<string, number> = { "□": 1, "ㅇ": 2, "○": 2, "◦": 2, "-": 3, "·": 4, "※": 1, "*": 2 };
const PRESS: Record<string, number> = { "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 2 };
/**
 * 행정업무운영 편람(규칙 제2조제1항): 첫째 항목은 왼쪽 기본선, 둘째 항목부터 바로 위 항목에서
 * 오른쪽으로 2타(= 반각 공백 2개)씩. ※/* 참고는 딸린 항목보다 2타 안쪽(bodyStyle이 문맥으로 보정).
 */
const GOV: Record<string, number> = { "□": 0, "■": 0, "ㅇ": 2, "○": 2, "◦": 2, "-": 4, "·": 6, "※": 2, "*": 2 };

export type Ladder = "gepa" | "gov";

export function leadingSpaces(family: Family, glyph: Glyph | undefined, role: ParaRole, ladder: Ladder = "gepa"): number {
  if (!glyph || glyph === "none") return role === "greeting" ? 2 : 0;
  const t = ladder === "gov" ? GOV : family === "notice" ? NOTICE : family === "plan" ? PLAN : PRESS;
  return t[glyph] ?? 0;
}

/** Indent of a ※/* note that annotates the previous item (편람: 딸린 항목의 내용 첫 글자 위치). */
export function noteIndentUnder(family: Family, prevGlyph: string | undefined, ladder: Ladder = "gepa"): number | undefined {
  if (!prevGlyph) return undefined;
  if (ladder === "gov") return (GOV[prevGlyph] ?? 0) + 2;
  if (prevGlyph === "ㅇ" || prevGlyph === "○" || prevGlyph === "◦" || prevGlyph === "-") return family === "plan" ? 3 : 4;
  return undefined;
}

export function glyphRole(glyph: Glyph): ParaRole {
  switch (glyph) {
    case "□":
    case "■":
      return "body1";
    case "ㅇ":
    case "○":
    case "◦":
    case "❍":
    case "✔":
      return "body2";
    case "-":
      return "body3";
    case "·":
    case "∙":
    case "▪":
      return "body4";
    case "※":
      return "note";
    case "*":
      return "footnote";
    default:
      return "plain";
  }
}
