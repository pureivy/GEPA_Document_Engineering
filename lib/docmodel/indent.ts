/**
 * The references indent bullet levels with literal leading half-width spaces, not
 * paragraph margins. These are the canonical counts per family (from docs/design-system).
 */
import type { Family, Glyph, ParaRole } from "./schema";
import { DOC_FAMILIES } from "./families";

/**
 * 행정업무운영 편람(규칙 제2조제1항): 첫째 항목은 왼쪽 기본선, 둘째 항목부터 바로 위 항목에서
 * 오른쪽으로 2타(= 반각 공백 2개)씩. ※/* 참고는 딸린 항목보다 2타 안쪽(bodyStyle이 문맥으로 보정).
 */
const GOV: Record<string, number> = { "□": 0, "■": 0, "ㅇ": 2, "○": 2, "◦": 2, "-": 4, "·": 6, "※": 2, "*": 2 };

export type Ladder = "gepa" | "gov";

/**
 * 편람 §3 의 **글 번호** 사다리 — `1.` → `가.` → `1)` → `가)` → `(1)` → `(가)` → `①` → `㉮`,
 * 한 단계마다 2타(위 GOV 사다리와 같은 걸음). 번호와 내용 사이는 1타.
 *
 * GOV 와 갈라 두는 이유는 값이 아니라 **어디에 담겨 있느냐**다. `□ ㅇ - ·` 는 blocks 의 `glyph`
 * 에 담겨 기호를 보고 단계를 알 수 있지만, 번호 항목은 문단 글자의 일부라 글머리에서 알아내야
 * 한다(사용자 2026-09-22: 편람의 2타 규칙을 참고 문서의 관행 4타보다 우선한다).
 */
const MANUAL_MARKER_INDENT: [RegExp, number][] = [
  [/^\d+\./, 0],
  [/^[가나다라마바사아자차카타파하]\./, 2],
  [/^\d+\)/, 4],
  [/^[가나다라마바사아자차카타파하]\)/, 6],
  [/^\(\d+\)/, 8],
  [/^\([가나다라마바사아자차카타파하]\)/, 10],
  [/^[①-⑳]/, 12], // ① … ⑳
  [/^[㉮-㉻]/, 14], // ㉮ … ㉻
];

/**
 * 문단 첫 글자의 편람 번호 표지가 가리키는 들여쓰기(반각 공백 수). 표지가 없으면 undefined.
 *
 * 한글 표지는 편람이 쓰는 14 글자로 못 박는다 — `[가-힣]` 으로 열어 두면 `사. ` 로 시작하는
 * 보통 문장("사. 업 …" 같은 오타)까지 항목으로 읽는다. 표지 뒤에는 공백이나 줄 끝이 와야 한다
 * (편람의 1타 규칙) — `1.5배` 같은 글이 항목으로 둔갑하지 않게 한다.
 */
export function manualMarkerIndent(text: string): number | undefined {
  for (const [re, indent] of MANUAL_MARKER_INDENT) {
    const m = re.exec(text);
    if (m && (text.length === m[0].length || /\s/.test(text[m[0].length]))) return indent;
  }
  return undefined;
}

export function leadingSpaces(family: Family, glyph: Glyph | undefined, role: ParaRole, ladder: Ladder = "gepa"): number {
  if (!glyph || glyph === "none") return role === "greeting" ? 2 : 0;
  const t = ladder === "gov" ? GOV : DOC_FAMILIES[family].indent;
  return t[glyph] ?? 0;
}

/** Indent of a ※/* note that annotates the previous item (편람: 딸린 항목의 내용 첫 글자 위치). */
export function noteIndentUnder(family: Family, prevGlyph: string | undefined, ladder: Ladder = "gepa"): number | undefined {
  if (!prevGlyph) return undefined;
  if (ladder === "gov") return (GOV[prevGlyph] ?? 0) + 2;
  if (prevGlyph === "ㅇ" || prevGlyph === "○" || prevGlyph === "◦" || prevGlyph === "-") return DOC_FAMILIES[family].noteIndentUnderItem;
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
