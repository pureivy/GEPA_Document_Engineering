/**
 * ProseMirror JSON shape used by the browser editor. `toPm` / `fromPm` are pure JSON
 * transforms over this shape (no DOM, no editor instance) so they run in node tests.
 *
 * Conventions
 *  - the `doc` node carries `{ version, family, meta }` as attrs
 *  - every block node carries `blockId` (the DocModel block id) — `null` on nodes the user
 *    created in the editor; `fromPm` assigns fresh ids for those
 *  - absent optional DocModel fields are stored as `null` (PM JSON cannot hold `undefined`);
 *    `fromPm` omits null keys so the DocModel round-trips key-for-key
 *  - covered table positions (span shadows) are real, empty `gepaCell` nodes with
 *    `covered: true` (hidden by CSS) so the grid stays 1:1 with the DocModel
 */
import type { Family } from "../schema";

export const N = {
  doc: "doc",
  text: "text",
  hardBreak: "hardBreak",
  paragraph: "gepaParagraph",
  blank: "blank",
  pageBreak: "pageBreak",
  image: "image",
  table: "gepaTable",
  row: "gepaRow",
  cell: "gepaCell",
  chapterBand: "chapterBand",
  sectionChip: "sectionChip",
  summaryBox: "summaryBox",
  summaryLine: "summaryLine",
  approvalBlock: "approvalBlock",
  coverTitle: "coverTitle",
  sectionBar: "sectionBar",
  infoBox: "infoBox",
  infoGroup: "infoGroup",
  infoHeading: "infoHeading",
  infoItem: "infoItem",
  overviewTable: "overviewTable",
  overviewRow: "overviewRow",
  overviewSpacer: "overviewSpacer",
  overviewLabel: "overviewLabel",
  overviewValue: "overviewValue",
  procedureFlow: "procedureFlow",
  flowStage: "flowStage",
  flowName: "flowName",
  flowWhen: "flowWhen",
  noticeHeader: "noticeHeader",
  pressHeader: "pressHeader",
  attachmentList: "attachmentList",
  attachmentItem: "attachmentItem",
  officialHeader: "officialHeader",
  officialFooter: "officialFooter",
} as const;

export const M = {
  bold: "bold",
  link: "link",
  style: "gepaStyle",
} as const;

/** Names of the block-level node types (children of `doc`), in DocModel order. */
export const BLOCK_NODE_NAMES: readonly string[] = [
  N.paragraph,
  N.blank,
  N.pageBreak,
  N.image,
  N.table,
  N.chapterBand,
  N.sectionChip,
  N.summaryBox,
  N.approvalBlock,
  N.coverTitle,
  N.sectionBar,
  N.infoBox,
  N.overviewTable,
  N.procedureFlow,
  N.noticeHeader,
  N.pressHeader,
  N.attachmentList,
  N.officialHeader,
  N.officialFooter,
];

export interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  marks?: PmMark[];
  text?: string;
}

export interface PmDocAttrs {
  version: 1;
  family: Family;
  meta: unknown;
}

export interface PmDoc extends PmNode {
  type: "doc";
  attrs: PmDocAttrs & Record<string, unknown>;
  content: PmNode[];
}
