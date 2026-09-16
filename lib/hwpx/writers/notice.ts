/** 공고문 writer: DocModel(notice) → hs:sec body paragraphs, replaying the 6-1 house geometry. */
import { type XmlNode } from "../xml";
import type { NoticeDoc, Block, Inline } from "../../docmodel/schema";
import { inlineText } from "../../docmodel/schema";
import { WriterContext } from "./context";
import { emitBlank, emitImage, emitPara, emitTable, type FamilyStyle, splitInlinesByNewline } from "./common";
import { table, cellInteriorWidth, type RowSpec } from "../emit/table";
import { pictureFrom } from "../emit/picture";
import { josa } from "./josa";
import { TEXT_WIDTH } from "../units";
import { greetingScope } from "../../docmodel/format";

export const NOTICE_STYLE: FamilyStyle = {
  bodyPt: 13,
  bodyLineSpacing: 160,
  body1Bold: false,
  body1Font: "body",
  notePt: 12,
  tableHeaderFill: "#DFE6F7",
  tableFontPt: 11,
  hangingIndent: true,
};

const TEAL = "#47B0BB";
const TEAL_LIGHT = "#D0EAED";
const LABEL_FILL = "#E7F4F6";
const INFO_FILL = "#FBFAF7";

export function writeNotice(ctx: WriterContext, doc: NoticeDoc): XmlNode[] {
  const out: XmlNode[] = [];
  const fs = NOTICE_STYLE;
  for (const b of doc.blocks) {
    switch (b.k) {
      case "noticeHeader":
        out.push(...noticeHeader(ctx, doc));
        break;
      case "infoBox":
        out.push(infoBox(ctx, b));
        break;
      case "sectionBar":
        out.push(sectionBar(ctx, b.number, b.title, b.variant));
        break;
      case "overviewTable":
        out.push(overviewTable(ctx, b));
        break;
      case "procedureFlow":
        out.push(...procedureFlow(ctx, b));
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
      case "attachmentList":
        out.push(...attachmentList(ctx, fs, b.items));
        break;
      default:
        ctx.warnings.push({ blockId: b.id, message: `block kind "${b.k}" is not supported in 공고문; skipped` });
    }
  }
  return out;
}

// ---- cover block --------------------------------------------------------------------

function noticeHeader(ctx: WriterContext, doc: NoticeDoc): XmlNode[] {
  const m = doc.meta;
  const out: XmlNode[] = [];
  const num = ctx.roleOr("noticeNumber", { para: { align: "JUSTIFY", lineSpacing: 125 }, char: { font: "heading", pt: 14 } });
  const title = ctx.roleOr("noticeTitle", { para: { align: "CENTER", lineSpacing: 125 }, char: { font: "heading", pt: 20 } });
  const greet = ctx.roleOr("greeting", { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "heading", pt: 15 } });
  const date = ctx.roleOr("noticeDate", { para: { align: "RIGHT", lineSpacing: 150, firstLine: 1500 }, char: { font: "heading", pt: 16 } });
  const blankCover = ctx.roleOr("blankCover", { para: { align: "CENTER", lineSpacing: 105 }, char: { font: "heading", pt: 16 } });

  // 1. 공고번호 (page number control lives in this first run, as in the reference)
  const pageNumNodes = ctx.tpl.pageNumCtrl ? [ctx.tpl.pageNumCtrl] : [];
  out.push(ctx.para({ paraPr: num.paraPr, runs: [{ charPr: num.charPr, nodes: pageNumNodes, text: `(재)경상북도경제진흥원 공고 제${m.공고번호}호` }], vertsize: 1400, lineSpacing: 125 }));
  out.push(ctx.para({ paraPr: blankCover.paraPr, runs: [{ charPr: blankCover.charPr, text: "" }], vertsize: 1600, lineSpacing: 105 }));
  // 2. 제목 (2 lines)
  const sub = m.부제 ? `(${m.부제})` : "";
  out.push(ctx.para({ paraPr: title.paraPr, runs: [{ charPr: title.charPr, text: `「${m.사업명}」\n${m.모집대상} 모집 공고${sub}` }], vertsize: 2000, lineSpacing: 125 }));
  out.push(emitBlank(ctx, NOTICE_STYLE));
  // 3. 인사말
  const greeting = `  ${m.주관기관}${josa.와과(m.주관기관)} (재)경상북도경제진흥원에서 추진하는 「${m.사업명}」${m.모집대상}${josa.을를(m.모집대상)} 모집하오니 ${greetingScope(m.지역, m.대상기업군)}의 많은 참여를 바랍니다.`;
  out.push(ctx.para({ paraPr: greet.paraPr, runs: [{ charPr: greet.charPr, text: greeting }], vertsize: 1500, lineSpacing: 160 }));
  out.push(emitBlank(ctx, NOTICE_STYLE));
  // 4. 날짜 / 기관장
  out.push(ctx.para({ paraPr: date.paraPr, runs: [{ charPr: date.charPr, text: `${m.공고연월}   ` }], vertsize: 1600, lineSpacing: 150 }));
  out.push(ctx.para({ paraPr: date.paraPr, runs: [{ charPr: date.charPr, text: m.기관장 }], vertsize: 1600, lineSpacing: 150 }));
  out.push(ctx.para({ paraPr: date.paraPr, runs: [{ charPr: date.charPr, text: "" }], vertsize: 1600, lineSpacing: 150 }));
  out.push(ctx.para({ paraPr: date.paraPr, runs: [{ charPr: date.charPr, text: "" }], vertsize: 1600, lineSpacing: 150 }));
  return out;
}

// ---- 안내박스 ------------------------------------------------------------------------

function infoBox(ctx: WriterContext, b: Extract<Block, { k: "infoBox" }>): XmlNode {
  const width = 47624;
  const margin = { l: 510, r: 510, t: 141, b: 141 };
  const interior = cellInteriorWidth(width, margin);
  const heading = ctx.roleOr("infoBoxHeading", { para: { align: "JUSTIFY", lineSpacing: 160, hanging: 2056 }, char: { font: "note", pt: 15, bold: true, spacing: -5 } });
  const item = ctx.roleOr("infoBoxItem", { para: { align: "JUSTIFY", lineSpacing: 160, hanging: 2588 }, char: { font: "note", pt: 13, spacing: -5 } });
  const paras: XmlNode[] = [];
  let height = margin.t + margin.b;
  b.groups.forEach((g, gi) => {
    if (gi > 0) {
      paras.push(ctx.cellPara({ paraPr: item.paraPr, runs: [{ charPr: item.charPr, text: "" }], vertsize: 1300, lineSpacing: 160, horzsize: interior }));
      height += 2080;
    }
    paras.push(ctx.cellPara({ paraPr: heading.paraPr, runs: [{ charPr: heading.charPr, text: `□ ${g.heading}` }], vertsize: 1500, lineSpacing: 160, horzsize: interior }));
    height += 2400;
    for (const it of g.items) {
      const inl: Inline[] = [{ t: "text", text: " ○ " }, ...it];
      const runs = ctx.runsFor(inl, { font: "note", pt: 13, spacing: -5 }, item.charPr);
      paras.push(ctx.cellPara({ paraPr: item.paraPr, runs, vertsize: 1300, lineSpacing: 160, horzsize: interior }));
      height += 2080 * ctx.lineCount(inlineText(inl), 13, interior - 2588);
    }
  });
  const cellBf = ctx.reg.borderFill({ l: { type: "DASH" }, r: { type: "DASH" }, t: { type: "DASH" }, b: { type: "DASH" }, fill: INFO_FILL });
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [width],
    rows: [{ height, cells: [{ col: 0, borderFill: cellBf, paragraphs: paras, margin }] }],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: margin,
    outMargin: { l: 283, r: 283, t: 283, b: 283 },
    treatAsChar: false,
    horzRelTo: "COLUMN",
  });
  const anchor = ctx.roleOr("infoBoxAnchor", { para: { align: "RIGHT", lineSpacing: 150 }, char: { font: "heading", pt: 15 } });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl], text: "" }], vertsize: 1500, lineSpacing: 150 });
}

// ---- 섹션 제목바 ----------------------------------------------------------------------

export function sectionBar(ctx: WriterContext, number: number, title: string, variant: "tall" | "short" = "tall"): XmlNode {
  const titleRole = ctx.roleOr("sectionBarTitle", { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "heading", pt: 15 } });
  const stripRole = ctx.roleOr("sectionBarStrip", { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "바탕", pt: 2 } });
  const margin = { l: 141, r: 141, t: 141, b: 141 };
  const interior = cellInteriorWidth(TEXT_WIDTH, margin);
  const row0 = variant === "short" ? 2565 : 2848;
  const rows: RowSpec[] = [
    {
      height: row0,
      cells: [{ col: 0, borderFill: ctx.reg.noneBorderFill(), margin, paragraphs: [ctx.cellPara({ paraPr: titleRole.paraPr, runs: [{ charPr: titleRole.charPr, text: `${number}. ${title}` }], vertsize: 1500, lineSpacing: 160, horzsize: interior })] }],
    },
    {
      height: 0,
      cells: [
        {
          col: 0,
          borderFill: ctx.reg.borderFill({ l: "none", r: "none", t: "none", b: "none", gradient: { colors: [TEAL, TEAL_LIGHT], angle: "90" } }),
          margin,
          height: 0,
          paragraphs: [ctx.cellPara({ paraPr: stripRole.paraPr, runs: [{ charPr: stripRole.charPr, text: "" }], vertsize: 200, lineSpacing: 160, horzsize: interior })],
        },
      ],
    },
  ];
  const height = row0 + 482;
  const tbl = table({ id: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder(), cols: [TEXT_WIDTH], rows, borderFill: ctx.reg.gridBorderFill(), inMargin: margin, height });
  const anchor = ctx.roleOr("sectionBarAnchor", { para: { align: "JUSTIFY", lineSpacing: 153 }, char: { font: "heading", pt: 16 } });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: height, lineSpacing: 125 });
}

// ---- 모집개요표 ----------------------------------------------------------------------

function overviewTable(ctx: WriterContext, b: Extract<Block, { k: "overviewTable" }>): XmlNode {
  const cols = [2284, 13321, 1303, 31433];
  const margin = { l: 510, r: 510, t: 141, b: 141 };
  const bullet = ctx.roleOr("overviewBullet", { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "body", pt: 13, bold: true } });
  const label = ctx.roleOr("overviewLabel", { para: { align: "DISTRIBUTE", lineSpacing: 160 }, char: { font: "body", pt: 13, bold: true } });
  const value = ctx.roleOr("overviewValue", { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "body", pt: 13 } });
  const dash = (): { type: "DASH" } => ({ type: "DASH" });
  const teal = (): { type: "SOLID"; widthMm: number; color: string } => ({ type: "SOLID", widthMm: 0.4, color: TEAL });
  const rows = b.rows;
  const n = rows.length;
  // border pattern: first row top teal; row before a spacer / last row bottom teal; spacer row teal top+bottom; row after spacer top none
  const rowSpecs: RowSpec[] = rows.map((r, i) => {
    const prevSpacer = i > 0 && rows[i - 1] === "spacer";
    const nextSpacer = i + 1 < n && rows[i + 1] === "spacer";
    const first = i === 0;
    const last = i === n - 1;
    if (r === "spacer") {
      const bf = ctx.reg.borderFill({ l: "none", r: "none", t: teal(), b: teal() });
      return {
        height: 1865,
        cells: cols.map((_, ci) => ({ col: ci, borderFill: bf, margin, paragraphs: [ctx.cellPara({ paraPr: ci === 1 ? label.paraPr : value.paraPr, runs: [{ charPr: ci === 1 ? label.charPr : value.charPr, text: "" }], vertsize: 1300, lineSpacing: 160, horzsize: cellInteriorWidth(cols[ci], margin) })] })),
      };
    }
    const top = first ? teal() : prevSpacer ? "none" : dash();
    const bottom = last || nextSpacer ? teal() : dash();
    const bfLabel = ctx.reg.borderFill({ l: "none", r: "none", t: top, b: bottom, fill: LABEL_FILL });
    const bfValue = ctx.reg.borderFill({ l: "none", r: "none", t: top, b: bottom });
    const valueGroups = splitInlinesByNewline(r.value);
    const interiorV = cellInteriorWidth(cols[3], margin);
    const valueParas = (valueGroups.length ? valueGroups : [[]]).map((g) => ctx.cellPara({ paraPr: value.paraPr, runs: ctx.runsFor(g, { font: "body", pt: 13 }, value.charPr), vertsize: 1300, lineSpacing: 160, horzsize: interiorV }));
    const lines = valueGroups.reduce((s, g) => s + ctx.lineCount(inlineText(g), 13, interiorV), 0) || 1;
    const height = Math.max(prevSpacer || last ? 2219 : 2355, lines * 2080 + 282);
    return {
      height,
      cells: [
        { col: 0, borderFill: bfLabel, margin, paragraphs: [ctx.cellPara({ paraPr: bullet.paraPr, runs: [{ charPr: bullet.charPr, text: r.bullet === false ? "" : "○" }], vertsize: 1300, lineSpacing: 160, horzsize: cellInteriorWidth(cols[0], margin) })] },
        { col: 1, borderFill: bfLabel, margin, paragraphs: [ctx.cellPara({ paraPr: label.paraPr, runs: [{ charPr: label.charPr, text: r.label }], vertsize: 1300, lineSpacing: 160, horzsize: cellInteriorWidth(cols[1], margin) })] },
        { col: 2, borderFill: bfLabel, margin, paragraphs: [ctx.cellPara({ paraPr: value.paraPr, runs: [{ charPr: value.charPr, text: ":" }], vertsize: 1300, lineSpacing: 160, horzsize: cellInteriorWidth(cols[2], margin) })] },
        { col: 3, borderFill: bfValue, margin, paragraphs: valueParas },
      ],
    };
  });
  const tbl = table({ id: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder(), cols, rows: rowSpecs, borderFill: ctx.reg.gridBorderFill(), inMargin: margin, noAdjust: true });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "body", pt: 13 } });
  const height = rowSpecs.reduce((a, r) => a + r.height, 0);
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: height, lineSpacing: 100 });
}

// ---- 지원절차 절차도 --------------------------------------------------------------------

/**
 * 절차도. 단계가 5개를 넘으면 두 줄로 나눠 그린다(user, 2026-09-16) — 첫 줄 ⌈n/2⌉단계, 둘째 줄 나머지;
 * 각 줄은 독립된 표라 칸 너비가 넉넉해진다.
 */
export function procedureFlow(ctx: WriterContext, b: Extract<Block, { k: "procedureFlow" }>): XmlNode[] {
  const stages = b.stages.length ? b.stages : [{ name: "모집공고", when: "" }];
  if (stages.length <= 5) return [flowRow(ctx, stages, false)];
  const first = Math.ceil(stages.length / 2);
  return [flowRow(ctx, stages.slice(0, first), true), flowRow(ctx, stages.slice(first), false)];
}

function flowRow(ctx: WriterContext, stages: { name: string; when: string }[], continues: boolean): XmlNode {
  const n = stages.length;
  const totalWidth = 48144;
  const arrowW = 2590;
  const stageW = Math.floor((totalWidth - arrowW * (n - 1)) / n);
  const cols: number[] = [];
  for (let i = 0; i < n; i++) {
    cols.push(stageW);
    if (i < n - 1) cols.push(arrowW);
  }
  cols[cols.length - 1] += totalWidth - cols.reduce((a, c) => a + c, 0);
  const margin = { l: 510, r: 510, t: 141, b: 141 };
  const header = ctx.roleOr("flowHeader", { para: { align: "CENTER", lineSpacing: 130 }, char: { font: "table", pt: 11, bold: true } });
  const value = ctx.roleOr("flowValue", { para: { align: "CENTER", lineSpacing: 130 }, char: { font: "table", pt: 11 } });
  const grey = (): { type: "SOLID"; widthMm: number; color: string } => ({ type: "SOLID", widthMm: 0.4, color: "#808080" });
  const bfHeader = ctx.reg.borderFill({ l: grey(), r: grey(), t: grey(), b: "none", fill: "#BFBFBF" });
  const bfValue = ctx.reg.borderFill({ l: grey(), r: grey(), t: "none", b: grey(), fill: "#DFE6F7" });
  const bfArrow = ctx.reg.borderFill({ l: grey(), r: grey(), t: "none", b: "none" });
  // the chevron picture is image2 of the notice template only; the plan template's image2 is the GEPA logo (user report 2026-09-16)
  const chevronRef = ctx.family === "notice" ? ctx.tpl.pics["image2"] : undefined;
  const row0: RowSpec = { height: 3097, cells: [] };
  const row1: RowSpec = { height: 2881, cells: [] };
  stages.forEach((s, i) => {
    const col = i * 2;
    // a continued row ends its last stage with a trailing arrow marker so the reader knows it goes on
    const name = continues && i === n - 1 ? `${s.name} ⇩` : s.name;
    row0.cells.push({ col, borderFill: bfHeader, margin, paragraphs: [ctx.cellPara({ paraPr: header.paraPr, runs: [{ charPr: header.charPr, text: name }], vertsize: 1100, lineSpacing: 130, horzsize: cellInteriorWidth(cols[col], margin) })] });
    row1.cells.push({ col, borderFill: bfValue, margin, paragraphs: [ctx.cellPara({ paraPr: value.paraPr, runs: [{ charPr: value.charPr, text: s.when }], vertsize: 1100, lineSpacing: 130, horzsize: cellInteriorWidth(cols[col], margin) })] });
    if (i < n - 1) {
      const nodes = chevronRef ? [pictureFrom(chevronRef, { id: ctx.ids.nextShapeId(), instid: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder() })] : [];
      row0.cells.push({ col: col + 1, rowSpan: 2, borderFill: bfArrow, margin, paragraphs: [ctx.cellPara({ paraPr: value.paraPr, runs: [{ charPr: value.charPr, nodes, text: chevronRef ? undefined : "⇒" }], vertsize: 1417, lineSpacing: 130, horzsize: cellInteriorWidth(cols[col + 1], margin) })] });
    }
  });
  const tbl = table({ id: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder(), cols, rows: [row0, row1], borderFill: ctx.reg.gridBorderFill(), inMargin: margin, outMargin: { l: 140, r: 140, t: 140, b: continues ? 420 : 140 } });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "body", pt: 13 } });
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: 5978, lineSpacing: 100 });
}

function attachmentList(ctx: WriterContext, fs: FamilyStyle, items: string[]): XmlNode[] {
  const out: XmlNode[] = [];
  const r = ctx.roleOr("body1", { para: { align: "JUSTIFY", lineSpacing: fs.bodyLineSpacing }, char: { font: "body", pt: fs.bodyPt } });
  items.forEach((it, i) => {
    const text = i === 0 ? `붙임  ${it}` : `      ${it}`;
    const last = i === items.length - 1 ? `${text}  끝.` : text;
    out.push(ctx.para({ paraPr: r.paraPr, runs: [{ charPr: r.charPr, text: last }], vertsize: fs.bodyPt * 100, lineSpacing: fs.bodyLineSpacing }));
  });
  return out;
}
