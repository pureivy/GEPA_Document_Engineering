import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Block, DocModel, Family } from "@/lib/docmodel/schema";
import { blockToPm, toPm } from "@/lib/docmodel/prosemirror/toPm";
import { caretKey } from "./nodes/caret";
import type { TypingSink } from "./TypingController";

/** transactions carrying this meta are agent-driven: not saved, not in undo history */
export const PROGRAMMATIC = "gepaProgrammatic";

function findBlock(doc: PmNode, blockId: string): { pos: number; node: PmNode } | null {
  let found: { pos: number; node: PmNode } | null = null;
  doc.forEach((node, offset) => {
    if (!found && node.attrs.blockId === blockId) found = { pos: offset, node };
  });
  return found;
}

/**
 * TypingSink over a TipTap editor: every operation is one transaction that replaces or
 * appends a whole block node built with `blockToPm`.
 */
export function createEditorSink(getEditor: () => Editor | null, hooks: { onMeta?: (family: Family, meta: DocModel["meta"]) => void } = {}): TypingSink {
  const upsert = (block: Block, typing: boolean, commit: boolean): { pos: number; appended: boolean } | null => {
    const editor = getEditor();
    if (!editor || editor.isDestroyed) return null;
    const { state, view } = editor;
    let node: PmNode;
    try {
      node = state.schema.nodeFromJSON(blockToPm(block));
    } catch (e) {
      console.warn("[HwpEditor] block could not be rendered", block.k, e);
      return null;
    }
    const tr = state.tr;
    const hit = findBlock(state.doc, block.id);
    let pos: number;
    let appended = false;
    if (hit) {
      pos = hit.pos;
      tr.replaceWith(pos, pos + hit.node.nodeSize, node);
    } else {
      pos = state.doc.content.size;
      tr.insert(pos, node);
      appended = true;
    }
    const current = caretKey.getState(state)?.blockId ?? null;
    if (typing) tr.setMeta(caretKey, { blockId: block.id });
    else if (commit || current === block.id) tr.setMeta(caretKey, { blockId: null });
    tr.setMeta(PROGRAMMATIC, true);
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
    return { pos, appended };
  };

  const scrollTo = (pos: number, block: ScrollLogicalPosition) => {
    const editor = getEditor();
    if (!editor || editor.isDestroyed) return;
    try {
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
      dom?.scrollIntoView?.({ block, behavior: "smooth", inline: "nearest" });
    } catch {
      /* ignore */
    }
  };

  return {
    setMeta(family, meta) {
      const editor = getEditor();
      if (editor && !editor.isDestroyed) {
        const tr = editor.state.tr.setDocAttribute("family", family).setDocAttribute("meta", meta).setMeta(PROGRAMMATIC, true).setMeta("addToHistory", false);
        editor.view.dispatch(tr);
      }
      hooks.onMeta?.(family, meta);
    },
    upsertBlock(block, typing) {
      const r = upsert(block, typing, false);
      // a newly opened block: bring it into view (block.open)
      if (r && typing && r.appended) scrollTo(r.pos, "center");
    },
    commitBlock(block) {
      const r = upsert(block, false, true);
      if (r) scrollTo(r.pos, "center");
    },
    setDoc(doc) {
      const editor = getEditor();
      if (!editor || editor.isDestroyed) return;
      editor.commands.setContent(toPm(doc), { emitUpdate: false });
      // setContent keeps only the children of the doc node: restore the envelope attrs
      const tr = editor.state.tr
        .setDocAttribute("version", doc.version)
        .setDocAttribute("family", doc.family)
        .setDocAttribute("meta", doc.meta)
        .setMeta(caretKey, { blockId: null })
        .setMeta(PROGRAMMATIC, true)
        .setMeta("addToHistory", false);
      editor.view.dispatch(tr);
      hooks.onMeta?.(doc.family, doc.meta);
    },
    reset() {
      const editor = getEditor();
      if (!editor || editor.isDestroyed) return;
      const { state, view } = editor;
      const tr = state.tr;
      if (state.doc.content.size > 0) tr.delete(0, state.doc.content.size);
      tr.setMeta(caretKey, { blockId: null }).setMeta(PROGRAMMATIC, true).setMeta("addToHistory", false);
      view.dispatch(tr);
    },
  };
}
