import { Node } from "@tiptap/core";
import { N } from "@/lib/docmodel/prosemirror/schema";

/**
 * Family composite blocks. Titles/labels that the user may edit are node *content*
 * (`text*` or `inline*`), fixed data is attrs. Each maps 1:1 to a DocModel block, see
 * lib/docmodel/prosemirror/{toPm,fromPm}.ts.
 */

const hidden = { default: null, rendered: false } as const;
const idAttr = { blockId: hidden };

/** keymap for single-line text nodes: Enter does nothing (a title has no second paragraph) */
const noEnter = () => ({ Enter: () => true });

// ---- plan: 장 band (navy numeral cell + title)
export const ChapterBand = Node.create({
  name: N.chapterBand,
  group: "block",
  content: "text*",
  marks: "",
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...idAttr, numeral: { default: "", rendered: false } };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-chapter]", contentElement: ".hwp-chapter-title", getAttrs: (el) => ({ numeral: (el as HTMLElement).getAttribute("data-numeral") ?? "" }) }];
  },
  renderHTML({ node }) {
    return [
      "div",
      { "data-gepa-chapter": "", "data-numeral": node.attrs.numeral, class: "hwp-chapter" },
      ["span", { class: "hwp-chapter-num", contenteditable: "false" }, String(node.attrs.numeral ?? "")],
      ["span", { class: "hwp-chapter-gap", contenteditable: "false" }],
      ["span", { class: "hwp-chapter-title" }, 0],
    ];
  },
  addKeyboardShortcuts: noEnter,
});

// ---- plan: 절 chip (navy label cell + grey title cell)
export const SectionChip = Node.create({
  name: N.sectionChip,
  group: "block",
  content: "text*",
  marks: "",
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...idAttr, label: { default: "", rendered: false } };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-chip]", contentElement: ".hwp-chip-title", getAttrs: (el) => ({ label: (el as HTMLElement).getAttribute("data-label") ?? "" }) }];
  },
  renderHTML({ node }) {
    const label = String(node.attrs.label ?? "");
    return [
      "div",
      { "data-gepa-chip": "", "data-label": label, class: `hwp-chip${label ? "" : " hwp-chip-nolabel"}` },
      ["span", { class: "hwp-chip-label", contenteditable: "false" }, label],
      ["span", { class: "hwp-chip-title" }, 0],
    ];
  },
  addKeyboardShortcuts: noEnter,
});

// ---- plan: 목적 box (lines of inline content in a filled box)
export const SummaryLine = Node.create({
  name: N.summaryLine,
  content: "inline*",
  parseHTML() {
    return [{ tag: "p[data-gepa-summary-line]" }];
  },
  renderHTML() {
    return ["p", { "data-gepa-summary-line": "", class: "hwp-summary-line" }, 0];
  },
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitBlock() };
  },
});

export const SummaryBox = Node.create({
  name: N.summaryBox,
  group: "block",
  content: `${N.summaryLine}*`,
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...idAttr, glyph: hidden };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-summary]", getAttrs: (el) => ({ glyph: (el as HTMLElement).getAttribute("data-glyph") || null }) }];
  },
  renderHTML({ node }) {
    const glyph = (node.attrs.glyph as string | null) ?? "❖";
    return ["div", { "data-gepa-summary": "", "data-glyph": node.attrs.glyph ?? "", class: "hwp-summary", "data-marker": glyph === "none" ? "" : glyph }, 0];
  },
});

// ---- plan: cover title
export const CoverTitle = Node.create({
  name: N.coverTitle,
  group: "block",
  content: "inline*",
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...idAttr, sizePt: hidden };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-cover-title]", getAttrs: (el) => ({ sizePt: (el as HTMLElement).getAttribute("data-size") ? Number((el as HTMLElement).getAttribute("data-size")) : null }) }];
  },
  renderHTML({ node }) {
    const attrs: Record<string, string> = { "data-gepa-cover-title": "", class: "hwp-cover-title" };
    if (node.attrs.sizePt) {
      attrs.style = `font-size:${node.attrs.sizePt}pt`;
      attrs["data-size"] = String(node.attrs.sizePt);
    }
    return ["div", attrs, 0];
  },
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.setHardBreak() };
  },
});

// ---- notice: section title bar (title + gradient strip)
export const SectionBar = Node.create({
  name: N.sectionBar,
  group: "block",
  content: "text*",
  marks: "",
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...idAttr, number: { default: 0, rendered: false }, variant: hidden };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-gepa-section-bar]",
        contentElement: ".hwp-bar-title",
        getAttrs: (el) => ({ number: Number((el as HTMLElement).getAttribute("data-number") ?? 0), variant: (el as HTMLElement).getAttribute("data-variant") || null }),
      },
    ];
  },
  renderHTML({ node }) {
    const variant = (node.attrs.variant as string | null) ?? "tall";
    return [
      "div",
      { "data-gepa-section-bar": "", "data-number": String(node.attrs.number), "data-variant": node.attrs.variant ?? "", class: `hwp-bar hwp-bar-${variant}` },
      ["div", { class: "hwp-bar-row" }, ["span", { class: "hwp-bar-num", contenteditable: "false" }, `${node.attrs.number}. `], ["span", { class: "hwp-bar-title" }, 0]],
      ["div", { class: "hwp-bar-strip", contenteditable: "false" }],
    ];
  },
  addKeyboardShortcuts: noEnter,
});

// ---- notice: 안내박스 (groups of heading + items)
export const InfoHeading = Node.create({
  name: N.infoHeading,
  content: "text*",
  marks: "",
  parseHTML() {
    return [{ tag: "p[data-gepa-info-heading]" }];
  },
  renderHTML() {
    return ["p", { "data-gepa-info-heading": "", class: "hwp-info-heading" }, ["span", { class: "hwp-prefix", contenteditable: "false" }, "□ "], ["span", { class: "hwp-text" }, 0]];
  },
  addKeyboardShortcuts: noEnter,
});

export const InfoItem = Node.create({
  name: N.infoItem,
  content: "inline*",
  parseHTML() {
    return [{ tag: "p[data-gepa-info-item]" }];
  },
  renderHTML() {
    return ["p", { "data-gepa-info-item": "", class: "hwp-info-item" }, ["span", { class: "hwp-prefix", contenteditable: "false" }, " ○ "], ["span", { class: "hwp-text" }, 0]];
  },
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitBlock() };
  },
});

export const InfoGroup = Node.create({
  name: N.infoGroup,
  content: `${N.infoHeading} ${N.infoItem}*`,
  parseHTML() {
    return [{ tag: "div[data-gepa-info-group]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-info-group": "", class: "hwp-info-group" }, 0];
  },
});

export const InfoBox = Node.create({
  name: N.infoBox,
  group: "block",
  content: `${N.infoGroup}*`,
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...idAttr };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-info-box]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-info-box": "", class: "hwp-infobox" }, 0];
  },
});

// ---- notice: 모집개요 table (label / value rows, spacer rows)
export const OverviewLabel = Node.create({
  name: N.overviewLabel,
  content: "text*",
  marks: "",
  parseHTML() {
    return [{ tag: "div[data-gepa-ov-label]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-ov-label": "", class: "hwp-ov-label" }, 0];
  },
  addKeyboardShortcuts: noEnter,
});

export const OverviewValue = Node.create({
  name: N.overviewValue,
  content: "inline*",
  parseHTML() {
    return [{ tag: "div[data-gepa-ov-value]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-ov-value": "", class: "hwp-ov-value" }, 0];
  },
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.setHardBreak() };
  },
});

export const OverviewRow = Node.create({
  name: N.overviewRow,
  content: `${N.overviewLabel} ${N.overviewValue}`,
  isolating: true,
  addAttributes() {
    return { bullet: hidden };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-ov-row]", getAttrs: (el) => ({ bullet: (el as HTMLElement).getAttribute("data-bullet") === "0" ? false : null }) }];
  },
  renderHTML({ node }) {
    const bullet = node.attrs.bullet !== false;
    return [
      "div",
      { "data-gepa-ov-row": "", "data-bullet": node.attrs.bullet === false ? "0" : "", class: "hwp-ov-row" },
      ["span", { class: "hwp-ov-bullet", contenteditable: "false" }, bullet ? "○" : ""],
      ["div", { class: "hwp-ov-cells" }, 0],
    ];
  },
});

export const OverviewSpacer = Node.create({
  name: N.overviewSpacer,
  atom: true,
  selectable: false,
  parseHTML() {
    return [{ tag: "div[data-gepa-ov-spacer]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-ov-spacer": "", class: "hwp-ov-spacer" }];
  },
});

export const OverviewTable = Node.create({
  name: N.overviewTable,
  group: "block",
  content: `(${N.overviewRow} | ${N.overviewSpacer})*`,
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...idAttr };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-ov-table]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-ov-table": "", class: "hwp-overview" }, 0];
  },
});

// ---- notice: 절차도 (stage boxes with chevrons)
export const FlowName = Node.create({
  name: N.flowName,
  content: "text*",
  marks: "",
  parseHTML() {
    return [{ tag: "div[data-gepa-flow-name]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-flow-name": "", class: "hwp-flow-name" }, 0];
  },
  addKeyboardShortcuts: noEnter,
});

export const FlowWhen = Node.create({
  name: N.flowWhen,
  content: "text*",
  marks: "",
  parseHTML() {
    return [{ tag: "div[data-gepa-flow-when]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-flow-when": "", class: "hwp-flow-when" }, 0];
  },
  addKeyboardShortcuts: noEnter,
});

export const FlowStage = Node.create({
  name: N.flowStage,
  content: `${N.flowName} ${N.flowWhen}`,
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-gepa-flow-stage]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-flow-stage": "", class: "hwp-flow-stage" }, 0];
  },
});

export const ProcedureFlow = Node.create({
  name: N.procedureFlow,
  group: "block",
  content: `${N.flowStage}*`,
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...idAttr };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-flow]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-flow": "", class: "hwp-flow" }, 0];
  },
});

// ---- press: 붙임 list
export const AttachmentItem = Node.create({
  name: N.attachmentItem,
  content: "text*",
  marks: "",
  parseHTML() {
    return [{ tag: "p[data-gepa-attach-item]" }];
  },
  renderHTML() {
    return ["p", { "data-gepa-attach-item": "", class: "hwp-attach-item" }, 0];
  },
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitBlock() };
  },
});

export const AttachmentList = Node.create({
  name: N.attachmentList,
  group: "block",
  content: `${N.attachmentItem}*`,
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...idAttr };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-attach]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-attach": "", class: "hwp-attach" }, ["div", { class: "hwp-attach-label", contenteditable: "false" }, "붙임"], ["div", { class: "hwp-attach-items" }, 0]];
  },
});
