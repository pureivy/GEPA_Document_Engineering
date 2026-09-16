import { el, type XmlChild, type XmlNode } from "../xml";
import { linesegArray } from "../lineseg";
import { LINESEG_WIDTH } from "../units";

export interface RunSpec {
  charPr: number;
  /** plain text; '\n' becomes <hp:lineBreak/> */
  text?: string;
  /** raw children (tables, pictures, ctrl) placed inside the run instead of text */
  nodes?: XmlChild[];
  /** hyperlink: wraps text in a HYPERLINK field */
  href?: string;
  /** field id for the hyperlink / formula (deterministic when supplied by the writer context) */
  fieldId?: number;
  /**
   * table formula: wraps the text in a FORMULA field (Hancom recalculates on demand, e.g.
   * `=SUM(?2:?6)??%g;;100`); `text` is the cached result shown by readers that do not
   */
  formula?: string;
}

export interface ParagraphSpec {
  id: number;
  paraPr: number;
  runs: RunSpec[];
  pageBreak?: boolean;
  /** char height for the lineseg (HWPUNIT). Defaults to the largest run's declared height or 1300. */
  vertsize?: number;
  lineSpacing?: number; // percent, for lineseg spacing
  horzsize?: number; // lineseg width (cell interior width when inside a cell)
  styleId?: number;
  columnBreak?: boolean;
  /** emit an approximate hp:linesegarray (default false: Hancom/rhwp re-layout from scratch) */
  lineseg?: boolean;
}

export function textChildren(text: string): XmlChild[] {
  const parts = text.split("\n");
  const out: XmlChild[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(el("hp:lineBreak"));
    if (p) out.push(p);
  });
  return out;
}

let fieldSeq = 1_700_000_000;
export function hyperlinkRunChildren(text: string, href: string, fieldId?: number): XmlChild[] {
  const id = String(fieldId ?? fieldSeq++);
  const cmd = href.replace(/:/g, "\\:") + ";1;0;0;";
  return [
    el("hp:ctrl", {}, [
      el("hp:fieldBegin", { id, type: "HYPERLINK", name: "", editable: "0", dirty: "1" }, [
        el("hp:parameters", { cnt: "1", name: "" }, [el("hp:stringParam", { name: "Command" }, [cmd])]),
      ]),
    ]),
    el("hp:t", {}, textChildren(text)),
    el("hp:ctrl", {}, [el("hp:fieldEnd", { beginIDRef: id })]),
  ];
}

/**
 * 합계 cell of a table column: `=SUM(?<from>:?<to>)??<fmt>;;<value>` — `?` is the current
 * column, rows are 1-based, `%g` (or `%g,` with thousands separators) is the display format
 * and the trailing value is the cached result (6-1 reference: `=SUM(?2:?6)??%g;;100`).
 */
export function sumFormula(fromRow: number, toRow: number, value: string): string {
  const fmt = value.includes(",") ? "%g," : "%g";
  return `=SUM(?${fromRow}:?${toRow})??${fmt};;${value.replace(/,/g, "")}`;
}

export function formulaRunChildren(text: string, command: string, fieldId?: number): XmlChild[] {
  const id = String(fieldId ?? fieldSeq++);
  return [
    el("hp:ctrl", {}, [
      el("hp:fieldBegin", { id, type: "FORMULA", name: "", editable: "0", dirty: "0" }, [
        el("hp:parameters", { cnt: "1", name: "" }, [el("hp:stringParam", { name: "Command" }, [command])]),
      ]),
    ]),
    el("hp:t", {}, textChildren(text)),
    el("hp:ctrl", {}, [el("hp:fieldEnd", { beginIDRef: id })]),
  ];
}

export function paragraph(spec: ParagraphSpec): XmlNode {
  const runs: XmlNode[] = [];
  // Hancom merges consecutive runs with the same charPr; we emit one run per RunSpec but
  // pack adjacent same-charPr text specs into one run for tidiness.
  for (const r of spec.runs) {
    const kids: XmlChild[] = [];
    if (r.nodes) kids.push(...r.nodes);
    if (r.href !== undefined) kids.push(...hyperlinkRunChildren(r.text ?? "", r.href, r.fieldId));
    else if (r.formula !== undefined) kids.push(...formulaRunChildren(r.text ?? "", r.formula, r.fieldId));
    else if (r.text !== undefined) kids.push(el("hp:t", {}, textChildren(r.text)));
    const last = runs[runs.length - 1];
    if (last && last.attrs.charPrIDRef === String(r.charPr) && !r.nodes && r.href === undefined && r.formula === undefined && r.text !== undefined) {
      const lastT = last.children[last.children.length - 1];
      if (typeof lastT !== "string" && lastT.name === "hp:t") {
        lastT.children.push(...textChildren(r.text));
        continue;
      }
    }
    runs.push(el("hp:run", { charPrIDRef: r.charPr }, kids));
  }
  if (runs.length === 0) runs.push(el("hp:run", { charPrIDRef: spec.runs[0]?.charPr ?? 0 }, [el("hp:t")]));
  return el(
    "hp:p",
    {
      id: spec.id,
      paraPrIDRef: spec.paraPr,
      styleIDRef: spec.styleId ?? 0,
      pageBreak: spec.pageBreak ? 1 : 0,
      columnBreak: spec.columnBreak ? 1 : 0,
      merged: 0,
    },
    spec.lineseg ? [...runs, linesegArray(spec.vertsize ?? 1300, spec.lineSpacing ?? 160, spec.horzsize ?? LINESEG_WIDTH)] : runs,
  );
}
