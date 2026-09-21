/**
 * 행정업무운영 편람(2025) 문서 작성 기준 린터 — docs/design-system/gov-manual.md §2–§4.
 * DocModel(any family)을 훑어 규정 위반을 경고로 낸다. 결정적(deterministic) 검사만 한다;
 * 문체·용어 순화는 검토 에이전트의 몫이다.
 */
import type { Block, DocModel, Inline } from "./schema";
import { inlineText } from "./schema";
import { DOC_FAMILIES } from "./families";

export interface GovLintIssue {
  blockId?: string;
  rule: string;
  /** "warn" = 규정 위반, "info" = 관행상 흔하지만 편람이 권하지 않는 형태 */
  severity: "warn" | "info";
  message: string;
  /** suggested replacement text when it can be derived mechanically */
  fix?: string;
}

const NOTE_GLYPHS = new Set(["※", "*"]);
const ITEM_GLYPHS = new Set(["□", "■", "ㅇ", "○", "◦", "-", "·", "∙", "▪", "❍", "✔"]);
const LEVEL: Record<string, number> = { "□": 1, "■": 1, "ㅇ": 2, "○": 2, "◦": 2, "❍": 2, "✔": 2, "-": 3, "·": 4, "∙": 4, "▪": 4 };

/** 2021.12.12. / 2021.12.12 / 2021. 12. 12 (missing trailing period) / 2023. 6. 27(화) / 1985. 09. 06. */
const DATE_NO_SPACE = /(?<![\d.])(\d{4}|’\d{2})\.(\d{1,2})\.(\d{1,2})\.?(?![\d.])/g;
const DATE_NO_TRAILING_PERIOD = /(?<![\d.])(\d{4}|’\d{2})\. (\d{1,2})\. (\d{1,2})(?=\s*[(\s,~]|$)/g;
const DATE_ZERO_PADDED = /(?<![\d.])(\d{4}|’\d{2})\. 0(\d)\. |(?<![\d.])(\d{4}|’\d{2})\. (\d{1,2})\. 0(\d)\./g;
const COLON_SPACED = /(\S) :(?=\s)/g;
const TILDE_SPACED = /(\S) ~ (?=\S)|(\S) ~(?=\S)|(\S)~ (?=\S)/g;
const KOREAN_TIME = /(오전|오후)\s?\d{1,2}시(\s?\d{1,2}분)?/g;
const AMOUNT_WON = /금\s?\d{1,3}(,\d{3})+원(?!\()/g;
const AMOUNT_NO_COMMA = /금\d{4,}원/g;

function textOf(b: Block): string {
  if (b.k === "para" || b.k === "coverTitle") return inlineText(b.inlines as Inline[]);
  return "";
}

function checkText(text: string, blockId: string | undefined, out: GovLintIssue[]) {
  for (const m of text.matchAll(DATE_NO_SPACE)) {
    const [, y, mo, d] = m;
    out.push({ blockId, rule: "날짜 띄어쓰기", severity: "warn", message: `날짜 "${m[0]}"는 연·월·일 마침표 뒤에 한 타를 띄운다`, fix: `${y}. ${Number(mo)}. ${Number(d)}.` });
  }
  for (const m of text.matchAll(DATE_NO_TRAILING_PERIOD)) {
    const [, y, mo, d] = m;
    out.push({ blockId, rule: "날짜 마침표", severity: "warn", message: `날짜 "${m[0]}"는 일 뒤에도 마침표를 찍는다`, fix: `${y}. ${Number(mo)}. ${Number(d)}.` });
  }
  for (const m of text.matchAll(DATE_ZERO_PADDED)) out.push({ blockId, rule: "날짜 0 생략", severity: "warn", message: `날짜 "${m[0].trim()}"의 월·일 앞 0은 쓰지 않는다` });
  for (const m of text.matchAll(COLON_SPACED)) out.push({ blockId, rule: "쌍점", severity: "warn", message: `"${m[0]}" — 쌍점(:)은 앞말에 붙이고 뒷말과 띄운다`, fix: `${m[1]}: ` });
  for (const m of text.matchAll(TILDE_SPACED)) out.push({ blockId, rule: "물결표", severity: "warn", message: `"${m[0].trim()}" — 물결표(~)는 앞말·뒷말에 붙여 쓴다` });
  for (const m of text.matchAll(KOREAN_TIME)) out.push({ blockId, rule: "시간 표기", severity: "warn", message: `"${m[0]}" — 시간은 24시각제 숫자와 쌍점으로 쓴다(예: 15:20)` });
  for (const m of text.matchAll(AMOUNT_WON)) out.push({ blockId, rule: "금액 한글 병기", severity: "warn", message: `"${m[0]}" — 금액은 숫자 뒤 괄호에 한글을 병기한다(예: 금113,560원(금일십일만삼천오백육십원))` });
  for (const m of text.matchAll(AMOUNT_NO_COMMA)) out.push({ blockId, rule: "금액 자릿점", severity: "warn", message: `"${m[0]}" — 금액은 세 자리마다 쉼표를 찍는다` });
}

export function lintGovStyle(doc: DocModel): GovLintIssue[] {
  const out: GovLintIssue[] = [];
  const blocks = doc.blocks;

  // ---- text-level rules (paragraphs, table cells)
  for (const b of blocks) {
    if (b.k === "para" || b.k === "coverTitle") checkText(textOf(b), b.id, out);
    else if (b.k === "table") for (const r of b.rows) for (const c of r.cells) checkText(inlineText(c.inlines), b.id, out);
  }

  // ---- 항목 구분: 항목이 하나뿐이면 기호를 붙이지 않는다; 위계는 한 단계씩
  const items = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.k === "para" && b.glyph && ITEM_GLYPHS.has(b.glyph)) as { b: Extract<Block, { k: "para" }>; i: number }[];
  // group consecutive same-level siblings under the same parent
  let prevLevel = 0;
  for (const { b } of items) {
    const level = LEVEL[b.glyph!] ?? 0;
    if (level > prevLevel + 1 && prevLevel > 0) out.push({ blockId: b.id, rule: "항목 위계", severity: "warn", message: `"${b.glyph} …" — 하위 항목은 위계대로 한 단계씩 둔다(바로 위 항목 ${prevLevel}단계 → ${level}단계)` });
    prevLevel = level;
  }
  // lone sibling: exactly one item of a level directly under a parent, followed by the parent's next sibling or end
  for (let k = 0; k < items.length; k++) {
    const { b, i } = items[k];
    const level = LEVEL[b.glyph!] ?? 0;
    if (level <= 1) continue;
    // previous item must be the parent (one level up); next item must not be a sibling of the same level under that parent
    const prev = items[k - 1];
    if (!prev || (LEVEL[prev.b.glyph!] ?? 0) !== level - 1) continue;
    let hasSibling = false;
    for (let j = k + 1; j < items.length; j++) {
      const lv = LEVEL[items[j].b.glyph!] ?? 0;
      if (lv < level) break;
      if (lv === level) { hasSibling = true; break; }
    }
    if (!hasSibling) out.push({ blockId: b.id, rule: "항목 하나", severity: "info", message: `"${b.glyph} ${inlineText(b.inlines).slice(0, 20)}…" — 항목이 하나뿐이면 항목 기호를 붙이지 않는다(위 항목에 이어 쓰거나 항목을 둘 이상으로)` });
    void i;
  }

  // ---- 붙임 / 끝 표시 (발신 문서·내부결재문서)
  if (DOC_FAMILIES[doc.family].requiresClosingMark) {
    const last = [...blocks].reverse().find((b) => b.k === "para" || b.k === "table" || b.k === "attachmentList");
    if (last) {
      if (last.k === "attachmentList") {
        // writer appends "  끝." after the last item — fine
      } else if (last.k === "para") {
        const t = inlineText(last.inlines).trimEnd();
        if (!/끝\.$/.test(t)) out.push({ blockId: last.id, rule: "끝 표시", severity: "warn", message: "본문 마지막 글자에서 한 글자(2타) 띄우고 `끝.`을 표시한다" });
        else if (!/(\S)  끝\.$/.test(t) && !/^끝\.$/.test(t)) out.push({ blockId: last.id, rule: "끝 표시 간격", severity: "warn", message: "`끝.` 앞은 두 타(공백 2개)를 띄운다", fix: t.replace(/\s*끝\.$/, "  끝.") });
      } else if (last.k === "table") {
        out.push({ blockId: last.id, rule: "표로 끝나는 본문", severity: "warn", message: "본문이 표로 끝나면 표 아래 왼쪽 기본선에서 2타 띄우고 `끝.`을 쓴다(표 중간에서 끝나면 다음 칸에 `이하 빈칸`)" });
      }
    }
    for (const b of blocks) {
      if (b.k !== "para") continue;
      const t = inlineText(b.inlines);
      const m = /^붙임(\s*)(.*)$/.exec(t.trim());
      if (m && m[1].length !== 2) out.push({ blockId: b.id, rule: "붙임 표기", severity: "warn", message: "`붙임` 뒤에는 두 타를 띄우고 첨부물 명칭·수량을 쓴다(예: 붙임  ○○계획서 1부.  끝.)", fix: `붙임  ${m[2]}` });
    }
  }
  return out;
}

/** True when a glyph marks a ※/* note rather than a list item. */
export function isNoteGlyph(g: string | undefined): boolean {
  return !!g && NOTE_GLYPHS.has(g);
}
