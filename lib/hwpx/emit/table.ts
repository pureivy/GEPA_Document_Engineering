import { el, type XmlNode } from "../xml";

export interface CellSpec {
  col: number; // column index of the anchor
  colSpan?: number;
  rowSpan?: number;
  borderFill: number;
  paragraphs: XmlNode[]; // hp:p nodes (already built with cell-interior horzsize)
  vertAlign?: "TOP" | "CENTER" | "BOTTOM";
  /** cell margins (HWPUNIT); default = table inMargin */
  margin?: { l: number; r: number; t: number; b: number };
  /** explicit height override for the anchor cell (default = Σ spanned row heights) */
  height?: number;
  header?: boolean;
}
export interface RowSpec {
  height: number; // HWPUNIT
  cells: CellSpec[]; // anchors only, in column order; covered positions omitted
}
export interface TableSpec {
  id: number;
  zOrder: number;
  cols: number[]; // column widths (HWPUNIT)
  rows: RowSpec[];
  borderFill: number; // table frame borderFill
  inMargin?: { l: number; r: number; t: number; b: number };
  outMargin?: { l: number; r: number; t: number; b: number };
  treatAsChar?: boolean; // default true
  horzRelTo?: "PARA" | "COLUMN";
  pageBreak?: "CELL" | "TABLE" | "NONE";
  repeatHeader?: boolean;
  noAdjust?: boolean;
  cellSpacing?: number;
  /** override table height (default Σ row heights) */
  height?: number;
  flowWithText?: boolean;
  holdAnchorAndSO?: boolean;
}

export function table(spec: TableSpec): XmlNode {
  const width = spec.cols.reduce((a, b) => a + b, 0);
  const height = spec.height ?? spec.rows.reduce((a, r) => a + r.height, 0);
  const im = spec.inMargin ?? { l: 510, r: 510, t: 141, b: 141 };
  const om = spec.outMargin ?? { l: 0, r: 0, t: 0, b: 0 };
  const trs: XmlNode[] = spec.rows.map((row, ri) =>
    el(
      "hp:tr",
      {},
      row.cells.map((c) => {
        const colSpan = c.colSpan ?? 1;
        const rowSpan = c.rowSpan ?? 1;
        const w = spec.cols.slice(c.col, c.col + colSpan).reduce((a, b) => a + b, 0);
        const h = c.height ?? spec.rows.slice(ri, ri + rowSpan).reduce((a, r) => a + r.height, 0);
        const m = c.margin ?? im;
        return el("hp:tc", { name: "", header: c.header ? 1 : 0, hasMargin: 0, protect: 0, editable: 0, dirty: 0, borderFillIDRef: c.borderFill }, [
          el(
            "hp:subList",
            { id: "", textDirection: "HORIZONTAL", lineWrap: "BREAK", vertAlign: c.vertAlign ?? "CENTER", linkListIDRef: 0, linkListNextIDRef: 0, textWidth: 0, textHeight: 0, hasTextRef: 0, hasNumRef: 0 },
            c.paragraphs,
          ),
          el("hp:cellAddr", { colAddr: c.col, rowAddr: ri }),
          el("hp:cellSpan", { colSpan, rowSpan }),
          el("hp:cellSz", { width: w, height: h }),
          el("hp:cellMargin", { left: m.l, right: m.r, top: m.t, bottom: m.b }),
        ]);
      }),
    ),
  );
  return el(
    "hp:tbl",
    {
      id: spec.id,
      zOrder: spec.zOrder,
      numberingType: "TABLE",
      textWrap: "TOP_AND_BOTTOM",
      textFlow: "BOTH_SIDES",
      lock: 0,
      dropcapstyle: "None",
      pageBreak: spec.pageBreak ?? "CELL",
      repeatHeader: spec.repeatHeader === false ? 0 : 1,
      rowCnt: spec.rows.length,
      colCnt: spec.cols.length,
      cellSpacing: spec.cellSpacing ?? 0,
      borderFillIDRef: spec.borderFill,
      noAdjust: spec.noAdjust ? 1 : 0,
    },
    [
      el("hp:sz", { width, widthRelTo: "ABSOLUTE", height, heightRelTo: "ABSOLUTE", protect: 0 }),
      el("hp:pos", {
        treatAsChar: spec.treatAsChar === false ? 0 : 1,
        affectLSpacing: 0,
        flowWithText: spec.flowWithText === false ? 0 : 1,
        allowOverlap: 0,
        holdAnchorAndSO: spec.holdAnchorAndSO ? 1 : 0,
        vertRelTo: "PARA",
        horzRelTo: spec.horzRelTo ?? "PARA",
        vertAlign: "TOP",
        horzAlign: "LEFT",
        vertOffset: 0,
        horzOffset: 0,
      }),
      el("hp:outMargin", { left: om.l, right: om.r, top: om.t, bottom: om.b }),
      el("hp:inMargin", { left: im.l, right: im.r, top: im.t, bottom: im.b }),
      ...trs,
    ],
  );
}

/** Interior width available to paragraphs inside a cell (for lineseg horzsize). */
export function cellInteriorWidth(cellWidth: number, margin: { l: number; r: number }): number {
  return Math.max(cellWidth - margin.l - margin.r, 1000);
}
