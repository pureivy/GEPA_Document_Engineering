"use client";
/**
 * HwpEditor — TipTap editor whose nodes map 1:1 to DocModel blocks, styled to look like the
 * 한글 page. Exposes a TypingSink (agent typing) and a debounced, validated onChange (user edits).
 */
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { DocModelSchema, type DocModel, type Family } from "@/lib/docmodel/schema";
import { toPm } from "@/lib/docmodel/prosemirror/toPm";
import { fromPm, type FromPmResult } from "@/lib/docmodel/prosemirror/fromPm";
import { gepaExtensions } from "./nodes";
import { ApprovalBlockWithView, NoticeHeaderWithView, PressHeaderWithView } from "./views/MetaBlockViews";
import { createEditorSink, PROGRAMMATIC } from "./editorSink";
import type { TypingSink } from "./TypingController";
import { MetaContext } from "./MetaContext";
import { MetaSheet } from "./MetaSheet";
import "./hwp.css";

export interface HwpEditorHandle {
  sink: TypingSink;
  editor: Editor | null;
  /** current document (unvalidated) */
  getDoc(): FromPmResult | null;
  setDoc(doc: DocModel): void;
  /** run a pending debounced save now */
  flushPendingSave(): void;
  openMeta(): void;
}

export interface HwpEditorProps {
  family: Family;
  /** document to show; a new object identity replaces the editor content */
  doc: DocModel | null;
  readOnly: boolean;
  /** 80–150 (percent) */
  zoom: number;
  /** called (debounced 800 ms) with a zod-validated DocModel after user edits */
  onChange?: (doc: DocModel) => void;
  onInvalid?: (message: string) => void;
  /** user started editing (before the debounce fires) */
  onDirty?: () => void;
  debounceMs?: number;
  ref?: Ref<HwpEditorHandle>;
}

const emptyDoc = (family: Family) => ({ type: "doc", attrs: { version: 1, family, meta: {} }, content: [] });

export function HwpEditor({ family, doc, readOnly, zoom, onChange, onInvalid, onDirty, debounceMs = 800, ref }: HwpEditorProps) {
  const [meta, setMeta] = useState<DocModel["meta"] | null>(doc?.meta ?? null);
  const [metaOpen, setMetaOpen] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // latest callbacks for timers / editor events (updated after every render, never during it)
  const cb = useRef({ onChange, onInvalid, onDirty });
  useEffect(() => {
    cb.current = { onChange, onInvalid, onDirty };
  });

  const extensions = useMemo(
    () => gepaExtensions({ family, overrides: { approvalBlock: ApprovalBlockWithView, noticeHeader: NoticeHeaderWithView, pressHeader: PressHeaderWithView } }),
    [family],
  );

  const runSave = useCallback(() => {
    saveTimer.current = null;
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    const res = fromPm(editor.getJSON());
    const parsed = DocModelSchema.safeParse(res.doc);
    if (!parsed.success) {
      cb.current.onInvalid?.(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    if (res.warnings.length) console.warn("[HwpEditor]", res.warnings);
    cb.current.onChange?.(parsed.data);
  }, []);

  const editor = useEditor(
    {
      extensions,
      content: doc ? toPm(doc) : emptyDoc(family),
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: { attributes: { class: "hwp-content", spellcheck: "false" } },
      onUpdate: ({ editor: ed, transaction }) => {
        const m = ed.state.doc.attrs.meta as DocModel["meta"];
        setMeta((prev) => (prev === m ? prev : m));
        // only a user edit that changed the document counts: programmatic loads (typing sink,
        // restore), selection-only transactions and editable toggles must not create versions
        if (transaction.getMeta(PROGRAMMATIC) || !ed.isEditable || !transaction.docChanged) return;
        cb.current.onDirty?.();
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(runSave, debounceMs);
      },
    },
    [extensions],
  );

  useEffect(() => {
    editorRef.current = editor;
    if (editor && editor.isEditable !== !readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // the sink drives the editor through editorRef, so it is created in an effect, not in render
  const sinkRef = useRef<TypingSink | null>(null);
  const getSink = useCallback((): TypingSink => {
    if (!sinkRef.current) sinkRef.current = createEditorSink(() => editorRef.current, { onMeta: (_f, m) => setMeta(m) });
    return sinkRef.current;
  }, []);

  // load a new document when the prop identity changes (initial fetch, restore, run end)
  const loadedRef = useRef<DocModel | null>(doc);
  useEffect(() => {
    if (!editor || doc === loadedRef.current) return;
    loadedRef.current = doc;
    if (doc) getSink().setDoc(doc);
    else getSink().reset();
  }, [doc, editor, getSink]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const applyMeta = useCallback((next: DocModel["meta"]) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    ed.view.dispatch(ed.state.tr.setDocAttribute("meta", next));
    setMeta(next);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      get sink() {
        return getSink();
      },
      get editor() {
        return editorRef.current;
      },
      getDoc: () => (editorRef.current ? fromPm(editorRef.current.getJSON()) : null),
      setDoc: (d) => getSink().setDoc(d),
      flushPendingSave: () => {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          runSave();
        }
      },
      openMeta: () => setMetaOpen(true),
    }),
    [getSink, runSave],
  );

  const ctx = useMemo(() => ({ family, meta, onEdit: readOnly ? undefined : () => setMetaOpen(true) }), [family, meta, readOnly]);

  return (
    <MetaContext.Provider value={ctx}>
      <div className={`hwp-canvas hwp-family-${family}${readOnly ? " hwp-editor-readonly" : ""}`} style={{ ["--hwp-zoom" as string]: String(zoom / 100) }}>
        <div className="hwp-page">
          {editor ? <EditorContent editor={editor} /> : <div className="p-8 text-sm text-slate-400">편집기 준비 중…</div>}
        </div>
      </div>
      {metaOpen ? <MetaSheet open family={family} meta={meta} onClose={() => setMetaOpen(false)} onSave={applyMeta} /> : null}
    </MetaContext.Provider>
  );
}
