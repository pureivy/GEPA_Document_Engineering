/**
 * 보도자료 writer — reproduces the 2023.02.17 GEPA press-release layout
 * (docs/design-system/press.md) on top of templates/press (the reference HWPX itself):
 *   머리표 5-column table (GEPA 로고 · 보도자료 로고타입 + 【배포일】 · 담당부서/작성자/연락처)
 *   → blue-ruled title box (제목 18pt B 자간 −20 / 부제 18pt B 장평 98 자간 −6)
 *   → 함초롬바탕 15pt 180% body paragraphs
 *   → consecutive □/ㅇ/- items become one grey (#F2F2F2) box: "□ 소제목"(bold) / "  • 항목" / "    - 세부" 14pt lines.
 */
import type { XmlNode } from "../xml";
import type { PressDoc, Block, Inline } from "../../docmodel/schema";
import { inlineText } from "../../docmodel/schema";
import { WriterContext } from "./context";
import { emitBlank, emitImage, emitPara, emitTable, type FamilyStyle } from "./common";
import { table, cellInteriorWidth, type CellSpec, type RowSpec } from "../emit/table";
import { pictureFrom, pictureSize } from "../emit/picture";
import { procedureFlow } from "./notice";
import type { CharSpec, SideSpec } from "../registry";

type ParaBlock = Extract<Block, { k: "para" }>;

export const PRESS_STYLE: FamilyStyle = {
  bodyPt: 15,
  bodyLineSpacing: 180,
  body1Bold: false,
  body1Font: "batang",
  notePt: 13,
  noteFont: "batang",
  tableHeaderFill: "#F2F2F2",
  tableFontPt: 11,
  hangingIndent: false,
};

// ---- reference geometry (HWPUNIT) --------------------------------------------------------
const HEADER_COLS = [8496, 11922, 6018, 4849, 16452]; // Σ 47737
const HEADER_ROW_FIRST = 1880;
const HEADER_ROW = 1680;
const TITLE_WIDTH = 47909;
const TITLE_MIN_HEIGHT = 3200; // one 18pt line at 160 % + cell margins
const BOX_WIDTH = 47905;
const CELL_MARGIN = { l: 141, r: 141, t: 141, b: 141 };
const BOX_MARGIN = { l: 510, r: 510, t: 141, b: 141 };

// 제목/부제 default 장평 100 % · 자간 0 %; fitTitle() squeezes within [ratio ≥ 90, spacing ≥ −20] to keep one line
const TITLE_CHAR: CharSpec = { font: "batang", pt: 18, bold: true, spacing: 0, ratio: 100 };
const SUBTITLE_CHAR: CharSpec = { font: "batang", pt: 16, bold: true, spacing: 0, ratio: 100 }; // user: 부제 16pt (2026-09-16)
const FIT_MIN_RATIO = 90;
const FIT_MIN_SPACING = -20;
/** character budgets (공백 포함) that fit one line: 제목 18pt ≤ 26자 at 100/0, ≤ 36자 squeezed; 부제 16pt ≤ 30자 / ≤ 42자 */
export const TITLE_LIMITS = { title: { plain: 26, max: 36 }, subtitle: { plain: 30, max: 42 } } as const;
const BODY_CHAR: CharSpec = { font: "batang", pt: 15 };
const BOX_CHAR: CharSpec = { font: "batang", pt: 14, spacing: -5, ratio: 98 };
const LABEL_CHAR: CharSpec = { font: "body", pt: 14, spacing: -5, ratio: 95 };
const VALUE_CHAR: CharSpec = { font: "body", pt: 14, ratio: 95 };
const DATE_CHAR: CharSpec = { font: "moum", pt: 15, spacing: -4 };

const solid = (widthMm: number): SideSpec => ({ type: "SOLID", widthMm, color: "#000000" });
const DOUBLE: SideSpec = { type: "DOUBLE_SLIM", widthMm: 0.5, color: "#000000" };

const BULLET_ROLES = new Set(["body1", "body2", "body3", "body4"]);
function isBulletItem(b: Block): boolean {
  return b.k === "para" && BULLET_ROLES.has(b.role) && !!b.glyph && b.glyph !== "none";
}

export function writePress(ctx: WriterContext, doc: PressDoc): XmlNode[] {
  const out: XmlNode[] = [];
  const fs = PRESS_STYLE;
  const blocks = doc.blocks;
  let firstBody = true;
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    // consecutive glyph items → one grey bullet box
    if (isBulletItem(b)) {
      const group: ParaBlock[] = [];
      while (i < blocks.length && isBulletItem(blocks[i])) group.push(blocks[i++] as ParaBlock);
      out.push(bulletBox(ctx, group));
      continue;
    }
    i++;
    switch (b.k) {
      case "pressHeader":
        out.push(pressHeader(ctx, doc));
        break;
      case "para":
        if (b.role === "pressTitle") {
          const next = blocks[i];
          const sub = next && next.k === "para" && next.role === "pressSubtitle" ? next : undefined;
          if (sub) i++;
          out.push(titleBox(ctx, b, sub));
        } else if (b.role === "pressSubtitle") {
          out.push(titleBox(ctx, undefined, b));
        } else if (b.role === "pressBody" || b.role === "pressLead" || b.role === "plain") {
          out.push(bodyPara(ctx, b, firstBody));
          firstBody = false;
        } else if (b.role === "pressContact") {
          const paraPr = ctx.reg.paraPr({ align: "RIGHT", lineSpacing: 150 });
          out.push(ctx.para({ paraPr, runs: ctx.runsFor(b.inlines, { font: "batang", pt: 13 }), vertsize: 1300, lineSpacing: 150, forcePageBreak: b.pageBreakBefore }));
        } else {
          out.push(emitPara(ctx, fs, b));
        }
        break;
      case "blank":
        out.push(emitBlank(ctx, fs, b.role === "blankSmall"));
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
        out.push(procedureFlow(ctx, b));
        break;
      case "attachmentList": {
        const r = ctx.roleOr("pressBody", { para: { align: "JUSTIFY", lineSpacing: 180 }, char: BODY_CHAR });
        b.items.forEach((it, k) => {
          const text = (k === 0 ? `붙임  ${it}` : `      ${it}`) + (k === b.items.length - 1 ? "  끝." : "");
          out.push(ctx.para({ paraPr: r.paraPr, runs: [{ charPr: r.charPr, text }], vertsize: 1500, lineSpacing: 180 }));
        });
        break;
      }
      default:
        ctx.warnings.push({ blockId: b.id, message: `block kind "${b.k}" is not supported in 보도자료; skipped` });
    }
  }
  return out;
}

/** 함초롬바탕 15pt, justify, 180 %; the first body paragraph carries the reference's 1000 HWPUNIT space-before. */
function bodyPara(ctx: WriterContext, b: ParaBlock, first: boolean): XmlNode {
  const role = ctx.roleOr(first ? "pressLead" : "pressBody", { para: { align: "JUSTIFY", lineSpacing: 180, prev: first ? 1000 : 0 }, char: BODY_CHAR });
  const paraPr = b.align && b.align !== "both" ? ctx.reg.paraPr({ align: b.align.toUpperCase() as "LEFT" | "CENTER" | "RIGHT", lineSpacing: 180 }) : role.paraPr;
  const runs = ctx.runsFor(b.inlines, BODY_CHAR, role.charPr);
  return ctx.para({ paraPr, runs, vertsize: 1500, lineSpacing: 180, forcePageBreak: b.pageBreakBefore });
}

const TITLES = new Set(["담당", "책임", "실장", "팀장", "과장", "부장", "원장", "소장", "차장", "국장", "처장", "대리", "주임", "사원", "선임", "주무관", "사무관", "담당관", "연구원", "본부장", "센터장", "지소장", "전문위원", "선임연구원", "책임연구원"]);

/** Split "실장 남상범" / "김OO 팀장" / "박용식" into a 작성자 row label and a name (3-char names ending in 원/장 stay names). */
export function splitPerson(s: string, fallbackLabel: string): { label: string; name: string } {
  const tokens = s.trim().split(/\s+/);
  const isTitle = (t: string) => TITLES.has(t) || (t.length === 2 && /(장|관|원|리|임|사)$/.test(t));
  if (tokens.length >= 2 && isTitle(tokens[0])) return { label: tokens[0], name: tokens.slice(1).join(" ") };
  if (tokens.length >= 2 && isTitle(tokens[tokens.length - 1])) return { label: tokens[tokens.length - 1], name: tokens.slice(0, -1).join(" ") };
  return { label: fallbackLabel, name: s.trim() };
}

/** "2027. 3. 15.(월)" → "27. 3. 15(월)" — the reference writes a 2-digit year and no period before the weekday, so the date stays on one line. */
export function headerDate(배포일: string): string {
  return 배포일
    .trim()
    .replace(/^(19|20)(\d{2})\s*[.년]/, "$2.")
    .replace(/\.\s*\(/, "(")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "");
}

/** 머리표: 로고 | 보도자료 로고타입 + 【배포일】 ‖ 담당부서 / 작 성 자 (실장·담당·이메일) / 연 락 처 */
function pressHeader(ctx: WriterContext, doc: PressDoc): XmlNode {
  const m = doc.meta;
  const cols = HEADER_COLS;
  const label = ctx.roleOr("headerLabel", { para: { align: "CENTER", lineSpacing: 160 }, char: LABEL_CHAR });
  const value = ctx.roleOr("headerValue", { para: { align: "CENTER", lineSpacing: 160 }, char: VALUE_CHAR });
  const bf = (l: SideSpec, r: SideSpec, t: SideSpec, b: SideSpec) => ctx.reg.borderFill({ l, r, t, b });

  const textCell = (col: number, colSpan: number, rowSpan: number, borderFill: number, role: { paraPr: number; charPr: number }, base: CharSpec, text: string): CellSpec => {
    const w = cols.slice(col, col + colSpan).reduce((a, b) => a + b, 0);
    return {
      col,
      colSpan,
      rowSpan,
      borderFill,
      margin: CELL_MARGIN,
      paragraphs: [ctx.cellPara({ paraPr: role.paraPr, runs: ctx.runsFor([{ t: "text", text }], base, role.charPr), vertsize: 1400, lineSpacing: 160, horzsize: cellInteriorWidth(w, CELL_MARGIN) })],
    };
  };

  // rows after the 담당부서 row: 실장 (책임자, blank when unknown) / 담당 이름 (이메일), then 연락처
  const chief = m.책임자 ? splitPerson(m.책임자, "실장") : { label: "실장", name: "" };
  const staff = splitPerson(m.담당자, "담당");
  const authors = [chief, { label: staff.label, name: m.이메일 ? `${staff.name} (${m.이메일})` : staff.name }];
  const authorRows = authors.length;
  const rowCount = 1 + authorRows + 1;
  const heights = [HEADER_ROW_FIRST, ...Array.from({ length: rowCount - 1 }, () => HEADER_ROW)];

  const rows: RowSpec[] = [];
  // row 0: 담당부서
  rows.push({
    height: heights[0],
    cells: [
      logoCell(ctx, cols[0], rowCount, bf(solid(0.4), solid(0.2), solid(0.4), solid(0.4))),
      logotypeCell(ctx, cols[1], rowCount, bf(solid(0.2), DOUBLE, solid(0.4), solid(0.4)), m.배포일),
      textCell(2, 1, 1, bf(DOUBLE, solid(0.2), solid(0.4), solid(0.12)), label, LABEL_CHAR, "담당부서"),
      textCell(3, 2, 1, bf(solid(0.2), solid(0.4), solid(0.4), solid(0.12)), value, VALUE_CHAR, m.담당부서),
    ],
  });
  // 작성자 rows
  authors.forEach((a, k) => {
    const cells: CellSpec[] = [];
    if (k === 0) cells.push(textCell(2, 1, authorRows, bf(DOUBLE, solid(0.2), solid(0.12), solid(0.12)), label, LABEL_CHAR, "작 성 자"));
    cells.push(textCell(3, 1, 1, bf(solid(0.2), solid(0.12), solid(0.12), solid(0.12)), value, VALUE_CHAR, a.label));
    cells.push(textCell(4, 1, 1, bf(solid(0.12), solid(0.4), solid(0.12), solid(0.12)), value, VALUE_CHAR, a.name));
    rows.push({ height: heights[rows.length], cells });
  });
  // last row: 연락처
  rows.push({
    height: heights[rows.length],
    cells: [
      textCell(2, 1, 1, bf(DOUBLE, solid(0.2), solid(0.12), solid(0.4)), label, LABEL_CHAR, "연 락 처"),
      textCell(3, 2, 1, bf(solid(0.2), solid(0.4), solid(0.12), solid(0.4)), value, VALUE_CHAR, m.연락처),
    ],
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
  const anchor = ctx.roleOr("headerAnchor", { para: { align: "JUSTIFY", lineSpacing: 150 }, char: { font: "batang", pt: 14 } });
  const height = heights.reduce((a, b) => a + b, 0);
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: height, lineSpacing: 100 });
}

function logoCell(ctx: WriterContext, width: number, rowSpan: number, borderFill: number): CellSpec {
  const role = ctx.roleOr("logoCell", { para: { align: "CENTER", lineSpacing: 70 }, char: { font: "body", pt: 16, bold: true } });
  const ref = ctx.tpl.pics["image1"];
  const paragraphs: XmlNode[] = [];
  if (ref) {
    const pic = pictureFrom(ref, { id: ctx.ids.nextShapeId(), instid: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder() });
    paragraphs.push(ctx.cellPara({ paraPr: role.paraPr, runs: [{ charPr: role.charPr, nodes: [pic] }], vertsize: pictureSize(pic).height, lineSpacing: 70, horzsize: cellInteriorWidth(width, CELL_MARGIN) }));
  } else {
    ctx.warnings.push({ message: "press template: GEPA logo (image1) missing; 기관명 text used instead" });
    paragraphs.push(ctx.cellPara({ paraPr: role.paraPr, runs: [{ charPr: role.charPr, text: "경북경제진흥원" }], vertsize: 1600, lineSpacing: 70, horzsize: cellInteriorWidth(width, CELL_MARGIN) }));
  }
  return { col: 0, rowSpan, borderFill, margin: CELL_MARGIN, paragraphs };
}

function logotypeCell(ctx: WriterContext, width: number, rowSpan: number, borderFill: number, 배포일: string): CellSpec {
  const logo = ctx.roleOr("logotypeCell", { para: { align: "CENTER", lineSpacing: 50 }, char: { font: "body", pt: 20, bold: true } });
  const date = ctx.roleOr("headerDate", { para: { align: "CENTER", lineSpacing: 50, prev: 1500 }, char: DATE_CHAR });
  const horz = cellInteriorWidth(width, CELL_MARGIN);
  const ref = ctx.tpl.pics["image2"];
  const paragraphs: XmlNode[] = [];
  if (ref) {
    const pic = pictureFrom(ref, { id: ctx.ids.nextShapeId(), instid: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder() });
    paragraphs.push(ctx.cellPara({ paraPr: logo.paraPr, runs: [{ charPr: logo.charPr, nodes: [pic] }], vertsize: pictureSize(pic).height, lineSpacing: 50, horzsize: horz }));
  } else {
    ctx.warnings.push({ message: "press template: 보도자료 logotype (image2) missing; text used instead" });
    paragraphs.push(ctx.cellPara({ paraPr: logo.paraPr, runs: [{ charPr: logo.charPr, text: "보 도 자 료" }], vertsize: 2000, lineSpacing: 100, horzsize: horz }));
  }
  paragraphs.push(ctx.cellPara({ paraPr: date.paraPr, runs: ctx.runsFor([{ t: "text", text: `【${headerDate(배포일)}】` }], DATE_CHAR, date.charPr), vertsize: 1500, lineSpacing: 50, horzsize: horz }));
  return { col: 1, rowSpan, borderFill, margin: CELL_MARGIN, paragraphs };
}

/** Approximate advance width (HWPUNIT) of a title line with 장평 `ratio` % and 자간 `spacing` % (per-character). */
export function titleWidth(ctx: WriterContext, text: string, pt: number, ratio: number, spacing: number): number {
  // 함초롬바탕 bold digits/Latin/punctuation run ≈ 0.6 em, wider than the 0.5 em ctx.textWidth() assumes
  let w = 0;
  for (const ch of text) w += ctx.textWidth(ch, pt) === pt * 100 ? pt * 100 : pt * 60;
  const n = [...text].length;
  return Math.round((w * ratio) / 100 + (n * pt * 100 * spacing) / 100);
}

/**
 * User rule (2026-09-16): a title starts at 장평 100 % / 자간 0 %; when it would wrap, tighten
 * 자간 and 장평 — never below 90 % / −20 % — until it fits one line. The cheapest combination
 * wins (1 % of 장평 counts like 2 % of 자간, so letter spacing gives first). A title that cannot
 * fit even at the limits keeps the defaults and wraps.
 */
export function fitTitle(ctx: WriterContext, text: string, pt: number, cellWidth: number): { ratio: number; spacing: number } {
  // widths are estimates; keep 1.5 em of slack so a borderline line falls back to two lines instead of wrapping squeezed
  const width = cellWidth - pt * 150;
  if (titleWidth(ctx, text, pt, 100, 0) <= width) return { ratio: 100, spacing: 0 };
  let best: { ratio: number; spacing: number; cost: number } | undefined;
  for (let ratio = 100; ratio >= FIT_MIN_RATIO; ratio--) {
    for (let spacing = 0; spacing >= FIT_MIN_SPACING; spacing--) {
      const cost = (100 - ratio) * 2 - spacing;
      if (best && cost >= best.cost) continue;
      if (titleWidth(ctx, text, pt, ratio, spacing) <= width) best = { ratio, spacing, cost };
    }
  }
  return best ? { ratio: best.ratio, spacing: best.spacing } : { ratio: 100, spacing: 0 };
}

/** Title box: 1×1 table, thin blue rule above / thick light-blue rule below, centred 18pt bold lines. */
function titleBox(ctx: WriterContext, title: ParaBlock | undefined, subtitle: ParaBlock | undefined): XmlNode {
  const t = ctx.roleOr("pressTitle", { para: { align: "CENTER", lineSpacing: 160 }, char: TITLE_CHAR });
  const s = ctx.roleOr("pressSubtitle", { para: { align: "CENTER", lineSpacing: 160 }, char: SUBTITLE_CHAR });
  // user decision 2026-09-16: no space-before on the title paragraph (문단 위 0)
  const firstParaPr = t.paraPr;
  const horz = cellInteriorWidth(TITLE_WIDTH, CELL_MARGIN);
  const paragraphs: XmlNode[] = [];
  let lines = 0;
  let subLines = 0;
  if (title) {
    const text = inlineText(title.inlines);
    const fit = fitTitle(ctx, text, 18, horz);
    const spec = { ...TITLE_CHAR, ...fit };
    paragraphs.push(ctx.cellPara({ paraPr: firstParaPr, runs: ctx.runsFor(title.inlines, spec), vertsize: 1800, lineSpacing: 160, horzsize: horz }));
    const one = titleWidth(ctx, text, 18, fit.ratio, fit.spacing) <= horz - 2700;
    lines += one ? 1 : ctx.lineCount(text, 18, horz);
    if (!one) ctx.warnings.push({ blockId: title.id, message: `제목이 ${[...text].length}자라 한 줄(최대 ${TITLE_LIMITS.title.max}자, 권장 ${TITLE_LIMITS.title.plain}자 이하)에 들어가지 않아 두 줄로 출력됩니다` });
  }
  if (subtitle) {
    const inl = dashed(subtitle.inlines);
    const text = inlineText(inl);
    const pt = SUBTITLE_CHAR.pt;
    const fit = fitTitle(ctx, text, pt, horz);
    const spec = { ...SUBTITLE_CHAR, ...fit };
    paragraphs.push(ctx.cellPara({ paraPr: title ? s.paraPr : firstParaPr, runs: ctx.runsFor(inl, spec), vertsize: pt * 100, lineSpacing: 160, horzsize: horz }));
    const one = titleWidth(ctx, text, pt, fit.ratio, fit.spacing) <= horz - pt * 150;
    subLines += one ? 1 : ctx.lineCount(text, pt, horz);
    if (!one) ctx.warnings.push({ blockId: subtitle.id, message: `부제가 ${[...text].length - 4}자라 한 줄(최대 ${TITLE_LIMITS.subtitle.max}자, 권장 ${TITLE_LIMITS.subtitle.plain}자 이하)에 들어가지 않아 두 줄로 출력됩니다` });
  }
  const height = Math.max(TITLE_MIN_HEIGHT, lines * 2880 + subLines * SUBTITLE_CHAR.pt * 160 + 282);
  const cellBf = ctx.reg.roleBorderFill("titleBox") ?? ctx.reg.borderFill({ l: "none", r: "none", t: { type: "SOLID", widthMm: 0.5, color: "#0000FF" }, b: { type: "SOLID", widthMm: 1.5, color: "#3366FF" } });
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [TITLE_WIDTH],
    rows: [{ height, cells: [{ col: 0, borderFill: cellBf, margin: CELL_MARGIN, paragraphs }] }],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: CELL_MARGIN,
    outMargin: { l: 140, r: 140, t: 140, b: 140 },
  });
  const anchor = ctx.roleOr("titleAnchor", { para: { align: "JUSTIFY", lineSpacing: 180 }, char: { font: "body", pt: 20, bold: true } });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: height, lineSpacing: 100, forcePageBreak: title?.pageBreakBefore });
}

/** The reference writes the subtitle as `- … -`; add the dashes when the author did not. */
function dashed(inlines: Inline[]): Inline[] {
  const text = inlineText(inlines).trim();
  if (!text || (text.startsWith("-") && text.endsWith("-"))) return inlines;
  return [{ t: "text", text: "- " }, ...inlines, { t: "text", text: " -" }];
}

/** Grey bullet box: "  • item" lines, 함초롬바탕 14pt 자간 −5 장평 98, 130 %, hanging indent. */
function bulletBox(ctx: WriterContext, items: ParaBlock[]): XmlNode {
  const first = ctx.roleOr("bulletBoxFirst", { para: { align: "JUSTIFY", lineSpacing: 130, hanging: 2711, right: 500 }, char: BOX_CHAR });
  const rest = ctx.roleOr("bulletBoxItem", { para: { align: "JUSTIFY", lineSpacing: 130, hanging: 2711, right: 500, prev: 500 }, char: BOX_CHAR });
  const horz = cellInteriorWidth(BOX_WIDTH, BOX_MARGIN);
  let lines = 0;
  const paragraphs = items.map((b, k) => {
    const role = k === 0 ? first : rest;
    // levels inside the box (user, 2026-09-16): □ heading (bold, no bullet indent) → • item → - sub-item → · sub-sub-item
    const prefix = b.role === "body1" ? "□ " : b.role === "body3" ? "    - " : b.role === "body4" ? "      · " : "  • ";
    const base: CharSpec = b.role === "body1" ? { ...BOX_CHAR, bold: true } : BOX_CHAR;
    const runs = ctx.runsFor([{ t: "text", text: prefix }, ...b.inlines], base, base === BOX_CHAR ? role.charPr : undefined);
    lines += ctx.lineCount(prefix + inlineText(b.inlines), 14, horz);
    return ctx.cellPara({ paraPr: role.paraPr, runs, vertsize: 1400, lineSpacing: 130, horzsize: horz });
  });
  const height = lines * 1820 + (items.length - 1) * 500 + 1150;
  const cellBf = ctx.reg.roleBorderFill("bulletBoxCell") ?? ctx.reg.borderFill({ l: "none", r: "none", t: "none", b: "none", fill: "#F2F2F2" });
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [BOX_WIDTH],
    rows: [{ height, cells: [{ col: 0, borderFill: cellBf, margin: BOX_MARGIN, paragraphs }] }],
    borderFill: ctx.reg.roleBorderFill("bulletBoxFrame") ?? ctx.reg.gridBorderFill(),
    inMargin: BOX_MARGIN,
    outMargin: { l: 141, r: 141, t: 141, b: 141 },
  });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: 180 }, char: BODY_CHAR });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: height, lineSpacing: 100, forcePageBreak: items[0].pageBreakBefore });
}
