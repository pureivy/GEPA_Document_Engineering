import { Node } from "@tiptap/core";
import { N } from "@/lib/docmodel/prosemirror/schema";

const idAttr = { blockId: { default: null, rendered: false } };

/** `blank` — an empty line (role `blank` | `blankSmall`). */
export const Blank = Node.create({
  name: N.blank,
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { ...idAttr, role: { default: null, rendered: false } };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-blank]", getAttrs: (el) => ({ role: (el as HTMLElement).getAttribute("data-role") || null }) }];
  },
  renderHTML({ node }) {
    const small = node.attrs.role === "blankSmall";
    return ["div", { "data-gepa-blank": "", "data-role": node.attrs.role ?? "", class: `hwp-blank${small ? " hwp-blank-small" : ""}` }, ["span", { class: "hwp-blank-tag" }, small ? "빈 줄(작음)" : "빈 줄"]];
  },
});

/** `pageBreak` — rendered as a dashed divider (the editor does not paginate). */
export const PageBreak = Node.create({
  name: N.pageBreak,
  group: "block",
  atom: true,
  addAttributes() {
    return { ...idAttr };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-pagebreak]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-pagebreak": "", class: "hwp-pagebreak" }, ["span", { class: "hwp-pagebreak-label" }, "쪽 나눔"]];
  },
});

const ASSET_LABEL: Record<string, string> = { logo: "로고 (GEPA 경상북도경제진흥원)", chevron: "화살표" };

/** `image` — placeholder box labelled with the asset name, sized from widthMm/heightMm. */
export const GepaImage = Node.create({
  name: N.image,
  group: "block",
  atom: true,
  addAttributes() {
    return {
      ...idAttr,
      asset: { default: "logo", rendered: false },
      widthMm: { default: null, rendered: false },
      heightMm: { default: null, rendered: false },
      align: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-gepa-image]",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          const num = (v: string | null) => (v ? Number(v) : null);
          return { asset: e.getAttribute("data-asset") || "logo", widthMm: num(e.getAttribute("data-w")), heightMm: num(e.getAttribute("data-h")), align: e.getAttribute("data-align") || null };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const asset = String(node.attrs.asset ?? "logo");
    const w = node.attrs.widthMm as number | null;
    const h = node.attrs.heightMm as number | null;
    const style = `${w ? `width:${w}mm;` : "width:60mm;"}${h ? `height:${h}mm;` : "height:12mm;"}`;
    return [
      "div",
      { "data-gepa-image": "", "data-asset": asset, "data-w": w ?? "", "data-h": h ?? "", "data-align": node.attrs.align ?? "", class: `hwp-image hwp-image-${node.attrs.align ?? "left"}` },
      ["div", { class: "hwp-image-box", style }, ASSET_LABEL[asset] ?? `이미지: ${asset}`],
    ];
  },
});

/** `approvalBlock` — plan 결재란, rendered from `meta.결재` (React node view attached in HwpEditor). */
export const ApprovalBlock = Node.create({
  name: N.approvalBlock,
  group: "block",
  atom: true,
  addAttributes() {
    return { ...idAttr };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-approval]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-approval": "", class: "hwp-approval hwp-meta-block" }, "결재란"];
  },
});

/** `noticeHeader` — 공고문 cover lines rendered from meta (React node view). */
export const NoticeHeader = Node.create({
  name: N.noticeHeader,
  group: "block",
  atom: true,
  addAttributes() {
    return { ...idAttr };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-notice-header]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-notice-header": "", class: "hwp-notice-header hwp-meta-block" }, "공고 머리글"];
  },
});

/** `pressHeader` — 보도자료 머리표 rendered from meta (React node view). */
export const PressHeader = Node.create({
  name: N.pressHeader,
  group: "block",
  atom: true,
  addAttributes() {
    return { ...idAttr };
  },
  parseHTML() {
    return [{ tag: "div[data-gepa-press-header]" }];
  },
  renderHTML() {
    return ["div", { "data-gepa-press-header": "", class: "hwp-press-header hwp-meta-block" }, "보도자료 머리표"];
  },
});
