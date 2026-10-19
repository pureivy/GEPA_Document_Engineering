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
// "지원금 3,677,110원" 의 '금'은 금액 표기가 아니다 — 낱말 첫머리의 '금'만 본다(2026-10-06 오탐)
const AMOUNT_WON = /(?<![가-힣])금\s?\d{1,3}(,\d{3})+원(?!\()/g;
const AMOUNT_NO_COMMA = /금\d{4,}원/g;
// 보고서 본문의 화살표 — 단계·변경·인과를 → 로 줄이지 말고 문장으로 쓴다(담당자 2026-10-07: "화살표가 너무 많다")
const ARROW = /[→⇒➡▶]/g;

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
  const arrows = text.match(ARROW)?.length ?? 0;
  if (arrows) out.push({ blockId, rule: "화살표", severity: "warn", message: `"${text.slice(0, 24)}…" — 화살표(→)로 줄이지 말고 "…에서 …로 변경", "…하여 …" 처럼 개조식 문장으로 쓴다` });
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
  // 정산보고서는 위탁기관이 정한 제출 서식이다 — 표지 "사 업 비: 금120,000,000원" 처럼 한글 병기를 하지 않는다
  // (담당자 정산보고서·서식 원문). 기안문의 편람 규칙이 서식을 고치라고 헛울리지 않게 뺀다.
  if (doc.family === "settlement") return out.filter((i) => i.rule !== "금액 한글 병기").concat(lintStructure(doc));
  return out.concat(lintStructure(doc), lintWriting(doc));
}

// ---- 공문서 기본 틀(agent/CLAUDE.md, 담당자 2026-10-19) — 개조식 항목 줄의 머리말·말투·나란한 항목
const LABEL = /^\(([^()]{1,12})\)\s*/;
/** 머리말 줄 안에서도 쓸 수 있는 괄호: 날짜 요일 (토), 금액 한글 병기 (금…원), 영문·한자 병기 (AI)(R&D)(代) */
const ALLOWED_PAREN = /\([월화수목금토일]\)|\(금[가-힣]+원\)|\([A-Za-z0-9&·.\s-]+\)|\([一-鿿]+\)/g;
const SPOKEN = /(했다|하였다|됐다|되었다|입니다|습니다|했음|하였음)\.?$|모두 (지원|완료|달성|선정)/;
const COUNT_ONLY = /^\(사업내용\)\s*(\d+개 분야\s*)?\d+개 (세부)?사업\s*$/;
/** 본문 한 줄 폭(약 38자) — 한글 1, 영문·숫자·기호 0.5 */
const LINE_WIDTH = 38;
const width = (s: string) => [...s].reduce((n, c) => n + (/[ㄱ-힣一-鿿□ㅇ※]/.test(c) ? 1 : 0.5), 0);

function lintWriting(doc: DocModel): GovLintIssue[] {
  // 보도자료 본문은 서술형 기사체다 — 종결·머리말 규칙을 적용하지 않는다
  if (doc.family === "press") return [];
  const out: GovLintIssue[] = [];
  const paras = doc.blocks.filter((b): b is Extract<Block, { k: "para" }> => b.k === "para" && !!b.glyph && ITEM_GLYPHS.has(b.glyph));
  for (const b of paras) {
    const t = inlineText(b.inlines).trim().replace(/\s*끝\.$/, "");
    const head = `"${b.glyph} ${t.slice(0, 22)}…"`;
    const label = LABEL.exec(t);
    if (label) {
      const rest = t.slice(label[0].length);
      if (/^[①-⑳]/.test(rest)) out.push({ blockId: b.id, rule: "번호·머리말 섞임", severity: "warn", message: `${head} — 괄호 머리말과 번호(①)를 한 줄에 섞지 않는다. 세부사업 번호는 표와 절 제목에서만 쓴다` });
      if (/\(/.test(rest.replace(ALLOWED_PAREN, ""))) out.push({ blockId: b.id, rule: "머리말 줄 괄호", severity: "warn", message: `${head} — 괄호 머리말을 단 줄에는 다른 괄호를 쓰지 않는다. 쉼표로 잇거나 다음 줄 ※ 로 내린다` });
    }
    if (COUNT_ONLY.test(t)) out.push({ blockId: b.id, rule: "개수만 적은 내용", severity: "warn", message: `${head} — 「N개 세부사업」처럼 개수만 쓰지 말고 무엇을 해서 무엇을 지원했는지 쓴다` });
    if (SPOKEN.test(t)) out.push({ blockId: b.id, rule: "말투", severity: "warn", message: `${head} — 말하듯 쓰지 않는다. 개조식 명사형(…지원, …달성)으로 끝내고 「모두 지원」 대신 「※ 목표 ○개, ○개 지원으로 100% 달성」` });
  }
  // 나란한 항목: 같은 기호가 이어진 줄 묶음(사이에 다른 항목 없음)
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; ) {
    const b = blocks[i];
    if (b.k !== "para" || b.glyph !== "-") { i++; continue; }
    const run: Extract<Block, { k: "para" }>[] = [];
    while (i < blocks.length && blocks[i].k === "para" && (blocks[i] as Extract<Block, { k: "para" }>).glyph === "-") run.push(blocks[i++] as Extract<Block, { k: "para" }>);
    if (run.length < 2) continue;
    const texts = run.map((p) => inlineText(p.inlines).trim().replace(/\s*끝\.$/, ""));
    const labels = texts.map((t) => LABEL.exec(t)?.[1]);
    if (labels.every((l) => l !== undefined)) {
      // 머리말 폭 맞춤 — 띄어쓰기로 글자 폭을 같게. 빈칸은 반 글자라 (판 로 확 대) = 4 + 3×0.5 = (시장 활성화) = 5 + 0.5
      const lens = new Set(labels.map((l) => width(l!)));
      if (lens.size > 1) out.push({ blockId: run[0].id, rule: "머리말 폭", severity: "info", message: `나란한 머리말 ${labels.map((l) => `(${l})`).join(" ")} — 띄어쓰기로 글자 폭을 맞춘다(예: (판 로 확 대) (시장 활성화))` });
      // 나란한 항목은 모두 한 줄 — 몇 줄만 넘치면 보기 흉하다
      const wide = run.filter((_, k) => width(`- ${texts[k]}`) > LINE_WIDTH);
      if (wide.length && wide.length < run.length) for (const p of wide) out.push({ blockId: p.id, rule: "나란한 항목 한 줄", severity: "warn", message: `"- ${inlineText(p.inlines).trim().slice(0, 22)}…" — 나란한 항목 가운데 이 줄만 두 줄로 넘친다. 뒷말을 줄여 한 줄(약 ${LINE_WIDTH}자)로` });
    }
  }
  return out;
}

function lintStructure(doc: DocModel): GovLintIssue[] {
  const out: GovLintIssue[] = [];
  const blocks = doc.blocks;

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
  // 위탁기관이 정한 서식(plan `표지: 없음` — 위탁사업 추진실적 및 정산보고서)은 기안문이 아니라 제출 서식이라
  // `끝.` 을 쓰지 않는다(실문서 ESG-1024 등). 그 문서에서 헛울리지 않게 뺀다.
  const 서식문서 = doc.family === "plan" && doc.meta.표지 === "없음";
  if (DOC_FAMILIES[doc.family].requiresClosingMark && !서식문서) {
    const last = [...blocks].reverse().find((b) => b.k === "para" || b.k === "table" || b.k === "attachmentList");
    // 공문서는 붙임을 블록이 아니라 meta.붙임 에서 펼친다(다른 family 는 ```attach 블록을 쓴다).
    // 작성기가 그 줄 끝에 "  끝." 을 찍으므로(lib/hwpx/writers/official.ts) 본문 마지막 문단에
    // 끝 표시를 요구하면 붙임 있는 모든 공문서에서 헛울린다. serialize/toText.ts:99 와 같은 조건이다.
    const 붙임_meta = doc.family === "official" && doc.meta.붙임.length > 0 && !blocks.some((b) => b.k === "attachmentList");
    if (last && !붙임_meta) {
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
