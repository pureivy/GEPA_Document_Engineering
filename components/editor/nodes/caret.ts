import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Blinking caret shown at the end of the block the agent is currently typing into.
 * Driven by the TypingController through `tr.setMeta(caretKey, { blockId })`.
 */
export const caretKey = new PluginKey<{ blockId: string | null }>("gepaTypingCaret");

export const TypingCaret = Extension.create({
  name: "typingCaret",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: caretKey,
        state: {
          init: (): { blockId: string | null } => ({ blockId: null }),
          apply(tr, prev) {
            const meta = tr.getMeta(caretKey) as { blockId: string | null } | undefined;
            return meta ? { blockId: meta.blockId } : prev;
          },
        },
        props: {
          decorations(state) {
            const { blockId } = caretKey.getState(state) ?? { blockId: null };
            if (!blockId) return null;
            let found: { pos: number; size: number } | null = null;
            state.doc.forEach((node, offset) => {
              if (!found && node.attrs.blockId === blockId) found = { pos: offset, size: node.nodeSize };
            });
            if (!found) return null;
            const { pos, size } = found as { pos: number; size: number };
            const node = state.doc.nodeAt(pos);
            // inside the node at the end of its text (textblocks); after the node otherwise
            const at = node && node.isTextblock ? pos + size - 1 : pos + size;
            const widget = Decoration.widget(
              at,
              () => {
                const el = document.createElement("span");
                el.className = "hwp-caret";
                el.setAttribute("contenteditable", "false");
                return el;
              },
              { side: 1, key: `caret-${blockId}` },
            );
            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },
});
