import { Node, type Attribute } from "@tiptap/core";
import type { Family, Glyph, ParaRole } from "@/lib/docmodel/schema";
import { leadingSpaces } from "@/lib/docmodel/indent";
import { N } from "@/lib/docmodel/prosemirror/schema";

export interface GepaParagraphOptions {
  family: Family;
}

/** the non-editable "ladder" prefix rendered before the text: leading spaces + glyph */
export function paragraphPrefix(family: Family, role: ParaRole, glyph: Glyph | null | undefined, indent: number | null | undefined): string {
  const g = glyph && glyph !== "none" ? glyph : undefined;
  const spaces = typeof indent === "number" ? indent : leadingSpaces(family, g, role);
  return " ".repeat(Math.max(0, spaces)) + (g ? g + " " : "");
}

const hidden = (extra: Partial<Attribute> = {}): Partial<Attribute> => ({ default: null, rendered: false, ...extra });

/**
 * `gepaParagraph` — one DocModel `para` block. Attrs mirror the block minus `inlines`.
 * Rendered as `<p class="hwp-p hwp-role-<role>"><span class="hwp-prefix">  ㅇ </span><span class="hwp-text">…</span></p>`.
 */
export const GepaParagraph = Node.create<GepaParagraphOptions>({
  name: N.paragraph,
  group: "block",
  content: "inline*",
  defining: false,

  addOptions() {
    return { family: "notice" };
  },

  addAttributes() {
    return {
      blockId: hidden({ keepOnSplit: false }),
      role: { default: "plain", rendered: false },
      glyph: hidden(),
      align: hidden(),
      pageBreakBefore: hidden({ keepOnSplit: false }),
      indent: hidden(),
    };
  },

  parseHTML() {
    return [
      {
        tag: "p[data-gepa-para]",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          const num = (v: string | null) => (v === null || v === "" ? null : Number(v));
          return {
            blockId: e.getAttribute("data-block-id") || null,
            role: e.getAttribute("data-role") || "plain",
            glyph: e.getAttribute("data-glyph") || null,
            align: e.getAttribute("data-align") || null,
            pageBreakBefore: e.getAttribute("data-pbb") === "1" ? true : null,
            indent: num(e.getAttribute("data-indent")),
          };
        },
      },
      { tag: "p", priority: 40, getAttrs: () => ({ role: "plain" }) },
    ];
  },

  renderHTML({ node }) {
    const role = node.attrs.role as ParaRole;
    const glyph = node.attrs.glyph as Glyph | null;
    const prefix = paragraphPrefix(this.options.family, role, glyph, node.attrs.indent as number | null);
    const attrs: Record<string, string> = {
      "data-gepa-para": "",
      "data-role": role,
      class: `hwp-p hwp-role-${role}${glyph ? ` hwp-glyph-${glyphClass(glyph)}` : ""}${node.attrs.pageBreakBefore ? " hwp-pbb" : ""}`,
    };
    if (node.attrs.blockId) attrs["data-block-id"] = String(node.attrs.blockId);
    if (glyph) attrs["data-glyph"] = glyph;
    if (node.attrs.align) {
      attrs["data-align"] = String(node.attrs.align);
      attrs.style = `text-align:${cssAlign(String(node.attrs.align))}`;
    }
    if (node.attrs.pageBreakBefore) attrs["data-pbb"] = "1";
    if (typeof node.attrs.indent === "number") attrs["data-indent"] = String(node.attrs.indent);
    if (!prefix) return ["p", attrs, ["span", { class: "hwp-text" }, 0]];
    return ["p", attrs, ["span", { class: "hwp-prefix", contenteditable: "false" }, prefix], ["span", { class: "hwp-text" }, 0]];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitBlock(),
    };
  },
});

export function cssAlign(align: string): string {
  switch (align) {
    case "both":
      return "justify";
    case "distribute":
      return "justify";
    default:
      return align;
  }
}

/** glyph → safe class suffix */
export function glyphClass(g: string): string {
  switch (g) {
    case "□":
      return "box";
    case "■":
      return "boxf";
    case "ㅇ":
      return "ieung";
    case "○":
      return "circle";
    case "◦":
      return "circle-s";
    case "❍":
      return "circle-d";
    case "-":
      return "dash";
    case "·":
      return "dot";
    case "∙":
      return "dot-b";
    case "▪":
      return "sq";
    case "※":
      return "note";
    case "*":
      return "star";
    case "❖":
      return "diamond";
    case "◇":
      return "diamond-o";
    case "✔":
      return "check";
    case "❶":
    case "❷":
    case "❸":
    case "❹":
      return "num";
    default:
      return "none";
  }
}
