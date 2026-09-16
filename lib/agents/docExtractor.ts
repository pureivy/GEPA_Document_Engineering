/**
 * Detects a document emitted between `<<<DOC` and `DOC>>>` markers inside streamed assistant
 * text and exposes the inner text as it arrives. Pure string handling; no dependency on the
 * DSL parser (feed `onDocDelta` output into it elsewhere).
 *
 * Usage:
 *   const ex = new DocExtractor();
 *   ex.onDocDelta((t) => parser.feed(t));
 *   for each `text.delta` event: ex.feed(ev.text)
 *   for each `assistant.text` event: ex.setAuthoritativeText(ev.text)   // re-extract full content
 *   at the end: ex.finalDoc()
 */

export const DOC_OPEN = "<<<DOC";
export const DOC_CLOSE = "DOC>>>";

type State = "outside" | "inside" | "closed";

export interface DocExtractorOptions {
  open?: string;
  close?: string;
}

export class DocExtractor {
  private readonly open: string;
  private readonly close: string;
  private state: State = "outside";
  private pending = "";
  private doc = "";
  private skipLeadingNewline = false;
  private authoritative: string | null = null;
  private deltaListeners = new Set<(text: string) => void>();
  private openListeners = new Set<() => void>();
  private closeListeners = new Set<(doc: string) => void>();

  constructor(options: DocExtractorOptions = {}) {
    this.open = options.open ?? DOC_OPEN;
    this.close = options.close ?? DOC_CLOSE;
  }

  get isInside(): boolean {
    return this.state === "inside";
  }
  get isClosed(): boolean {
    return this.state === "closed";
  }
  get hasStarted(): boolean {
    return this.state !== "outside";
  }

  /** Text streamed so far between the markers (best-effort; may lag by a few chars). */
  get streamedDoc(): string {
    return this.doc;
  }

  onDocDelta(cb: (text: string) => void): () => void {
    this.deltaListeners.add(cb);
    return () => this.deltaListeners.delete(cb);
  }
  onDocOpen(cb: () => void): () => void {
    this.openListeners.add(cb);
    return () => this.openListeners.delete(cb);
  }
  onDocClose(cb: (doc: string) => void): () => void {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  reset(): void {
    this.state = "outside";
    this.pending = "";
    this.doc = "";
    this.skipLeadingNewline = false;
    this.authoritative = null;
  }

  /** Feed a streamed text chunk (`text.delta`). */
  feed(chunk: string): void {
    if (!chunk || this.state === "closed") return;
    this.pending += chunk;
    this.process(false);
  }

  private emitDelta(text: string): void {
    if (!text) return;
    this.doc += text;
    for (const cb of this.deltaListeners) cb(text);
  }

  private process(flush: boolean): void {
    // outside → look for the opening marker
    if (this.state === "outside") {
      const i = this.pending.indexOf(this.open);
      if (i < 0) {
        // keep only a possible partial marker tail
        const keep = flush ? 0 : this.open.length - 1;
        if (this.pending.length > keep) this.pending = this.pending.slice(this.pending.length - keep);
        return;
      }
      this.pending = this.pending.slice(i + this.open.length);
      this.state = "inside";
      this.skipLeadingNewline = true;
      for (const cb of this.openListeners) cb();
    }

    if (this.state !== "inside") return;

    if (this.skipLeadingNewline) {
      if (this.pending.length === 0) return; // wait to see whether a newline follows
      if (this.pending.startsWith("\r\n")) this.pending = this.pending.slice(2);
      else if (this.pending.startsWith("\n")) this.pending = this.pending.slice(1);
      else if (this.pending === "\r" && !flush) return; // could be the start of \r\n
      this.skipLeadingNewline = false;
    }

    const j = this.pending.indexOf(this.close);
    if (j >= 0) {
      let body = this.pending.slice(0, j);
      if (body.endsWith("\r\n")) body = body.slice(0, -2);
      else if (body.endsWith("\n")) body = body.slice(0, -1);
      this.emitDelta(body);
      this.pending = "";
      this.state = "closed";
      for (const cb of this.closeListeners) cb(this.doc);
      return;
    }

    if (flush) {
      this.emitDelta(this.pending);
      this.pending = "";
      return;
    }

    // hold back a tail that could be the start of the closing marker (and a preceding newline)
    const hold = this.close.length; // close.length - 1 for the marker + 1 for a newline before it
    if (this.pending.length > hold) {
      const emit = this.pending.slice(0, this.pending.length - hold);
      this.pending = this.pending.slice(this.pending.length - hold);
      this.emitDelta(emit);
    }
  }

  /**
   * Re-extract from the complete assistant text (authoritative). Returns the document text or
   * null if no opening marker is present. Takes the LAST block; an unterminated block runs to
   * the end of the text.
   */
  setAuthoritativeText(fullText: string): string | null {
    const doc = extractDocFromText(fullText, this.open, this.close);
    if (doc !== null) this.authoritative = doc;
    return doc;
  }

  /**
   * Final document: the authoritative text if one was set, otherwise whatever was streamed
   * (flushing any held-back tail if the closing marker never arrived). Null if no marker seen.
   */
  finalDoc(): string | null {
    if (this.authoritative !== null) return this.authoritative;
    if (this.state === "outside") return null;
    if (this.state === "inside") this.process(true);
    return this.doc;
  }
}

/** Stateless extraction from a full text. Last block wins; unterminated block runs to the end. */
export function extractDocFromText(fullText: string, open = DOC_OPEN, close = DOC_CLOSE): string | null {
  const start = fullText.lastIndexOf(open);
  if (start < 0) return null;
  let body = fullText.slice(start + open.length);
  const end = body.indexOf(close);
  if (end >= 0) body = body.slice(0, end);
  if (body.startsWith("\r\n")) body = body.slice(2);
  else if (body.startsWith("\n")) body = body.slice(1);
  if (end >= 0) {
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    else if (body.endsWith("\n")) body = body.slice(0, -1);
  }
  return body;
}
