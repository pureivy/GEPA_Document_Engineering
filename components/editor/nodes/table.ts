import { Node } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import type { BorderSpec, Cell, Family, TableStyle } from "@/lib/docmodel/schema";
import { N } from "@/lib/docmodel/prosemirror/schema";
import { cssAlign } from "./paragraph";

/**
 * `gepaTable` / `gepaRow` / `gepaCell` — a DocModel `table` block, 1:1 with rows and cells.
 *
 * These are plain ProseMirror nodes on purpose (not `@tiptap/extension-table`):
 * prosemirror-tables' `fixTables` rewrites merged-cell grids on every transaction, which
 * would break the deep-equal round trip. Span shadows (`covered`) are kept as real hidden
 * cells; the anchor cell renders the HTML colspan/rowspan.
 */
export interface GepaTableOptions {
  family: Family;
}

const hidden = { default: null, rendered: false } as const;

export const DEFAULT_HEADER_FILL: Record<Family, string> = { plan: "#d9d9d9", notice: "#dfe6f7", press: "#dfe6f7", official: "#dfe6f7", report: "#dfe6f7" };
export const DEFAULT_TOTAL_FILL = "#d9d9d9";

export const GepaTable = Node.create<GepaTableOptions>({
  name: N.table,
  group: "block",
  content: `${N.row}+`,
  isolating: true,
  addOptions() {
    return { family: "notice" };
  },
  addAttributes() {
    return {
      blockId: hidden,
      role: { default: "generic", rendered: false },
      caption: hidden,
      widthsPt: hidden,
      headerRows: hidden,
      style: hidden,
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-gepa-table]",
        contentElement: "tbody",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          const j = e.getAttribute("data-json");
          try {
            return j ? (JSON.parse(j) as Record<string, unknown>) : null;
          } catch {
            return null;
          }
        },
      },
    ];
  },
  renderHTML({ node }) {
    const style = (node.attrs.style ?? null) as TableStyle | null;
    const widths = (node.attrs.widthsPt ?? null) as number[] | null;
    const border = style?.border ?? "grid012";
    const cls = `hwp-table hwp-table-${node.attrs.role} hwp-border-${border}${style?.padding === "tight" ? " hwp-pad-tight" : ""}`;
    const tstyle: string[] = [];
    if (style?.fontPt) tstyle.push(`--hwp-table-pt:${style.fontPt}pt`);
    if (style?.headerFontPt) tstyle.push(`--hwp-table-hpt:${style.headerFontPt}pt`);
    if (style?.headerFill) tstyle.push(`--hwp-header-fill:${style.headerFill}`);
    if (style?.totalFill) tstyle.push(`--hwp-total-fill:${style.totalFill}`);
    if (style?.borderColor) tstyle.push(`--hwp-border-color:${style.borderColor}`);
    if (style?.lineSpacing) tstyle.push(`--hwp-table-lh:${style.lineSpacing / 100}`);
    const total = widths?.reduce((a, b) => a + b, 0) ?? 0;
    if (total > 0) tstyle.push(`width:${total}pt`);
    type Spec = [string, Record<string, string>, ...DOMOutputSpec[]];
    const table: Spec = ["table", { class: cls, style: tstyle.join(";") }];
    if (widths && widths.length) {
      const cols: Spec = ["colgroup", {}];
      for (const w of widths) cols.push(["col", { style: `width:${w}pt` }]);
      table.push(cols);
    }
    table.push(["tbody", {}, 0]);
    const attrsJson = JSON.stringify({ blockId: node.attrs.blockId, role: node.attrs.role, caption: node.attrs.caption, widthsPt: widths, headerRows: node.attrs.headerRows, style });
    const wrap: Spec = ["div", { "data-gepa-table": "", "data-json": attrsJson, class: "hwp-table-wrap" }];
    if (node.attrs.caption) wrap.push(["div", { class: "hwp-table-caption", contenteditable: "false" }, String(node.attrs.caption)]);
    wrap.push(table);
    return wrap;
  },
});

export const GepaRow = Node.create({
  name: N.row,
  content: `${N.cell}+`,
  addAttributes() {
    return { heightPt: hidden, isHeader: hidden, isTotal: hidden };
  },
  parseHTML() {
    return [
      {
        tag: "tr",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          return { heightPt: e.getAttribute("data-h") ? Number(e.getAttribute("data-h")) : null, isHeader: e.hasAttribute("data-header") ? true : null, isTotal: e.hasAttribute("data-total") ? true : null };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const attrs: Record<string, string> = { class: `hwp-tr${node.attrs.isHeader ? " hwp-tr-header" : ""}${node.attrs.isTotal ? " hwp-tr-total" : ""}` };
    if (node.attrs.heightPt) {
      attrs.style = `height:${node.attrs.heightPt}pt`;
      attrs["data-h"] = String(node.attrs.heightPt);
    }
    if (node.attrs.isHeader) attrs["data-header"] = "";
    if (node.attrs.isTotal) attrs["data-total"] = "";
    return ["tr", attrs, 0];
  },
});

function borderCss(side: "l" | "r" | "t" | "b", spec: BorderSpec | undefined): string {
  if (!spec) return "";
  const prop = { l: "border-left", r: "border-right", t: "border-top", b: "border-bottom" }[side];
  if (spec.type === "none") return `${prop}:none;`;
  const type = spec.type === "dash" ? "dashed" : spec.type === "dot" ? "dotted" : spec.type === "double" ? "double" : "solid";
  const px = Math.max(0.5, (spec.widthMm ?? 0.12) * 3.78);
  return `${prop}:${px.toFixed(2)}px ${type} ${spec.color ?? "#000"};`;
}

export const GepaCell = Node.create({
  name: N.cell,
  content: "inline*",
  isolating: true,
  addAttributes() {
    return {
      colSpan: hidden,
      rowSpan: hidden,
      fill: hidden,
      align: hidden,
      valign: hidden,
      bold: hidden,
      borders: hidden,
      covered: hidden,
    };
  },
  parseHTML() {
    return [
      {
        tag: "td",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          const j = e.getAttribute("data-json");
          try {
            return j ? (JSON.parse(j) as Record<string, unknown>) : {};
          } catch {
            return {};
          }
        },
      },
      { tag: "th", getAttrs: () => ({ bold: true }) },
    ];
  },
  renderHTML({ node }) {
    const a = node.attrs as Partial<Cell> & { covered?: boolean | null };
    const attrs: Record<string, string> = {
      class: `hwp-td${a.covered ? " hwp-td-covered" : ""}${a.bold ? " hwp-td-bold" : ""}`,
      "data-json": JSON.stringify({ colSpan: a.colSpan ?? null, rowSpan: a.rowSpan ?? null, fill: a.fill ?? null, align: a.align ?? null, valign: a.valign ?? null, bold: a.bold ?? null, borders: a.borders ?? null, covered: a.covered ?? null }),
    };
    if (a.colSpan && a.colSpan > 1) attrs.colspan = String(a.colSpan);
    if (a.rowSpan && a.rowSpan > 1) attrs.rowspan = String(a.rowSpan);
    let style = "";
    if (a.fill) style += `background:${a.fill};`;
    if (a.align) style += `text-align:${cssAlign(a.align)};`;
    if (a.valign) style += `vertical-align:${a.valign};`;
    if (a.borders) {
      style += borderCss("l", a.borders.l) + borderCss("r", a.borders.r) + borderCss("t", a.borders.t) + borderCss("b", a.borders.b);
    }
    if (style) attrs.style = style;
    if (a.covered) attrs.contenteditable = "false";
    return ["td", attrs, 0];
  },
  addKeyboardShortcuts() {
    return {
      // a cell is a single paragraph: Enter inserts an in-cell line break instead of splitting the cell
      Enter: () => this.editor.commands.setHardBreak(),
    };
  },
});
