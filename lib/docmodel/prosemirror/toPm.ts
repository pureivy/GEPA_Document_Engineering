/**
 * DocModel → ProseMirror JSON (pure transform, see ./schema.ts for the conventions).
 */
import type { Block, Cell, DocModel, Inline, Row } from "../schema";
import { M, N, type PmDoc, type PmMark, type PmNode } from "./schema";

const nn = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Inline[] → PM inline nodes (text with marks, hardBreak). Empty text inlines are dropped. */
export function inlinesToPm(inlines: Inline[]): PmNode[] {
  const out: PmNode[] = [];
  for (const inl of inlines) {
    if (inl.t === "br") {
      out.push({ type: N.hardBreak });
      continue;
    }
    if (inl.t === "link") {
      if (!inl.text) continue;
      out.push({ type: N.text, text: inl.text, marks: [{ type: M.link, attrs: { href: inl.href } }] });
      continue;
    }
    if (!inl.text) continue;
    const marks: PmMark[] = [];
    if (inl.bold) marks.push({ type: M.bold });
    if (inl.color !== undefined || inl.size !== undefined || inl.font !== undefined) {
      marks.push({ type: M.style, attrs: { color: nn(inl.color), size: nn(inl.size), font: nn(inl.font) } });
    }
    const node: PmNode = { type: N.text, text: inl.text };
    if (marks.length) node.marks = marks;
    out.push(node);
  }
  return out;
}

/** plain string → PM text* content */
export function stringToPm(s: string): PmNode[] {
  return s ? [{ type: N.text, text: s }] : [];
}

function cellToPm(c: Cell): PmNode {
  return {
    type: N.cell,
    attrs: {
      colSpan: nn(c.colSpan),
      rowSpan: nn(c.rowSpan),
      fill: nn(c.fill),
      align: nn(c.align),
      valign: nn(c.valign),
      bold: nn(c.bold),
      borders: c.borders === undefined ? null : clone(c.borders),
      covered: nn(c.covered),
    },
    content: inlinesToPm(c.inlines),
  };
}

function rowToPm(r: Row): PmNode {
  return {
    type: N.row,
    attrs: { heightPt: nn(r.heightPt), isHeader: nn(r.isHeader), isTotal: nn(r.isTotal) },
    content: r.cells.map(cellToPm),
  };
}

export function blockToPm(block: Block): PmNode {
  const id = { blockId: block.id };
  switch (block.k) {
    case "para":
      return {
        type: N.paragraph,
        attrs: {
          ...id,
          role: block.role,
          glyph: nn(block.glyph),
          align: nn(block.align),
          pageBreakBefore: nn(block.pageBreakBefore),
          indent: nn(block.indent),
        },
        content: inlinesToPm(block.inlines),
      };
    case "blank":
      return { type: N.blank, attrs: { ...id, role: nn(block.role) } };
    case "pageBreak":
      return { type: N.pageBreak, attrs: { ...id } };
    case "image":
      return {
        type: N.image,
        attrs: { ...id, asset: block.asset, widthMm: nn(block.widthMm), heightMm: nn(block.heightMm), align: nn(block.align) },
      };
    case "table":
      return {
        type: N.table,
        attrs: {
          ...id,
          role: block.role,
          caption: nn(block.caption),
          widthsPt: block.widthsPt === undefined ? null : [...block.widthsPt],
          headerRows: nn(block.headerRows),
          style: block.style === undefined ? null : clone(block.style),
        },
        content: block.rows.map(rowToPm),
      };
    case "chapterBand":
      return { type: N.chapterBand, attrs: { ...id, numeral: block.numeral }, content: stringToPm(block.title) };
    case "sectionChip":
      return { type: N.sectionChip, attrs: { ...id, label: block.label }, content: stringToPm(block.title) };
    case "summaryBox":
      return {
        type: N.summaryBox,
        attrs: { ...id, glyph: nn(block.glyph) },
        content: block.lines.map((line) => ({ type: N.summaryLine, content: inlinesToPm(line) })),
      };
    case "approvalBlock":
      return { type: N.approvalBlock, attrs: { ...id } };
    case "coverTitle":
      return { type: N.coverTitle, attrs: { ...id, sizePt: nn(block.sizePt) }, content: inlinesToPm(block.inlines) };
    case "sectionBar":
      return { type: N.sectionBar, attrs: { ...id, number: block.number, variant: nn(block.variant) }, content: stringToPm(block.title) };
    case "infoBox":
      return {
        type: N.infoBox,
        attrs: { ...id },
        content: block.groups.map((g) => ({
          type: N.infoGroup,
          content: [
            { type: N.infoHeading, content: stringToPm(g.heading) },
            ...g.items.map((item) => ({ type: N.infoItem, content: inlinesToPm(item) })),
          ],
        })),
      };
    case "overviewTable":
      return {
        type: N.overviewTable,
        attrs: { ...id },
        content: block.rows.map((r) =>
          r === "spacer"
            ? { type: N.overviewSpacer }
            : {
                type: N.overviewRow,
                attrs: { bullet: nn(r.bullet) },
                content: [
                  { type: N.overviewLabel, content: stringToPm(r.label) },
                  { type: N.overviewValue, content: inlinesToPm(r.value) },
                ],
              },
        ),
      };
    case "procedureFlow":
      return {
        type: N.procedureFlow,
        attrs: { ...id },
        content: block.stages.map((s) => ({
          type: N.flowStage,
          content: [
            { type: N.flowName, content: stringToPm(s.name) },
            { type: N.flowWhen, content: stringToPm(s.when) },
          ],
        })),
      };
    case "noticeHeader":
      return { type: N.noticeHeader, attrs: { ...id } };
    case "pressHeader":
      return { type: N.pressHeader, attrs: { ...id } };
    case "attachmentList":
      return {
        type: N.attachmentList,
        attrs: { ...id },
        content: block.items.map((item) => ({ type: N.attachmentItem, content: stringToPm(item) })),
      };
  }
}

export function toPm(doc: DocModel): PmDoc {
  return {
    type: "doc",
    attrs: { version: doc.version, family: doc.family, meta: clone(doc.meta) },
    content: doc.blocks.map(blockToPm),
  };
}
