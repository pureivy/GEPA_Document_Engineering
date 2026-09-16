import { Node } from "@tiptap/core";
import type { Family } from "@/lib/docmodel/schema";

/**
 * Top node. Carries the DocModel envelope (`version`, `family`, `meta`) as attrs so that
 * `fromPm(editor.getJSON())` is self-contained. `block*` (not `+`) so an empty document is
 * representable while a run has not produced anything yet.
 */
export const GepaDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "block*",
  addAttributes() {
    return {
      version: { default: 1, rendered: false },
      family: { default: "notice" as Family, rendered: false },
      meta: { default: {}, rendered: false },
    };
  },
});
