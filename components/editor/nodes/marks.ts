import { Mark } from "@tiptap/core";
import { M } from "@/lib/docmodel/prosemirror/schema";

/**
 * `gepaStyle` — the DocModel text inline's `color` / `size` / `font` overrides in one mark
 * (`bold` and `link` come from StarterKit).
 */
export const GepaStyle = Mark.create({
  name: M.style,
  addAttributes() {
    return {
      color: { default: null, rendered: false },
      size: { default: null, rendered: false },
      font: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-gepa-style]",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          return { color: e.getAttribute("data-color") || null, size: e.getAttribute("data-size") ? Number(e.getAttribute("data-size")) : null, font: e.getAttribute("data-font") || null };
        },
      },
    ];
  },
  renderHTML({ mark }) {
    const attrs: Record<string, string> = { "data-gepa-style": "" };
    let style = "";
    if (mark.attrs.color) {
      attrs["data-color"] = String(mark.attrs.color);
      style += `color:${mark.attrs.color};`;
    }
    if (mark.attrs.size) {
      attrs["data-size"] = String(mark.attrs.size);
      style += `font-size:${mark.attrs.size}pt;`;
    }
    if (mark.attrs.font) {
      attrs["data-font"] = String(mark.attrs.font);
      style += `font-family:var(--font-${mark.attrs.font});`;
    }
    if (style) attrs.style = style;
    return ["span", attrs, 0];
  },
});
