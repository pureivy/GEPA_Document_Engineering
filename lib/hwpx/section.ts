/** Helpers for reading a reference section0.xml: top-level paragraphs and table summaries. */
import { childrenNamed, findAll, isNode, textOf, type XmlNode } from "./xml";

export function topLevelParagraphs(sec: XmlNode): XmlNode[] {
  return childrenNamed(sec, "hp:p");
}

export interface TableSummary {
  paraIndex: number;
  tableIndex: number; // among top-level tables in document order
  rowCnt: number;
  colCnt: number;
  width: number;
  height: number;
  treatAsChar: string;
  preview: string;
}

export function summarizeTables(sec: XmlNode): TableSummary[] {
  const out: TableSummary[] = [];
  let t = 0;
  topLevelParagraphs(sec).forEach((p, i) => {
    for (const run of childrenNamed(p, "hp:run")) {
      for (const c of run.children) {
        if (!isNode(c) || c.name !== "hp:tbl") continue;
        const sz = c.children.find((x): x is XmlNode => isNode(x) && x.name === "hp:sz");
        const pos = c.children.find((x): x is XmlNode => isNode(x) && x.name === "hp:pos");
        out.push({
          paraIndex: i,
          tableIndex: t++,
          rowCnt: Number(c.attrs.rowCnt),
          colCnt: Number(c.attrs.colCnt),
          width: Number(sz?.attrs.width ?? 0),
          height: Number(sz?.attrs.height ?? 0),
          treatAsChar: pos?.attrs.treatAsChar ?? "",
          preview: textOf(c).replace(/\s+/g, " ").trim().slice(0, 60),
        });
      }
    }
  });
  return out;
}

/** All hp:tbl nodes directly inside runs of a top-level paragraph. */
export function tablesOfParagraph(p: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  for (const run of childrenNamed(p, "hp:run")) for (const c of run.children) if (isNode(c) && c.name === "hp:tbl") out.push(c);
  return out;
}
export { findAll };
