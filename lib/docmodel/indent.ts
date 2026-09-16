/**
 * The references indent bullet levels with literal leading half-width spaces, not
 * paragraph margins. These are the canonical counts per family (from docs/design-system).
 */
import type { Family, Glyph, ParaRole } from "./schema";

const NOTICE: Record<string, number> = { "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 1 };
const PLAN: Record<string, number> = { "□": 1, "ㅇ": 2, "○": 2, "◦": 2, "-": 3, "·": 4, "※": 1, "*": 2 };
const PRESS: Record<string, number> = { "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 2 };

export function leadingSpaces(family: Family, glyph: Glyph | undefined, role: ParaRole): number {
  if (!glyph || glyph === "none") return role === "greeting" ? 2 : 0;
  const t = family === "notice" ? NOTICE : family === "plan" ? PLAN : PRESS;
  return t[glyph] ?? 0;
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
