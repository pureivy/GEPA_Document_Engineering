/** Block handlers shared by all families: paragraphs, blanks, page breaks, images, generic tables. */
import { findAll, type XmlNode } from "../xml";
import type { WriterContext } from "./context";
import type { Block, Cell, Inline, ParaRole, TableStyle, Row, Family } from "../../docmodel/schema";
import { inlineText } from "../../docmodel/schema";
import { leadingSpaces, noteIndentUnder, type Ladder } from "../../docmodel/indent";
import { table, cellInteriorWidth, type CellSpec, type RowSpec } from "../emit/table";
import { sumFormula } from "../emit/paragraph";
import { pictureFrom, pictureSize } from "../emit/picture";
import type { CharSpec, FontRole, ParaSpec, SideSpec } from "../registry";
import { TEXT_WIDTH, mmToHwp } from "../units";

type ParaBlock = Extract<Block, { k: "para" }>;
type TableBlock = Extract<Block, { k: "table" }>;
type ImageBlock = Extract<Block, { k: "image" }>;

export interface FamilyStyle {
  bodyPt: number; // 13 notice / 15 plan
  bodyLineSpacing: number; // 160 / meta
  body1Bold: boolean; // plan: □ bold
  body1Font: FontRole; // body (휴먼명조) or heading (HY헤드라인M)
  /** size of the □ line when it differs from the body (범피스: HY헤드라인M 16) */
  body1Pt?: number;
  notePt: number; // 12
  /** font role for ※ / * notes: "note" = 한양중고딕 (GEPA), "table" = 맑은 고딕 (범피스) */
  noteFont?: FontRole;
  tableHeaderFill: string; // #DFE6F7 / #D9D9D9
  tableFontPt: number; // 11
  /** heavier rules above and below the table header row (범피스 행안부 표서식: 0.5 mm) */
  tableHeaderRuleMm?: number;
  hangingIndent: boolean;
  /** which leading-space ladder to use (defaults to the document family) */
  indentFamily?: Family;
  /** "gov" = 행정업무운영 편람 2타 사다리(□0 ㅇ2 -4 ·6); default "gepa" = reference-document habit */
  ladder?: Ladder;
  /** 문단 위 간격 (HWPUNIT, 100 = 1pt) per level: □ / ㅇ / everything else (- · ※ * plain) */
  spaceBefore?: { body1: number; body2: number; other: number };
  /** ○ 항목 맨 앞의 괄호 라벨 `(사전 진단)`을 괄호째 굵게 (글머리 ○는 그대로) — user 2026-09-16 */
  boldLeadingLabel?: boolean;
  /** glyph substitutions at emit time, e.g. { "ㅇ": "○" } for the 범정부 profile */
  glyphMap?: Record<string, string>;
}

/** Resolve the role → (paraPr, charPr, charSpec) for a body paragraph. */
export function bodyStyle(ctx: WriterContext, fs: FamilyStyle, b: ParaBlock): { paraPr: number; base: CharSpec; baseCharPr?: number; prefix: string } {
  const rawGlyph = b.glyph && b.glyph !== "none" ? b.glyph : undefined;
  const glyph = rawGlyph ? ((fs.glyphMap?.[rawGlyph] ?? rawGlyph) as typeof rawGlyph) : undefined;
  const indentFamily = fs.indentFamily ?? ctx.family;
  const ladder = fs.ladder ?? "gepa";
  let indent = b.indent ?? leadingSpaces(indentFamily, b.glyph, b.role, ladder);
  // house idiom / 편람: a ※ / * note that follows an item is indented under that item's text
  if (b.indent === undefined && (glyph === "※" || glyph === "*")) {
    const under = noteIndentUnder(indentFamily, ctx.prevGlyph, ladder);
    if (under !== undefined) indent = under;
  }
  if (glyph && glyph !== "※" && glyph !== "*") ctx.prevGlyph = glyph;
  const spaces = " ".repeat(indent);
  const prefix = glyph ? `${spaces}${glyph} ` : spaces;
  const align = (b.align ?? "both").toUpperCase().replace("BOTH", "JUSTIFY") as ParaSpec["align"];
  const role = b.role;
  const mapped = ctx.reg.role(role);
  let base: CharSpec;
  switch (role) {
    case "body1":
      base = { font: fs.body1Font, pt: fs.body1Pt ?? fs.bodyPt, bold: fs.body1Bold };
      break;
    case "body2":
    case "body3":
    case "body4":
    case "plain":
      base = { font: "body", pt: fs.bodyPt };
      break;
    case "note":
      base = { font: fs.noteFont ?? "note", pt: fs.notePt };
      break;
    case "footnote":
      // notice reference: 굴림 11pt; templates without 굴림 (plan) use the note font
      base = fs.noteFont ? { font: fs.noteFont, pt: fs.notePt } : ctx.reg.hasFace("굴림") ? { font: "gulim", pt: 11, spacing: -4 } : { font: "note", pt: 11 };
      break;
    case "unitCaption":
      base = { font: "table", pt: 10 };
      break;
    case "attachmentHeading":
      base = { font: "body", pt: fs.bodyPt, bold: true };
      break;
    case "annexHeading":
      base = { font: "heading", pt: 14, bold: true };
      break;
    case "coverSummary":
      base = { font: "table", pt: 13, ratio: 98 };
      break;
    case "tocLine":
      base = { font: "heading", pt: 15 };
      break;
    default:
      base = { font: "body", pt: fs.bodyPt };
  }
  // paragraph shape
  let paraPr: number;
  const useMapped = mapped && !b.align && !fs.spaceBefore && (!fs.hangingIndent || !glyph || role === "footnote");
  if (useMapped) paraPr = mapped.paraPr;
  else {
    const spec: ParaSpec = { align: align ?? "JUSTIFY", lineSpacing: role === "footnote" ? 150 : fs.bodyLineSpacing };
    if (role === "unitCaption") spec.align = "RIGHT";
    if (fs.spaceBefore) spec.prev = role === "body1" ? fs.spaceBefore.body1 : role === "body2" ? fs.spaceBefore.body2 : fs.spaceBefore.other;
    if (fs.hangingIndent && glyph && role !== "footnote") spec.hanging = ctx.textWidth(prefix, base.pt);
    paraPr = ctx.reg.paraPr(spec);
  }
  const baseCharPr = mapped && !b.align ? mapped.charPr : undefined;
  // sanity: the mapped charPr must match the intended size, otherwise resolve by spec
  const info = baseCharPr !== undefined ? ctx.reg.charPrInfo(baseCharPr) : undefined;
  const ok = info && info.pt === base.pt && info.bold === !!base.bold && info.hangul === ctx.reg.faceOf(base.font);
  return { paraPr, base, baseCharPr: ok ? baseCharPr : undefined, prefix };
}

export function emitPara(ctx: WriterContext, fs: FamilyStyle, b: ParaBlock): XmlNode {
  const { paraPr, base, baseCharPr, prefix } = bodyStyle(ctx, fs, b);
  let runs;
  if (b.role === "body1" && fs.body1Font === "heading" && fs.body1Bold && prefix) {
    // file-5 idiom: "□ " in bold HY헤드라인M, the title text regular
    const glyphRun = ctx.runsFor([{ t: "text", text: prefix }], { ...base, bold: true });
    const textRuns = ctx.runsFor(b.inlines, { ...base, bold: false });
    runs = [...glyphRun, ...textRuns];
  } else {
    let body: Inline[] = b.inlines;
    if (fs.boldLeadingLabel && b.role === "body2" && body[0]?.t === "text" && !body[0].bold) {
      // "(사전 진단) 참여기업 …" → bold "(사전 진단)", regular rest
      const m = /^(\s*\([^()]{1,20}\))(?=\s|$)/.exec(body[0].text);
      if (m) body = [{ ...body[0], text: m[1], bold: true }, { ...body[0], text: body[0].text.slice(m[1].length) }, ...body.slice(1)].filter((i) => i.t !== "text" || i.text !== "");
    }
    const inlines: Inline[] = prefix ? [{ t: "text", text: prefix }, ...body] : body;
    runs = ctx.runsFor(inlines, base, baseCharPr);
  }
  const ls = ctx.reg.paraPrInfo(paraPr)?.lineSpacing ?? fs.bodyLineSpacing;
  return ctx.para({ paraPr, runs, vertsize: Math.round(base.pt * 100), lineSpacing: ls, forcePageBreak: b.pageBreakBefore });
}

export function emitBlank(ctx: WriterContext, fs: FamilyStyle, small = false): XmlNode {
  const r = ctx.roleOr("blank", { para: { align: "JUSTIFY", lineSpacing: fs.bodyLineSpacing }, char: { font: "body", pt: fs.bodyPt } });
  const pt = small ? 5 : fs.bodyPt;
  const charPr = small ? ctx.reg.charPr({ font: "body", pt }) : r.charPr;
  return ctx.para({ paraPr: r.paraPr, runs: [{ charPr, text: "" }], vertsize: pt * 100, lineSpacing: fs.bodyLineSpacing });
}

export function emitImage(ctx: WriterContext, fs: FamilyStyle, b: ImageBlock): XmlNode | undefined {
  const refId = b.asset === "logo" ? "image1" : b.asset === "chevron" ? "image2" : b.asset;
  const ref = ctx.tpl.pics[refId];
  if (!ref) {
    ctx.warnings.push({ blockId: b.id, message: `image asset "${b.asset}" not in template` });
    return undefined;
  }
  const width = b.widthMm ? mmToHwp(b.widthMm) : undefined;
  const pic = pictureFrom(ref, { id: ctx.ids.nextShapeId(), instid: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder() }, width);
  const { height } = pictureSize(pic);
  const r = ctx.roleOr("logoAnchor", { para: { align: b.align === "center" ? "CENTER" : "LEFT", lineSpacing: fs.bodyLineSpacing }, char: { font: "body", pt: fs.bodyPt } });
  if (b.position === "pageBottom") {
    // out-of-flow picture pinned to the bottom of the page (쪽 기준), horizontally per `align`; the anchor paragraph stays empty
    const pos = findAll(pic, "hp:pos")[0];
    if (pos) Object.assign(pos.attrs, { treatAsChar: "0", flowWithText: "0", allowOverlap: "0", vertRelTo: "PAGE", vertAlign: "BOTTOM", vertOffset: "0", horzRelTo: "PAGE", horzAlign: b.align === "center" ? "CENTER" : "LEFT", horzOffset: "0" });
    pic.attrs.textWrap = "TOP_AND_BOTTOM";
    const paraPr = ctx.reg.paraPr({ align: "LEFT", lineSpacing: 100 });
    return ctx.para({ paraPr, runs: [{ charPr: r.charPr, nodes: [pic] }], vertsize: 1000, lineSpacing: 100 });
  }
  const paraPr = b.align === "center" ? ctx.reg.paraPr({ align: "CENTER", lineSpacing: 160 }) : r.paraPr;
  return ctx.para({ paraPr, runs: [{ charPr: r.charPr, nodes: [pic] }], vertsize: height, lineSpacing: 120 });
}

// ---------------------------------------------------------------------------------------
// Generic tables

interface ResolvedCell extends Cell {
  row: number;
  col: number;
}

/** Expand a DocModel row grid into a positional grid honoring spans and `covered` cells. */
function layoutGrid(rows: Row[]): { grid: (ResolvedCell | null)[][]; colCount: number } {
  // One entry per grid column in each row: span anchors are followed by `covered` entries.
  const colCount = Math.max(...rows.map((r) => r.cells.length), 1);
  const grid: (ResolvedCell | null)[][] = rows.map(() => Array(colCount).fill(null));
  const coveredByRowSpan: boolean[][] = rows.map(() => Array(colCount).fill(false));
  rows.forEach((r, ri) => {
    r.cells.forEach((c, col) => {
      if (col >= colCount) return;
      if (c.covered || coveredByRowSpan[ri][col]) return;
      const cs = Math.max(1, Math.min(c.colSpan ?? 1, colCount - col));
      const rs = Math.max(1, Math.min(c.rowSpan ?? 1, rows.length - ri));
      grid[ri][col] = { ...c, colSpan: cs, rowSpan: rs, row: ri, col };
      for (let dr = 1; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) coveredByRowSpan[ri + dr][col + dc] = true;
    });
  });
  return { grid, colCount };
}

export interface TableDefaults {
  borderColor: string;
  headerFill: string;
  totalFill: string;
  fontPt: number;
  headerFontPt: number;
  lineSpacing: number;
  padding: "tight" | "text";
  frame: "grid" | "open" | "none";
  headerTopMm: number; // heavier rule above header
  lastBottomMm: number; // heavier rule under last row
  outerSidesNone: boolean; // left col left / right col right borders NONE (frame draws them)
  headerBottomMm?: number;
}

export function tableDefaults(ctx: WriterContext, fs: FamilyStyle, b: TableBlock): TableDefaults {
  const s: TableStyle = b.style ?? {};
  const rule = fs.tableHeaderRuleMm;
  const base: TableDefaults = {
    borderColor: s.borderColor ?? "#000000",
    headerFill: s.headerFill ?? fs.tableHeaderFill,
    totalFill: s.totalFill ?? "#D9D9D9",
    fontPt: s.fontPt ?? fs.tableFontPt,
    headerFontPt: s.headerFontPt ?? s.fontPt ?? fs.tableFontPt,
    lineSpacing: s.lineSpacing ?? 150,
    padding: s.padding ?? "text",
    frame: s.border === "none" ? "none" : "grid",
    headerTopMm: rule ?? 0.12,
    lastBottomMm: rule ?? 0.12,
    outerSidesNone: true,
    ...(rule ? { headerBottomMm: rule } : {}),
  };
  switch (b.role) {
    case "docs":
      return { ...base, headerTopMm: 0.5, lastBottomMm: 0.5, headerBottomMm: 0.1, lineSpacing: s.lineSpacing ?? 160 };
    case "support":
      return { ...base, frame: "open", headerTopMm: 0.4, lastBottomMm: 0.4, fontPt: s.fontPt ?? 10, headerFontPt: s.headerFontPt ?? 11, lineSpacing: s.lineSpacing ?? 130, padding: s.padding ?? "text" };
    case "evalCriteria":
      return { ...base, borderColor: s.borderColor ?? "#3A3C84", headerFill: s.headerFill ?? "#D9D9D9", headerTopMm: 0.4, lastBottomMm: 0.4, fontPt: s.fontPt ?? 10, lineSpacing: s.lineSpacing ?? 120 };
    case "budget":
      return { ...base, headerFill: s.headerFill ?? (ctx.family === "plan" ? "#D9D9D9" : fs.tableHeaderFill), lineSpacing: s.lineSpacing ?? 160 };
    default:
      if (s.border === "grey012") return { ...base, borderColor: "#808080" };
      return base;
  }
}

export function emitTable(ctx: WriterContext, fs: FamilyStyle, b: TableBlock): XmlNode[] {
  const out: XmlNode[] = [];
  const d = tableDefaults(ctx, fs, b);
  const { grid, colCount } = layoutGrid(b.rows);
  // column widths
  let cols: number[];
  const target = TEXT_WIDTH;
  if (b.widthsPt && b.widthsPt.length === colCount) {
    const raw = b.widthsPt.map((w) => w * 100);
    const sum = raw.reduce((a, c) => a + c, 0);
    const scale = sum > target ? target / sum : 1;
    cols = raw.map((w) => Math.round(w * scale));
  } else {
    cols = Array(colCount).fill(Math.floor(target / colCount));
  }
  const width = cols.reduce((a, c) => a + c, 0);
  const margin = d.padding === "tight" ? { l: 141, r: 141, t: 141, b: 141 } : { l: 510, r: 510, t: 141, b: 141 };
  const headerRows = b.headerRows ?? (b.rows[0]?.isHeader ? 1 : 0);
  const lastRow = b.rows.length - 1;
  const side = (mm: number, color = d.borderColor): SideSpec => (mm <= 0 ? "none" : { type: "SOLID", widthMm: mm, color });

  const rowSpecs: RowSpec[] = [];
  const rowHeights: number[] = b.rows.map(() => 0);
  const cellSpecs: CellSpec[][] = b.rows.map(() => []);
  b.rows.forEach((row, ri) => {
    for (let ci = 0; ci < colCount; ci++) {
      const c = grid[ri][ci];
      if (!c) continue;
      const cs = c.colSpan ?? 1, rs = c.rowSpan ?? 1;
      const isHeader = ri < headerRows || !!row.isHeader;
      const isTotal = !!row.isTotal;
      const isLast = ri + rs - 1 === lastRow;
      const cellW = cols.slice(ci, ci + cs).reduce((a, x) => a + x, 0);
      const interior = cellInteriorWidth(cellW, margin);
      // borders
      const leftEdge = ci === 0, rightEdge = ci + cs === colCount;
      const l: SideSpec = leftEdge && d.outerSidesNone && d.frame !== "none" ? "none" : d.frame === "none" ? "none" : side(0.12);
      const r: SideSpec = rightEdge && d.outerSidesNone && d.frame !== "none" ? "none" : d.frame === "none" ? "none" : side(0.12);
      const t: SideSpec = d.frame === "none" ? "none" : ri === 0 ? side(d.headerTopMm) : ri === headerRows && headerRows > 0 && d.headerBottomMm ? side(d.headerBottomMm) : side(0.12);
      const bt: SideSpec = d.frame === "none" ? "none" : isLast ? side(d.lastBottomMm) : ri + rs === headerRows && d.headerBottomMm ? side(d.headerBottomMm) : side(0.12);
      const custom = c.borders;
      const fill = c.fill ?? (isHeader ? d.headerFill : isTotal ? d.totalFill : b.role === "evalCriteria" ? "#FFFFFF" : null);
      const bf = ctx.reg.borderFill({
        l: custom?.l ? toSide(custom.l) : l,
        r: custom?.r ? toSide(custom.r) : r,
        t: custom?.t ? toSide(custom.t) : t,
        b: custom?.b ? toSide(custom.b) : bt,
        fill,
      });
      // text
      const pt = isHeader ? d.headerFontPt : d.fontPt;
      const bold = c.bold ?? isHeader;
      const text = inlineText(c.inlines);
      const alignDefault: ParaSpec["align"] = isHeader ? "CENTER" : c.align ? (c.align.toUpperCase().replace("BOTH", "JUSTIFY") as ParaSpec["align"]) : text.length <= 8 || b.role === "docs" ? "CENTER" : "JUSTIFY";
      const paraPr = ctx.reg.paraPr({ align: alignDefault, lineSpacing: d.lineSpacing });
      const base: CharSpec = { font: "table", pt, bold };
      // paragraphs: split on '\n' (from br inlines or literal newlines)
      const paras: XmlNode[] = [];
      const groups = splitInlinesByNewline(c.inlines);
      const formula = isTotal ? columnSumFormula(grid, ri, ci, headerRows, text) : null;
      let nestedHeight = 0;
      let lines = 0;
      if (formula) {
        // 합계 cell: a FORMULA field over the column (the reference's `=SUM(?2:?6)??%g;;100`)
        paras.push(ctx.cellPara({ paraPr, runs: [{ charPr: ctx.reg.charPr(base), text: text.trim(), formula, fieldId: ctx.ids.nextShapeId() }], vertsize: pt * 100, lineSpacing: d.lineSpacing, horzsize: interior }));
        lines = 1;
      } else {
        for (const g of groups.length ? groups : [[{ t: "text", text: "" } as Inline]]) {
          const score = parseScoreLine(inlineText(g));
          if (score) {
            // 정량평가 배점표: `구분: 30%이상 30 / 30%미만 24 / …` becomes the reference's nested 2×N table
            if (score.lead) {
              paras.push(ctx.cellPara({ paraPr, runs: ctx.runsFor([{ t: "text", text: score.lead }], base), vertsize: pt * 100, lineSpacing: d.lineSpacing, horzsize: interior }));
              lines += ctx.lineCount(score.lead, pt, interior);
            }
            const nested = scoreTable(ctx, score.items, interior);
            const leftPara = ctx.reg.paraPr({ align: "LEFT", lineSpacing: 150 });
            const cp = ctx.reg.charPr({ ...base, spacing: -5 });
            paras.push(ctx.cellPara({ paraPr: leftPara, runs: [{ charPr: cp, text: " " }, { charPr: cp, nodes: [nested.node] }], vertsize: nested.height, lineSpacing: 100, horzsize: interior }));
            nestedHeight += nested.height + 280; // + out margins
            continue;
          }
          paras.push(ctx.cellPara({ paraPr, runs: ctx.runsFor(g, base), vertsize: pt * 100, lineSpacing: d.lineSpacing, horzsize: interior }));
          lines += ctx.lineCount(inlineText(g), pt, interior);
        }
      }
      const h = Math.round(Math.max(lines, nestedHeight ? 0 : 1) * pt * 100 * (d.lineSpacing / 100)) + nestedHeight + margin.t + margin.b + 300;
      if (rs === 1) rowHeights[ri] = Math.max(rowHeights[ri], row.heightPt ? row.heightPt * 100 : h);
      cellSpecs[ri].push({ col: ci, colSpan: cs, rowSpan: rs, borderFill: bf, paragraphs: paras, vertAlign: c.valign === "top" ? "TOP" : c.valign === "bottom" ? "BOTTOM" : "CENTER", margin, header: isHeader });
    }
  });
  const minH = Math.round(d.fontPt * 100 * (d.lineSpacing / 100)) + margin.t + margin.b + 300;
  b.rows.forEach((row, ri) => rowSpecs.push({ height: Math.max(rowHeights[ri], row.heightPt ? row.heightPt * 100 : minH), cells: cellSpecs[ri] }));

  const frameBf = d.frame === "grid" ? ctx.reg.borderFill({ l: side(0.12), r: side(0.12), t: side(0.12), b: side(0.12) }) : ctx.reg.borderFill({ l: "none", r: "none", t: "none", b: "none" });
  const tblNode = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols,
    rows: rowSpecs,
    borderFill: frameBf,
    inMargin: margin,
    outMargin: { l: 140, r: 140, t: 140, b: 140 },
    treatAsChar: true,
    repeatHeader: true,
    noAdjust: b.role === "support",
    pageBreak: b.role === "support" ? "TABLE" : "CELL",
  });
  if (b.caption) {
    const r = ctx.roleOr("unitCaption", { para: { align: "RIGHT", lineSpacing: 150 }, char: { font: "table", pt: 10 } });
    out.push(ctx.para({ paraPr: r.paraPr, runs: [{ charPr: r.charPr, text: b.caption }], vertsize: 1000, lineSpacing: 150 }));
  }
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: fs.bodyLineSpacing }, char: { font: "body", pt: fs.bodyPt } });
  const height = rowSpecs.reduce((a, r) => a + r.height, 0);
  out.push(ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tblNode] }], vertsize: height, lineSpacing: 100 }));
  void width;
  return out;
}

export interface ScoreLine {
  /** text kept as its own line before the table (e.g. `1. 매출액 대비 수출액 비율(25년 기준)`); absent for a bare `구분:` line */
  lead?: string;
  items: Array<[string, string]>;
}

function parseScoreItems(src: string, min: number): Array<[string, string]> | null {
  const items = src.split(/\s*\/\s*/).filter(Boolean);
  if (items.length < min) return null;
  const out: Array<[string, string]> = [];
  for (const it of items) {
    const mm = /^(.*\S)\s+(\d+(?:\.\d+)?)$/.exec(it.trim());
    if (!mm) return null;
    out.push([mm[1], mm[2]]);
  }
  return out;
}

/**
 * A 배점 range line becomes the reference's nested 2×N score table:
 *   `구분: 30%이상 30 / 30%미만 24 / …`              (the 6-1 transcription)
 *   `1. 매출액 대비 수출액 비율: 30% 이상 30 / …`     (lead text + ranges, as writers tend to put it)
 *   `200% 이상 20 / 200% 미만 16 / 100% 미만 12 / …`  (bare ranges, ≥ 3 items)
 * Every item must end with a number; anything else stays ordinary text.
 */
export function parseScoreLine(text: string): ScoreLine | null {
  const t = text.trim();
  const colon = /^(.*?)\s*[:：]\s*(.+)$/.exec(t);
  if (colon) {
    const items = parseScoreItems(colon[2], 2);
    if (items) {
      const lead = colon[1].trim();
      return lead && lead !== "구분" ? { lead, items } : { items };
    }
  }
  const bare = parseScoreItems(t, 3);
  return bare ? { items: bare } : null;
}

/**
 * Nested 배점표 exactly as in the 6-1 reference: 2 rows × (1 + N) columns, label column 4256
 * and 5785 per score column (scaled down when the cell interior is narrower), header row
 * 1665 / score row 2231 HWPUNIT, #D9D9D9 header, 0.25 mm black outer edges, 0.12 mm #CCCCCC
 * inner rules, 맑은 고딕 10 pt centred (paraPr CENTER 160% hanging 1448).
 */
function scoreTable(ctx: WriterContext, items: Array<[string, string]>, interior: number): { node: XmlNode; height: number } {
  const n = items.length;
  let cols = [4256, ...items.map(() => 5785)];
  const total = cols.reduce((a, c) => a + c, 0);
  const avail = interior - 280; // out margins 140 + 140
  if (total > avail) cols = cols.map((c) => Math.floor((c * avail) / total));
  const margin = { l: 510, r: 510, t: 141, b: 141 };
  // reference heights (1665 / 2231) grow when a label wraps inside its 5785-wide column
  const rowsText = [
    ["구분", ...items.map((i) => i[0])],
    ["배점", ...items.map((i) => i[1])],
  ];
  const rowH = rowsText.map((texts, ri) => {
    // narrow columns: measure conservatively (the width estimate is approximate and a label that
    // wraps grows the nested table, which the outer row height must already include)
    const wrapped = Math.max(...texts.map((t, ci) => ctx.lineCount(t, 10, Math.floor(cellInteriorWidth(cols[ci], margin) * 0.8))));
    return Math.max(ri === 0 ? 1665 : 2231, wrapped * 1600 + margin.t + margin.b + 100);
  });
  const heavy: SideSpec = { type: "SOLID", widthMm: 0.25, color: "#000000" };
  const light: SideSpec = { type: "SOLID", widthMm: 0.12, color: "#CCCCCC" };
  const paraPr = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 160, hanging: 1448 });
  const charPr = ctx.reg.charPr({ font: "table", pt: 10 });
  const rows: RowSpec[] = rowsText.map((texts, ri) => ({
    height: rowH[ri],
    cells: texts.map((t, ci) => {
      const bf = ctx.reg.borderFill({
        l: ci === 0 ? heavy : light,
        r: ci === texts.length - 1 ? heavy : light,
        t: ri === 0 ? heavy : light,
        b: ri === 1 ? heavy : light,
        fill: ri === 0 ? "#D9D9D9" : null,
      });
      const w = cellInteriorWidth(cols[ci], margin);
      return { col: ci, borderFill: bf, paragraphs: [ctx.cellPara({ paraPr, runs: [{ charPr, text: t }], vertsize: 1000, lineSpacing: 160, horzsize: w })], vertAlign: "CENTER" as const, margin };
    }),
  }));
  const node = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols,
    rows,
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: margin,
    outMargin: { l: 140, r: 140, t: 140, b: 140 },
    treatAsChar: true,
    repeatHeader: true,
    pageBreak: "CELL",
  });
  void n;
  return { node, height: rowH[0] + rowH[1] };
}

const NUMERIC_CELL = /^\s*[+-]?\d{1,3}(,\d{3})*(\.\d+)?\s*$|^\s*[+-]?\d+(\.\d+)?\s*$/;

function cellNumber(c: ResolvedCell | null): number | null {
  if (!c) return 0; // covered position: the anchor above already counted it
  const t = inlineText(c.inlines);
  if (!NUMERIC_CELL.test(t)) return null;
  return Number(t.replace(/,/g, "").trim());
}

/**
 * A total row's numeric cell gets a FORMULA field summing the data rows of its column
 * (`=SUM(?from:?to)`, rows 1-based) — only when the displayed value really is that sum,
 * so the field can never contradict the visible number.
 */
export function columnSumFormula(grid: (ResolvedCell | null)[][], totalRow: number, col: number, headerRows: number, shown: string): string | null {
  if (!NUMERIC_CELL.test(shown)) return null;
  const from = headerRows, to = totalRow - 1;
  if (to < from) return null;
  let sum = 0;
  for (let r = from; r <= to; r++) {
    const n = cellNumber(grid[r]?.[col] ?? null);
    if (n === null) return null;
    sum += n;
  }
  const value = Number(shown.replace(/,/g, "").trim());
  if (Math.abs(sum - value) > 1e-9) return null;
  return sumFormula(from + 1, to + 1, shown.trim());
}

function toSide(s: { type?: string; widthMm?: number; color?: string }): SideSpec {
  if (s.type === "none") return "none";
  const type = s.type === "dash" ? "DASH" : s.type === "dot" ? "DOT" : s.type === "double" ? "DOUBLE_SLIM" : "SOLID";
  return { type, widthMm: s.widthMm ?? 0.12, color: s.color ?? "#000000" };
}

export function splitInlinesByNewline(inlines: Inline[]): Inline[][] {
  const groups: Inline[][] = [[]];
  for (const inl of inlines) {
    if (inl.t === "br") {
      groups.push([]);
      continue;
    }
    if (inl.t === "text" && inl.text.includes("\n")) {
      const parts = inl.text.split("\n");
      parts.forEach((p, i) => {
        if (i > 0) groups.push([]);
        if (p) groups[groups.length - 1].push({ ...inl, text: p });
      });
      continue;
    }
    groups[groups.length - 1].push(inl);
  }
  return groups.filter((g, i) => g.length > 0 || i < groups.length);
}

export function roleForGlyphless(role: ParaRole): ParaRole {
  return role;
}
