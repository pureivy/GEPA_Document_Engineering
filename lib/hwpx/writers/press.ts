/**
 * 보도자료 writer — 2026년 GEPA 보도자료 서식 (docs/design-system/press.md, 2026-02-26 참고본 실측)
 * on top of templates/press (글꼴 표·쪽 설정은 2023 참고본 패키지를 그대로 쓰고, 로고 그림만 CI 매뉴얼의 GEPA 마크로 바꿨다):
 *   머리표(4행 표): [GEPA 로고 ‖ 보도자료【26. 2. 26.】] ‖ [제공일자 / 제공부서 / 주책임자 / 담 당 자]
 *   → 전화 · FAX · 전자우편 한 줄(아래 0.4 mm 괘선)
 *   → 제목(HY헤드라인M 20pt, 최대 2줄) → 회색 괘선 → 부제(맑은 고딕 12pt 회색)
 *   → 본문 맑은 고딕 13pt 185 %: `□` 리드·인용 문단(내어쓰기) · `#` 소제목 → `■  소제목` · 일반 문단(한 칸 들여쓰기) · `ㅇ/-/·` 항목
 *   문단 사이 빈 줄은 쓰지 않는다 — 간격은 문단 위·아래 여백으로 낸다.
 */
import type { XmlNode } from "../xml";
import type { PressDoc, Block } from "../../docmodel/schema";
import { inlineText } from "../../docmodel/schema";
import { WriterContext } from "./context";
import { emitImage, emitPara, emitTable, type FamilyStyle } from "./common";
import { table, cellInteriorWidth, type CellSpec, type RowSpec } from "../emit/table";
import { pictureOf } from "../emit/picture";
import { procedureFlow } from "./notice";
import type { CharSpec, SideSpec } from "../registry";

type ParaBlock = Extract<Block, { k: "para" }>;

export const PRESS_STYLE: FamilyStyle = {
  bodyPt: 13,
  bodyLineSpacing: 185,
  body1Bold: false,
  body1Font: "table",
  notePt: 12,
  noteFont: "table",
  tableHeaderFill: "#F2F2F2",
  tableFontPt: 11,
  hangingIndent: true,
};

// ---- 참고본 실측 geometry (HWPUNIT; 1 pt = 100) ----------------------------------------
const WIDTH = 47900; // 본문 폭 48190 안에 들어가는 표 폭 (참고본 481 pt)
const HEADER_COLS = [24270, 1070, 7170, 15390]; // 로고·보도자료 블록 | 빈 칸 | 라벨 | 값  (Σ 47900)
const HEADER_ROW = 2000; // 4행 × 20 pt
const CONTACT_ROW = 2030;
const CELL_MARGIN = { l: 141, r: 141, t: 141, b: 141 };
/** templates/press/pkg/BinData/image1.png — CI 매뉴얼 기본로고에서 뽑은 GEPA 마크(흰 바탕). 27 mm 폭으로 놓는다. */
const LOGO = { id: "image1", px: { width: 1127, height: 366 }, widthHwp: 7650 };
/** 기관 대표 FAX — front-matter 에 `팩스` 가 없을 때 참고본(2026-02-26)의 값을 쓴다 */
const DEFAULT_FAX = "054.472.2989";

const MALGUN = "맑은 고딕";
const HEADLINE = "HY헤드라인M";
const GOTHIC_B = "HY견고딕";
const MOUM = "휴먼모음T";

const BODY_CHAR: CharSpec = { font: MALGUN, pt: 13 };
const LABEL_CHAR: CharSpec = { font: MALGUN, pt: 12 };
const LOGOTYPE_CHAR: CharSpec = { font: HEADLINE, pt: 35 };
const DATE_CHAR: CharSpec = { font: MOUM, pt: 15 };
const CONTACT_CHAR: CharSpec = { font: GOTHIC_B, pt: 12, spacing: -4 }; // 참고본 13pt 지만 한 줄에 들어가도록 살짝 조임
const TITLE_CHAR: CharSpec = { font: HEADLINE, pt: 20 };
const SUBTITLE_CHAR: CharSpec = { font: MALGUN, pt: 12, color: "#808080" };
const TITLE_LINE = 3300; // 20 pt × 165 %
/** 글자 수 안내(공백 포함): 제목 20pt 는 한 줄 약 24자, 두 줄까지 허용. 부제 12pt 는 한 줄 */
export const TITLE_LIMITS = { title: { plain: 24, max: 48 }, subtitle: { plain: 40, max: 48 } } as const;

const solid = (widthMm: number, color = "#000000"): SideSpec => ({ type: "SOLID", widthMm, color });
const NONE: SideSpec = "none";
const THICK = solid(0.4);
const THIN = solid(0.12);

const GLYPH_ROLES = new Set(["body1", "body2", "body3", "body4"]);
const PREFIX: Record<string, { text: string; hanging: number }> = {
  body1: { text: "□ ", hanging: 1950 },
  body2: { text: "  • ", hanging: 2600 },
  body3: { text: "    - ", hanging: 3900 },
  body4: { text: "      · ", hanging: 5200 },
};

export function writePress(ctx: WriterContext, doc: PressDoc): XmlNode[] {
  const out: XmlNode[] = [];
  const fs = PRESS_STYLE;
  const blocks = doc.blocks;
  let lead = true; // 부제 다음 첫 본문 문단 — 위 여백을 더 둔다
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    switch (b.k) {
      case "pressHeader":
        out.push(pressHeader(ctx, doc), contactLine(ctx, doc));
        break;
      case "sectionBar":
        out.push(sectionHeading(ctx, b.title));
        break;
      case "para":
        if (b.role === "pressTitle") {
          const next = blocks[i + 1];
          const sub = next && next.k === "para" && next.role === "pressSubtitle" ? next : undefined;
          if (sub) i++;
          out.push(...titleBlock(ctx, b, sub));
        } else if (b.role === "pressSubtitle") {
          out.push(...titleBlock(ctx, undefined, b));
        } else if (b.role === "pressContact") {
          const paraPr = ctx.reg.paraPr({ align: "RIGHT", lineSpacing: 150, prev: 1000 });
          out.push(ctx.para({ paraPr, runs: ctx.runsFor(b.inlines, { font: MALGUN, pt: 12 }), vertsize: 1200, lineSpacing: 150, forcePageBreak: b.pageBreakBefore }));
        } else if (b.role === "pressBody" || b.role === "pressLead" || b.role === "plain") {
          out.push(bodyPara(ctx, b, lead));
          lead = false;
        } else if (GLYPH_ROLES.has(b.role) && b.glyph && b.glyph !== "none") {
          out.push(glyphPara(ctx, b, lead));
          lead = false;
        } else {
          out.push(emitPara(ctx, fs, b));
        }
        break;
      case "blank":
        // 새 서식은 문단 사이 빈 줄이 없다 — 작성자가 넣은 빈 줄은 무시한다(간격은 문단 여백)
        break;
      case "pageBreak":
        ctx.pendingPageBreak = true;
        break;
      case "image": {
        const n = emitImage(ctx, fs, b);
        if (n) out.push(n);
        break;
      }
      case "table":
        out.push(...emitTable(ctx, fs, b));
        break;
      case "procedureFlow":
        out.push(...procedureFlow(ctx, b));
        break;
      case "attachmentList": {
        const paraPr = ctx.reg.paraPr({ align: "JUSTIFY", lineSpacing: 185, prev: 1000 });
        b.items.forEach((it, k) => {
          const text = (k === 0 ? `붙임  ${it}` : `      ${it}`) + (k === b.items.length - 1 ? "  끝." : "");
          out.push(ctx.para({ paraPr: k === 0 ? paraPr : ctx.reg.paraPr({ align: "JUSTIFY", lineSpacing: 185 }), runs: ctx.runsFor([{ t: "text", text }], BODY_CHAR), vertsize: 1300, lineSpacing: 185 }));
        });
        break;
      }
      default:
        ctx.warnings.push({ blockId: b.id, message: `block kind "${b.k}" is not supported in 보도자료; skipped` });
    }
  }
  return out;
}

// ---- 본문 문단 ----------------------------------------------------------------------------

/** 일반 문단 — 맑은 고딕 13pt 양쪽 정렬 185 %, 첫 줄은 한 칸(반각 공백) 들여 쓰고 둘째 줄부터 6.3 pt 내어쓰기 */
function bodyPara(ctx: WriterContext, b: ParaBlock, lead: boolean): XmlNode {
  const align = b.align && b.align !== "both" ? (b.align.toUpperCase() as "LEFT" | "CENTER" | "RIGHT") : "JUSTIFY";
  const paraPr = ctx.reg.paraPr({ align, lineSpacing: 185, hanging: align === "JUSTIFY" ? 630 : undefined, prev: lead ? 1800 : 0 });
  const inlines = align === "JUSTIFY" ? [{ t: "text" as const, text: " " }, ...b.inlines] : b.inlines;
  return ctx.para({ paraPr, runs: ctx.runsFor(inlines, BODY_CHAR), vertsize: 1300, lineSpacing: 185, forcePageBreak: b.pageBreakBefore });
}

/** `□` 리드·인용 문단과 `ㅇ/-/·` 항목 — 글자 표지 뒤에 줄을 맞추는 내어쓰기 */
function glyphPara(ctx: WriterContext, b: ParaBlock, lead: boolean): XmlNode {
  const p = PREFIX[b.role] ?? PREFIX.body2;
  const prev = b.role === "body1" ? (lead ? 1800 : 1000) : 0;
  const paraPr = ctx.reg.paraPr({ align: "JUSTIFY", lineSpacing: 185, hanging: p.hanging, prev });
  const runs = ctx.runsFor([{ t: "text", text: p.text }, ...b.inlines], BODY_CHAR);
  return ctx.para({ paraPr, runs, vertsize: 1300, lineSpacing: 185, forcePageBreak: b.pageBreakBefore });
}

/** `#` 소제목 → `■  소제목` (본문과 같은 13pt, 위 10 pt · 아래 5 pt) */
function sectionHeading(ctx: WriterContext, title: string, pageBreak?: boolean): XmlNode {
  const paraPr = ctx.reg.paraPr({ align: "JUSTIFY", lineSpacing: 185, hanging: 2600, prev: 1000, next: 500, keepWithNext: true });
  return ctx.para({ paraPr, runs: ctx.runsFor([{ t: "text", text: `■  ${title}` }], BODY_CHAR), vertsize: 1300, lineSpacing: 185, forcePageBreak: pageBreak });
}

// ---- 머리표 -------------------------------------------------------------------------------

const TITLES = new Set(["담당", "책임", "실장", "팀장", "과장", "부장", "원장", "소장", "차장", "국장", "처장", "대리", "주임", "사원", "선임", "주무관", "사무관", "담당관", "연구원", "본부장", "센터장", "지소장", "단장", "전문위원", "선임연구원", "책임연구원"]);

/** Split "실장 남상범" / "김OO 팀장" / "박용식" into a title label and a name (3-char names ending in 원/장 stay names). */
export function splitPerson(s: string, fallbackLabel: string): { label: string; name: string } {
  const tokens = s.trim().split(/\s+/);
  const isTitle = (t: string) => TITLES.has(t) || (t.length === 2 && /(장|관|원|리|임|사)$/.test(t));
  if (tokens.length >= 2 && isTitle(tokens[0])) return { label: tokens[0], name: tokens.slice(1).join(" ") };
  if (tokens.length >= 2 && isTitle(tokens[tokens.length - 1])) return { label: tokens[tokens.length - 1], name: tokens.slice(0, -1).join(" ") };
  return { label: fallbackLabel, name: s.trim() };
}

/** 머리표 사람 칸 — 새 서식은 "이름 직위"(장은영 팀장) 순서. "실장 남상범" 도 "남상범 실장" 으로 뒤집는다. */
export function personName(s: string | undefined): string {
  if (!s || !s.trim()) return "";
  const { label, name } = splitPerson(s, "");
  return label ? `${name} ${label}` : name;
}

/** 제공일자 — "2026. 7. 1.(수)" / "26. 7. 1" → "2026. 7. 1." (연도 네 자리, 요일 없이, 마침표로 끝) */
export function provideDate(배포일: string): string {
  const m = 배포일.trim().match(/(\d{2,4})\s*[.년]\s*(\d{1,2})\s*[.월]\s*(\d{1,2})/);
  if (!m) return 배포일.trim();
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${y}. ${Number(m[2])}. ${Number(m[3])}.`;
}

/** 보도자료 로고타입 옆 【26. 2. 26.】 — 연도 두 자리 */
export function headerDate(배포일: string): string {
  return provideDate(배포일).replace(/^(19|20)(\d{2})\./, "$2.");
}

/** 전화번호 표기 — 참고본은 "054.470.8527" (붙임표 대신 마침표) */
export function dottedPhone(s: string): string {
  return s.trim().replace(/-/g, ".");
}

function pressHeader(ctx: WriterContext, doc: PressDoc): XmlNode {
  const m = doc.meta;
  const cols = HEADER_COLS;
  const bf = (l: SideSpec, r: SideSpec, t: SideSpec, b: SideSpec) => ctx.reg.borderFill({ l, r, t, b });
  const interior = (col: number, span = 1) => cellInteriorWidth(cols.slice(col, col + span).reduce((a, b) => a + b, 0), CELL_MARGIN);

  const textCell = (col: number, borderFill: number, text: string): CellSpec => {
    const paraPr = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 160 });
    return {
      col,
      borderFill,
      margin: CELL_MARGIN,
      vertAlign: "CENTER",
      paragraphs: [ctx.cellPara({ paraPr, runs: ctx.runsFor([{ t: "text", text }], LABEL_CHAR), vertsize: 1200, lineSpacing: 160, horzsize: interior(col) })],
    };
  };

  // 좌측 블록: 로고(1~2행) / 보도자료【배포일】(3~4행)
  const logoCell: CellSpec = { col: 0, rowSpan: 2, borderFill: bf(THICK, THICK, THICK, THICK), margin: CELL_MARGIN, vertAlign: "CENTER", paragraphs: [logoPara(ctx, interior(0))] };
  const logotypeCell: CellSpec = { col: 0, rowSpan: 2, borderFill: bf(THICK, THICK, THICK, THICK), margin: CELL_MARGIN, vertAlign: "CENTER", paragraphs: [logotypePara(ctx, interior(0), m.배포일)] };
  const gapCell: CellSpec = {
    col: 1,
    rowSpan: 4,
    borderFill: bf(NONE, NONE, NONE, NONE),
    margin: CELL_MARGIN,
    paragraphs: [ctx.cellPara({ paraPr: ctx.reg.paraPr({ align: "CENTER", lineSpacing: 100 }), runs: [{ charPr: ctx.reg.charPr(LABEL_CHAR), text: "" }], vertsize: 1000, lineSpacing: 100, horzsize: interior(1) })],
  };
  const rowsSpec: [string, string][] = [
    ["제공일자", provideDate(m.배포일)],
    ["제공부서", m.담당부서],
    ["주책임자", personName(m.책임자)],
    ["담 당 자", personName(m.담당자)],
  ];
  const rows: RowSpec[] = rowsSpec.map(([label, value], r) => {
    const t = r === 0 ? THICK : THIN;
    const b = r === rowsSpec.length - 1 ? THICK : THIN;
    const cells: CellSpec[] = [];
    if (r === 0) cells.push(logoCell, gapCell);
    if (r === 2) cells.push(logotypeCell);
    cells.push(textCell(2, bf(THICK, THIN, t, b), label));
    cells.push(textCell(3, bf(THIN, THICK, t, b), value));
    return { height: HEADER_ROW, cells };
  });

  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols,
    rows,
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: { l: 140, r: 140, t: 140, b: 140 },
    outMargin: { l: 141, r: 141, t: 141, b: 141 },
    pageBreak: "NONE",
  });
  const height = HEADER_ROW * rows.length;
  const anchor = ctx.reg.paraPr({ align: "JUSTIFY", lineSpacing: 100 });
  return ctx.para({ paraPr: anchor, runs: [{ charPr: ctx.reg.charPr(LABEL_CHAR), nodes: [tbl] }], vertsize: height, lineSpacing: 100 });
}

function logoPara(ctx: WriterContext, horz: number): XmlNode {
  const h = Math.round((LOGO.widthHwp * LOGO.px.height) / LOGO.px.width);
  const hasBin = Object.keys(ctx.tpl.files).some((f) => f.startsWith(`BinData/${LOGO.id}.`));
  const paraPr = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 100 });
  if (!hasBin) {
    ctx.warnings.push({ message: "press template: GEPA 로고(image1) 가 없어 기관명 글자로 대신합니다" });
    return ctx.cellPara({ paraPr, runs: ctx.runsFor([{ t: "text", text: "경상북도경제진흥원" }], { font: HEADLINE, pt: 16 }), vertsize: 1600, lineSpacing: 100, horzsize: horz });
  }
  const pic = pictureOf(LOGO.id, LOGO.px, { width: LOGO.widthHwp, height: h }, { id: ctx.ids.nextShapeId(), instid: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder() });
  return ctx.cellPara({ paraPr, runs: [{ charPr: ctx.reg.charPr(LABEL_CHAR), nodes: [pic] }], vertsize: h, lineSpacing: 100, horzsize: horz });
}

/** "보도자료" (HY헤드라인M 35pt) 와 【26. 2. 26.】(휴먼모음T 15pt) 를 한 줄에, 왼쪽 맞춤 */
function logotypePara(ctx: WriterContext, horz: number, 배포일: string): XmlNode {
  const paraPr = ctx.reg.paraPr({ align: "LEFT", lineSpacing: 100 });
  const runs = [
    { charPr: ctx.reg.charPr(LOGOTYPE_CHAR), text: "보도자료" },
    { charPr: ctx.reg.charPr(DATE_CHAR), text: `【${headerDate(배포일)}】` },
  ];
  return ctx.cellPara({ paraPr, runs, vertsize: 3500, lineSpacing: 100, horzsize: horz });
}

/** 머리표 아래 "전화: … / FAX: … / 전자우편: …" — HY견고딕 13pt 가운데, 아래 0.4 mm 괘선 */
function contactLine(ctx: WriterContext, doc: PressDoc): XmlNode {
  const m = doc.meta;
  const parts = [`전화: ${dottedPhone(m.연락처)}`, `FAX: ${dottedPhone(m.팩스 || DEFAULT_FAX)}`];
  if (m.이메일) parts.push(`전자우편: ${m.이메일}`);
  const horz = cellInteriorWidth(WIDTH, CELL_MARGIN);
  const paraPr = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 130 });
  const cell: CellSpec = {
    col: 0,
    borderFill: ctx.reg.borderFill({ l: NONE, r: NONE, t: NONE, b: THICK }),
    margin: CELL_MARGIN,
    vertAlign: "CENTER",
    paragraphs: [ctx.cellPara({ paraPr, runs: ctx.runsFor([{ t: "text", text: parts.join(" / ") }], CONTACT_CHAR), vertsize: 1300, lineSpacing: 130, horzsize: horz })],
  };
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [WIDTH],
    rows: [{ height: CONTACT_ROW, cells: [cell] }],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: CELL_MARGIN,
    outMargin: { l: 141, r: 141, t: 141, b: 141 },
    pageBreak: "NONE",
  });
  const anchor = ctx.reg.paraPr({ align: "JUSTIFY", lineSpacing: 100 });
  return ctx.para({ paraPr: anchor, runs: [{ charPr: ctx.reg.charPr(CONTACT_CHAR), nodes: [tbl] }], vertsize: CONTACT_ROW, lineSpacing: 100 });
}

// ---- 제목 ---------------------------------------------------------------------------------

/** Approximate advance width (HWPUNIT) of a title line: 한글 1 em, 숫자·영문·문장부호 0.6 em (HY헤드라인M) */
export function titleWidth(ctx: WriterContext, text: string, pt: number, ratio = 100, spacing = 0): number {
  let w = 0;
  for (const ch of text) w += ctx.textWidth(ch, pt) === pt * 100 ? pt * 100 : pt * 60;
  const n = [...text].length;
  return Math.round((w * ratio) / 100 + (n * pt * 100 * spacing) / 100);
}

/** 새 서식은 제목을 줄이지 않고 두 줄까지 그대로 보낸다 — 호환용으로 남겨 둔 함수(항상 기본값) */
export function fitTitle(_ctx: WriterContext, _text: string, _pt: number, _cellWidth: number): { ratio: number; spacing: number } {
  return { ratio: 100, spacing: 0 };
}

/** 제목 상자(1×1 표, 아래 회색 0.4 mm 괘선) + 부제 문단 */
function titleBlock(ctx: WriterContext, title: ParaBlock | undefined, subtitle: ParaBlock | undefined): XmlNode[] {
  const out: XmlNode[] = [];
  const horz = cellInteriorWidth(WIDTH, CELL_MARGIN);
  const paragraphs: XmlNode[] = [];
  let lines = 1;
  if (title) {
    const text = inlineText(title.inlines);
    const paraPr = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 165 });
    paragraphs.push(ctx.cellPara({ paraPr, runs: ctx.runsFor(title.inlines, TITLE_CHAR), vertsize: 2000, lineSpacing: 165, horzsize: horz }));
    lines = Math.max(1, Math.ceil(titleWidth(ctx, text, TITLE_CHAR.pt) / (horz - TITLE_CHAR.pt * 100)));
    if (lines > 2) ctx.warnings.push({ blockId: title.id, message: `제목이 ${[...text].length}자라 두 줄(최대 ${TITLE_LIMITS.title.max}자, 권장 한 줄 ${TITLE_LIMITS.title.plain}자 이하)을 넘깁니다` });
  } else {
    paragraphs.push(ctx.cellPara({ paraPr: ctx.reg.paraPr({ align: "CENTER", lineSpacing: 165 }), runs: [{ charPr: ctx.reg.charPr(TITLE_CHAR), text: "" }], vertsize: 2000, lineSpacing: 165, horzsize: horz }));
  }
  const height = lines * TITLE_LINE + 282 + 600;
  const cellBf = ctx.reg.borderFill({ l: NONE, r: NONE, t: NONE, b: solid(0.4, "#A6A6A6") });
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [WIDTH],
    rows: [{ height, cells: [{ col: 0, borderFill: cellBf, margin: { ...CELL_MARGIN, b: 441 }, vertAlign: "CENTER", paragraphs }] }],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: CELL_MARGIN,
    outMargin: { l: 140, r: 140, t: 140, b: 140 },
    pageBreak: "NONE",
  });
  const anchor = ctx.reg.paraPr({ align: "JUSTIFY", lineSpacing: 100, prev: 800 });
  out.push(ctx.para({ paraPr: anchor, runs: [{ charPr: ctx.reg.charPr(TITLE_CHAR), nodes: [tbl] }], vertsize: height, lineSpacing: 100, forcePageBreak: title?.pageBreakBefore }));
  if (subtitle) {
    const text = inlineText(subtitle.inlines);
    if ([...text].length > TITLE_LIMITS.subtitle.max) ctx.warnings.push({ blockId: subtitle.id, message: `부제가 ${[...text].length}자라 한 줄(최대 ${TITLE_LIMITS.subtitle.max}자)을 넘길 수 있습니다` });
    const paraPr = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 160, prev: 500 });
    out.push(ctx.para({ paraPr, runs: ctx.runsFor(subtitle.inlines, SUBTITLE_CHAR), vertsize: 1200, lineSpacing: 160 }));
  }
  return out;
}
