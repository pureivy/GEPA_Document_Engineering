/** 사업계획서 writer: DocModel(plan) → paragraphs using the file-5 house geometry. */
import { type XmlNode } from "../xml";
import type { PlanDoc, Block } from "../../docmodel/schema";
import { inlineText } from "../../docmodel/schema";
import { WriterContext } from "./context";
import { emitBlank, emitImage, emitPara, emitTable, splitInlinesByNewline, type FamilyStyle } from "./common";
import { table, cellInteriorWidth } from "../emit/table";
import { loadGeometry, cloneFragment, setCellText } from "../geometry";
import { procedureFlow } from "./notice";

const NAVY = "#003366";
const CHIP_FILL = "#DFE6F7";

export function planStyle(doc: PlanDoc): FamilyStyle {
  if (doc.meta.house === "bumpis") {
    // 범정부오피스(행정안전부 표준 보고서 서식) — docs/design-system/bumpis.md §2
    return {
      bodyPt: 15,
      bodyLineSpacing: doc.meta.lineSpacing ?? 160,
      body1Bold: false,
      body1Font: "heading",
      body1Pt: 16,
      notePt: 12,
      noteFont: "table",
      tableHeaderFill: "#DFE6F7",
      tableFontPt: 11,
      tableHeaderRuleMm: 0.5,
      hangingIndent: true,
      indentFamily: "notice",
      glyphMap: { "ㅇ": "○", "◦": "○" },
    };
  }
  return {
    bodyPt: 15,
    bodyLineSpacing: doc.meta.lineSpacing ?? 160,
    body1Bold: true,
    body1Font: doc.meta.body1Font === "hyHeadlineBold" ? "heading" : "body",
    notePt: 12,
    tableHeaderFill: "#D9D9D9",
    tableFontPt: 11,
    hangingIndent: true,
  };
}

export function writePlan(ctx: WriterContext, doc: PlanDoc): XmlNode[] {
  const out: XmlNode[] = [];
  const fs = planStyle(doc);
  const bumpis = doc.meta.house === "bumpis";
  let chipNo = 0;
  for (const b of doc.blocks) {
    if (b.k === "sectionChip" && bumpis && !/^\d+$/.test(b.label)) chipNo++;
    switch (b.k) {
      case "approvalBlock":
        if (bumpis && !hasApprovalMeta(doc)) break; // 범정부 1쪽 보고서: 결재란 없이 제목 상자
        out.push(...approvalBlock(ctx, doc));
        break;
      case "coverTitle":
        out.push(...(bumpis ? boxedTitle(ctx, b) : coverTitle(ctx, fs, b)));
        break;
      case "chapterBand":
        out.push(chapterBand(ctx, b.numeral, b.title));
        break;
      case "sectionChip":
        out.push(bumpis ? numberedChip(ctx, /^\d+$/.test(b.label) ? b.label : String(chipNo), b.title) : sectionChip(ctx, b.label, b.title));
        break;
      case "summaryBox":
        out.push(bumpis ? textBox(ctx, b) : summaryBox(ctx, b));
        break;
      case "procedureFlow":
        out.push(procedureFlow(ctx, b));
        break;
      case "para":
        out.push(emitPara(ctx, fs, b));
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
      case "attachmentList": {
        const r = ctx.roleOr("body1", { para: { align: "JUSTIFY", lineSpacing: fs.bodyLineSpacing }, char: { font: "body", pt: fs.bodyPt } });
        b.items.forEach((it, i) => {
          const text = (i === 0 ? `붙임  ${it}` : `      ${it}`) + (i === b.items.length - 1 ? "  끝." : "");
          out.push(ctx.para({ paraPr: r.paraPr, runs: [{ charPr: ctx.reg.charPr({ font: "body", pt: fs.bodyPt }), text }], vertsize: fs.bodyPt * 100, lineSpacing: fs.bodyLineSpacing }));
        });
        break;
      }
      default:
        ctx.warnings.push({ blockId: b.id, message: `block kind "${b.k}" is not supported in 사업계획서; skipped` });
    }
  }
  return out;
}

// ---- 결재란 (cloned from the reference: 1×2 logo table + 12×11 approval grid) ----------

function approvalBlock(ctx: WriterContext, doc: PlanDoc): XmlNode[] {
  const out: XmlNode[] = [];
  const m = doc.meta;
  const logo = loadGeometry(ctx.tpl.dir, "t00");
  const grid = loadGeometry(ctx.tpl.dir, "t01");
  if (!logo || !grid) {
    ctx.warnings.push({ message: "plan template geometry t00/t01 missing; approval block skipped" });
    return out;
  }
  const logoP = cloneFragment(logo, ctx.ids);
  const gridP = cloneFragment(grid, ctx.ids);
  const a = m.결재 ?? {};
  const year = m.연도 ?? String(new Date().getFullYear());
  setCellText(gridP, 0, 1, m.등록번호 ?? `${m.부서 ?? "경영기획팀"}-`);
  setCellText(gridP, 1, 1, a.등록일자 ?? `${year}. . .`);
  setCellText(gridP, 4, 1, a.결재일자 ?? `${year}. . .`);
  setCellText(gridP, 7, 1, a.공개구분 ?? "공개");
  // signer labels (row 0, cols 3,5,6,8,10)
  const labels: [number, string | undefined][] = [
    [3, "담  당"],
    [5, a.팀장 ? "팀장" : "지소장"],
    [6, a.실장 ? "실장" : "단장"],
    [8, a.본부장 ? "본부장" : "본부장 직무대리"],
    [10, "원장"],
  ];
  for (const [col, text] of labels) if (text) setCellText(gridP, 0, col, text);
  // signer names go in the signature row (row 2)
  const names: [number, string | undefined][] = [
    [3, a.담당],
    [5, a.팀장],
    [6, a.실장],
    [8, a.본부장],
    [10, a.원장],
  ];
  for (const [col, name] of names) setCellText(gridP, 2, col, name ?? "");
  setCellText(gridP, 8, 4, a.협조 ?? "");
  out.push(logoP, gridP);
  return out;
}

function coverTitle(ctx: WriterContext, fs: FamilyStyle, b: Extract<Block, { k: "coverTitle" }>): XmlNode[] {
  const out: XmlNode[] = [];
  const spacer = ctx.roleOr("coverSpacer", { para: { align: "LEFT", lineSpacing: 100 }, char: { font: "body", pt: 24 } });
  const title = ctx.roleOr("coverTitle", { para: { align: "CENTER", lineSpacing: 160 }, char: { font: "heading", pt: 20, color: "#000094" } });
  const pt = b.sizePt ?? 20;
  for (let i = 0; i < 3; i++) out.push(ctx.para({ paraPr: spacer.paraPr, runs: [{ charPr: spacer.charPr, text: "" }], vertsize: 2400, lineSpacing: 100 }));
  const runs = ctx.runsFor(b.inlines, { font: "heading", pt, color: "#000094" }, pt === 20 ? title.charPr : undefined);
  out.push(ctx.para({ paraPr: title.paraPr, runs, vertsize: pt * 100, lineSpacing: 160 }));
  for (let i = 0; i < 2; i++) out.push(ctx.para({ paraPr: spacer.paraPr, runs: [{ charPr: spacer.charPr, text: "" }], vertsize: 2400, lineSpacing: 100 }));
  void fs;
  return out;
}

// ---- 장 제목 밴드 (Ⅰ | | 제목) ---------------------------------------------------------

export function chapterBand(ctx: WriterContext, numeral: string, title: string): XmlNode {
  const cols = [2986, 563, 44557];
  const margin = { l: 141, r: 141, t: 141, b: 141 };
  const numeralRole = ctx.roleOr("chapterNumeral", { para: { align: "CENTER", lineSpacing: 160 }, char: { font: "heading", pt: 20, bold: true, color: "#FFFFFF" } });
  const titleRole = ctx.roleOr("chapterTitle", { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "heading", pt: 18 } });
  const navy = { type: "SOLID" as const, widthMm: 0.5, color: NAVY };
  const bfNumeral = ctx.reg.borderFill({ l: navy, r: navy, t: navy, b: navy, fill: NAVY });
  const bfSpacer = ctx.reg.borderFill({ l: navy, r: "none", t: "none", b: "none" });
  const bfTitle = ctx.reg.borderFill({ l: "none", r: "none", t: navy, b: navy });
  const h = 3074;
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols,
    rows: [
      {
        height: h,
        cells: [
          { col: 0, borderFill: bfNumeral, margin, paragraphs: [ctx.cellPara({ paraPr: numeralRole.paraPr, runs: [{ charPr: numeralRole.charPr, text: numeral }], vertsize: 2000, lineSpacing: 160, horzsize: cellInteriorWidth(cols[0], margin) })] },
          { col: 1, borderFill: bfSpacer, margin, paragraphs: [ctx.cellPara({ paraPr: ctx.reg.paraPr({ align: "JUSTIFY", lineSpacing: 160 }), runs: [{ charPr: titleRole.charPr, text: "" }], vertsize: 1800, lineSpacing: 160, horzsize: cellInteriorWidth(cols[1], margin) })] },
          { col: 2, borderFill: bfTitle, margin, paragraphs: [ctx.cellPara({ paraPr: titleRole.paraPr, runs: [{ charPr: titleRole.charPr, text: ` ${title}` }], vertsize: 1800, lineSpacing: 160, horzsize: cellInteriorWidth(cols[2], margin) })] },
        ],
      },
    ],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: { l: 140, r: 140, t: 140, b: 140 },
    outMargin: { l: 140, r: 140, t: 140, b: 140 },
    horzRelTo: "COLUMN",
    pageBreak: "NONE",
  });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: 135 }, char: { font: "heading", pt: 16 } });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: h, lineSpacing: 100 });
}

// ---- 절 제목 칩 (1×1 light-blue band, file-5 style) ------------------------------------

function sectionChip(ctx: WriterContext, label: string, title: string): XmlNode {
  const width = 47907;
  const margin = { l: 141, r: 141, t: 141, b: 141 };
  const role = ctx.roleOr("chipTitle", { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "heading", pt: 15, bold: true } });
  const bf = ctx.reg.borderFill({ l: "none", r: "none", t: {}, b: {}, fill: CHIP_FILL });
  const text = ` ${label ? label + " " : ""}${title}`.replace(/\s+$/, "");
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [width],
    rows: [{ height: 2631, cells: [{ col: 0, borderFill: bf, margin, paragraphs: [ctx.cellPara({ paraPr: role.paraPr, runs: [{ charPr: role.charPr, text }], vertsize: 1500, lineSpacing: 160, horzsize: cellInteriorWidth(width, margin) })] }] }],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: margin,
    outMargin: { l: 140, r: 140, t: 140, b: 140 },
  });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: 135 }, char: { font: "heading", pt: 16 } });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: 2631, lineSpacing: 100 });
}

// ---- 목적 박스 (❖ …) ----------------------------------------------------------------

function summaryBox(ctx: WriterContext, b: Extract<Block, { k: "summaryBox" }>): XmlNode {
  const width = 47907;
  const margin = { l: 510, r: 510, t: 141, b: 141 };
  const interior = cellInteriorWidth(width, margin);
  const role = ctx.roleOr("summaryBox", { para: { align: "LEFT", lineSpacing: 160, hanging: 2048 }, char: { font: "table", pt: 15, spacing: -4, ratio: 97 } });
  const glyph = b.glyph === "none" ? "" : `${b.glyph ?? "❖"} `;
  const paras: XmlNode[] = [];
  let height = margin.t + margin.b;
  for (const line of b.lines) {
    const groups = splitInlinesByNewline(line);
    for (const g of groups.length ? groups : [[]]) {
      const inl = glyph ? [{ t: "text" as const, text: glyph }, ...g] : g;
      paras.push(ctx.cellPara({ paraPr: role.paraPr, runs: ctx.runsFor(inl, { font: "table", pt: 15, spacing: -4, ratio: 97 }, role.charPr), vertsize: 1500, lineSpacing: 160, horzsize: interior }));
      height += 2400 * ctx.lineCount(inlineText(inl), 15, interior - 2048);
    }
  }
  const thick = { type: "SOLID" as const, widthMm: 0.4, color: "#000000" };
  const bf = ctx.reg.borderFill({ l: "none", r: "none", t: thick, b: thick, fill: CHIP_FILL });
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [width],
    rows: [{ height, cells: [{ col: 0, borderFill: bf, margin, paragraphs: paras }] }],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: margin,
    outMargin: { l: 283, r: 283, t: 283, b: 283 },
  });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: 135 }, char: { font: "heading", pt: 16 } });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: height, lineSpacing: 100 });
}

// ---- 범정부오피스(범피스) 프로필 composites -------------------------------------------------

const BUMPIS_NAVY = "#1F3864";
const BUMPIS_UNDERLINE = "#4472C4";
const BUMPIS_TITLE_FILL = "#E6E6F5";

function hasApprovalMeta(doc: PlanDoc): boolean {
  const a = doc.meta.결재;
  return !!(doc.meta.등록번호 || (a && Object.values(a).some((v) => typeof v === "string" && v.trim())));
}

/** 제목 상자: 연보라 바탕 + 0.12mm 테두리, HY헤드라인M 18pt 가운데 (매뉴얼 14p·61p) */
function boxedTitle(ctx: WriterContext, b: Extract<Block, { k: "coverTitle" }>): XmlNode[] {
  const width = 47907;
  const margin = { l: 510, r: 510, t: 283, b: 283 };
  const pt = b.sizePt ?? 18;
  const paraPr = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 160 });
  const runs = ctx.runsFor(b.inlines, { font: "heading", pt });
  const bf = ctx.reg.borderFill({ l: {}, r: {}, t: {}, b: {}, fill: BUMPIS_TITLE_FILL });
  const lines = ctx.lineCount(inlineText(b.inlines), pt, cellInteriorWidth(width, margin));
  const height = Math.round(lines * pt * 100 * 1.6) + margin.t + margin.b;
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [width],
    rows: [{ height, cells: [{ col: 0, borderFill: bf, margin, paragraphs: [ctx.cellPara({ paraPr, runs, vertsize: pt * 100, lineSpacing: 160, horzsize: cellInteriorWidth(width, margin) })] }] }],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: margin,
    outMargin: { l: 140, r: 140, t: 140, b: 283 },
  });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: 135 }, char: { font: "heading", pt: 16 } });
  return [ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: height, lineSpacing: 100 }), emitBlank(ctx, PLAN_BLANK_STYLE)];
}

/** 소제목: 남색 번호 칩 + 제목(파란 밑줄) (매뉴얼 6p·14p·24p) */
function numberedChip(ctx: WriterContext, label: string, title: string): XmlNode {
  const cols = [2600, 45300];
  const margin = { l: 141, r: 141, t: 141, b: 141 };
  const navy = { type: "SOLID" as const, widthMm: 0.12, color: BUMPIS_NAVY };
  const under = { type: "SOLID" as const, widthMm: 0.5, color: BUMPIS_UNDERLINE };
  const bfNo = ctx.reg.borderFill({ l: navy, r: navy, t: navy, b: navy, fill: BUMPIS_NAVY });
  const bfTitle = ctx.reg.borderFill({ l: "none", r: "none", t: "none", b: under });
  const noPara = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 160 });
  const titlePara = ctx.reg.paraPr({ align: "LEFT", lineSpacing: 160 });
  const noChar = ctx.reg.charPr({ font: "heading", pt: 15, bold: true, color: "#FFFFFF" });
  const titleChar = ctx.reg.charPr({ font: "heading", pt: 15 });
  const h = 2600;
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols,
    rows: [
      {
        height: h,
        cells: [
          { col: 0, borderFill: bfNo, margin, paragraphs: [ctx.cellPara({ paraPr: noPara, runs: [{ charPr: noChar, text: label }], vertsize: 1500, lineSpacing: 160, horzsize: cellInteriorWidth(cols[0], margin) })] },
          { col: 1, borderFill: bfTitle, margin: { l: 510, r: 141, t: 141, b: 141 }, paragraphs: [ctx.cellPara({ paraPr: titlePara, runs: [{ charPr: titleChar, text: title }], vertsize: 1500, lineSpacing: 160, horzsize: cellInteriorWidth(cols[1], { l: 510, r: 141 }) })] },
        ],
      },
    ],
    borderFill: ctx.reg.noneBorderFill(),
    inMargin: margin,
    outMargin: { l: 140, r: 140, t: 283, b: 140 },
  });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: 135 }, char: { font: "heading", pt: 16 } });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: h, lineSpacing: 100 });
}

/** 글상자: 남색 이중선 상자 (매뉴얼 6p·14p) */
function textBox(ctx: WriterContext, b: Extract<Block, { k: "summaryBox" }>): XmlNode {
  const width = 47907;
  const margin = { l: 510, r: 510, t: 283, b: 283 };
  const interior = cellInteriorWidth(width, margin);
  const paraPr = ctx.reg.paraPr({ align: "JUSTIFY", lineSpacing: 160, hanging: 2048 });
  const base = { font: "table" as const, pt: 15 };
  const glyph = b.glyph === "none" ? "" : `${b.glyph ?? "◇"} `;
  const paras: XmlNode[] = [];
  let height = margin.t + margin.b;
  for (const line of b.lines) {
    for (const g of splitInlinesByNewline(line).length ? splitInlinesByNewline(line) : [[]]) {
      const inl = glyph ? [{ t: "text" as const, text: glyph }, ...g] : g;
      paras.push(ctx.cellPara({ paraPr, runs: ctx.runsFor(inl, base), vertsize: 1500, lineSpacing: 160, horzsize: interior }));
      height += 2400 * ctx.lineCount(inlineText(inl), 15, interior - 2048);
    }
  }
  const dbl = { type: "DOUBLE_SLIM" as const, widthMm: 0.5, color: BUMPIS_NAVY };
  const bf = ctx.reg.borderFill({ l: dbl, r: dbl, t: dbl, b: dbl });
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [width],
    rows: [{ height, cells: [{ col: 0, borderFill: bf, margin, paragraphs: paras }] }],
    borderFill: ctx.reg.noneBorderFill(),
    inMargin: margin,
    outMargin: { l: 283, r: 283, t: 283, b: 283 },
  });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: 135 }, char: { font: "heading", pt: 16 } });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: height, lineSpacing: 100 });
}

const PLAN_BLANK_STYLE: FamilyStyle = { bodyPt: 15, bodyLineSpacing: 160, body1Bold: false, body1Font: "body", notePt: 12, tableHeaderFill: "#D9D9D9", tableFontPt: 11, hangingIndent: true };
