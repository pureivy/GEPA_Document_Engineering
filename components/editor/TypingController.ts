/**
 * TypingController — turns the parser's DocEvent stream into a paced "the agent is typing"
 * animation on top of an editor sink.
 *
 *  - `meta`         → sink.setMeta
 *  - `block.open`   → the block (with whatever text the parser already had) is inserted at
 *                     the document end with a blinking caret
 *  - `text.delta`   → characters are appended at 6–12 ms/char in requestAnimationFrame
 *                     batches (one sink update per frame); when the backlog exceeds 400
 *                     chars it drains in 40-char chunks so the display never lags far behind
 *  - `block.upsert` → replace / append (tables grow row by row)
 *  - `block.commit` → final block replaces the provisional one, caret cleared, scrolled into view
 *  - `doc.final`    → whole document replaced
 *  - `flush()`      → 애니메이션 건너뛰기: drain everything synchronously
 *
 * The controller keeps its own copy of the open block (raw DSL text is appended to the last
 * text inline) so the sink only ever receives whole blocks — inline rendering stays in toPm.
 */
import type { Block, DocModel, Family, Inline } from "@/lib/docmodel/schema";
import type { DocEvent } from "@/lib/contracts";

export interface TypingSink {
  setMeta(family: Family, meta: DocModel["meta"]): void;
  /** insert or replace the node for `block`; `typing` shows the caret on it */
  upsertBlock(block: Block, typing: boolean): void;
  /** final version of a block: replace, clear the caret, scroll into view */
  commitBlock(block: Block): void;
  setDoc(doc: DocModel): void;
  /** the run started: forget provisional state (caret) */
  reset(): void;
}

export interface TypingScheduler {
  now(): number;
  /** schedule `cb` for the next frame; returns a cancel handle */
  schedule(cb: () => void): () => void;
}

const defaultScheduler = (): TypingScheduler => ({
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  schedule: (cb) => {
    if (typeof requestAnimationFrame === "function") {
      const h = requestAnimationFrame(() => cb());
      return () => cancelAnimationFrame(h);
    }
    const h = setTimeout(cb, 16);
    return () => clearTimeout(h);
  },
});

type QueueItem = { kind: "text"; blockId: string; text: string } | { kind: "event"; ev: Exclude<DocEvent, { type: "text.delta" }> };

export interface TypingControllerOptions {
  sink: TypingSink;
  scheduler?: TypingScheduler;
  /** ms per character at small backlog (default 12) → fastest pace (default 6) */
  slowMsPerChar?: number;
  fastMsPerChar?: number;
  /** backlog beyond which we drain `chunkSize` chars per frame (default 400 / 40) */
  chunkThreshold?: number;
  chunkSize?: number;
  onStateChange?: (s: TypingState) => void;
}

export interface TypingState {
  /** characters still to be typed */
  backlog: number;
  /** id of the block currently receiving characters */
  typingBlockId: string | null;
  animating: boolean;
  /** the agent is writing the file again; the new version is applied at once when it completes */
  rewriting: boolean;
}

export class TypingController {
  private readonly sink: TypingSink;
  private readonly scheduler: TypingScheduler;
  private readonly slow: number;
  private readonly fast: number;
  private readonly chunkThreshold: number;
  private readonly chunkSize: number;
  private readonly onStateChange?: (s: TypingState) => void;

  private queue: QueueItem[] = [];
  private backlog = 0;
  private cancel: (() => void) | null = null;
  private lastTick = 0;
  private carry = 0;
  /** provisional copies of open blocks, by id */
  private open = new Map<string, Block>();
  private typingBlockId: string | null = null;

  constructor(opts: TypingControllerOptions) {
    this.sink = opts.sink;
    this.scheduler = opts.scheduler ?? defaultScheduler();
    this.slow = opts.slowMsPerChar ?? 12;
    this.fast = opts.fastMsPerChar ?? 6;
    this.chunkThreshold = opts.chunkThreshold ?? 400;
    this.chunkSize = opts.chunkSize ?? 40;
    this.onStateChange = opts.onStateChange;
  }

  get state(): TypingState {
    return { backlog: this.backlog, typingBlockId: this.typingBlockId, animating: this.cancel !== null, rewriting: this.rewriteBuffer !== null };
  }

  /** called when a run (re)starts */
  reset(): void {
    this.stopLoop();
    this.queue = [];
    this.rewriteBuffer = null;
    this.backlog = 0;
    this.open.clear();
    this.typingBlockId = null;
    this.carry = 0;
    this.sink.reset();
    this.emit();
  }

  /** events of a rewrite (doc.open seq ≥ 2) are held here and applied at once on doc.close */
  private rewriteBuffer: DocEvent[] | null = null;
  get rewriting(): boolean {
    return this.rewriteBuffer !== null;
  }

  push(ev: DocEvent): void {
    if (ev.type === "doc.open" && ev.rewrite) {
      // the agent writes the file again: keep what is on screen, collect the new version
      this.stopLoop();
      this.flushQueueSilently();
      this.rewriteBuffer = [];
      this.emit();
      return;
    }
    if (this.rewriteBuffer) {
      if (ev.type === "doc.close") {
        const events = this.rewriteBuffer;
        this.rewriteBuffer = null;
        this.open.clear();
        this.typingBlockId = null;
        this.sink.reset();
        for (const e of events) {
          if (e.type === "text.delta") this.appendText(e.blockId, e.text);
          else this.applyEvent(e);
        }
        for (const b of this.open.values()) this.sink.upsertBlock(b, false);
        this.emit();
        return;
      }
      if (ev.type === "doc.final") {
        this.rewriteBuffer = null;
        this.applyEvent(ev);
        this.emit();
        return;
      }
      this.rewriteBuffer.push(ev);
      return;
    }
    if (ev.type === "text.delta") {
      if (!ev.text) return;
      this.queue.push({ kind: "text", blockId: ev.blockId, text: ev.text });
      this.backlog += ev.text.length;
    } else {
      this.queue.push({ kind: "event", ev });
    }
    this.ensureLoop();
    this.emit();
  }

  /** apply everything queued without touching the loop state (used before buffering a rewrite) */
  private flushQueueSilently(): void {
    while (this.queue.length) this.step(Number.POSITIVE_INFINITY);
  }

  /** 애니메이션 건너뛰기 — apply everything queued right now */
  flush(): void {
    this.stopLoop();
    while (this.queue.length) this.step(Number.POSITIVE_INFINITY);
    this.emit();
  }

  /**
   * Stop the animation loop and drop queued events. Not terminal: a later push restarts the
   * loop (React StrictMode / Fast Refresh run effect cleanups on a still-mounted component).
   */
  dispose(): void {
    this.stopLoop();
    this.queue = [];
    this.backlog = 0;
    this.open.clear();
    this.typingBlockId = null;
  }

  // ---- internals

  private emit(): void {
    this.onStateChange?.(this.state);
  }

  private ensureLoop(): void {
    if (this.cancel) return;
    this.lastTick = this.scheduler.now();
    this.carry = 0;
    const tick = () => {
      this.cancel = null;
      const now = this.scheduler.now();
      const elapsed = Math.max(0, now - this.lastTick);
      this.lastTick = now;
      let budget: number;
      if (this.backlog > this.chunkThreshold) {
        budget = this.chunkSize;
        this.carry = 0;
      } else {
        const msPerChar = this.backlog > 200 ? this.fast : this.backlog > 50 ? (this.slow + this.fast) / 2 : this.slow;
        const chars = (elapsed + this.carry) / msPerChar;
        budget = Math.floor(chars);
        this.carry = (chars - budget) * msPerChar;
      }
      this.step(budget);
      this.emit();
      if (this.queue.length) this.cancel = this.scheduler.schedule(tick);
    };
    this.cancel = this.scheduler.schedule(tick);
  }

  private stopLoop(): void {
    if (this.cancel) this.cancel();
    this.cancel = null;
  }

  /**
   * Process queue items: non-text items immediately (in order); text items up to `budget`
   * characters in total. One sink update per (blockId) touched.
   */
  private step(budget: number): void {
    const touched = new Map<string, Block>();
    let remaining = budget;
    while (this.queue.length) {
      const head = this.queue[0];
      if (head.kind === "event") {
        // flush pending text updates before structural events so order is preserved
        for (const b of touched.values()) this.sink.upsertBlock(b, b.id === this.typingBlockId);
        touched.clear();
        this.queue.shift();
        this.applyEvent(head.ev);
        continue;
      }
      if (remaining <= 0) break;
      const take = Math.min(remaining, head.text.length);
      const chunk = head.text.slice(0, take);
      head.text = head.text.slice(take);
      remaining -= take;
      this.backlog -= take;
      const block = this.appendText(head.blockId, chunk);
      if (block) touched.set(block.id, block);
      if (head.text.length === 0) this.queue.shift();
    }
    for (const b of touched.values()) this.sink.upsertBlock(b, b.id === this.typingBlockId);
  }

  private applyEvent(ev: Exclude<DocEvent, { type: "text.delta" }>): void {
    switch (ev.type) {
      case "doc.open":
        // a new document stream starts: drop whatever the editor was showing (previous version)
        this.open.clear();
        this.typingBlockId = null;
        this.sink.reset();
        break;
      case "meta":
        this.sink.setMeta(ev.family, ev.meta);
        break;
      case "block.open": {
        const block = clone(ev.block);
        this.open.set(block.id, block);
        this.typingBlockId = block.id;
        this.sink.upsertBlock(block, true);
        break;
      }
      case "block.upsert": {
        const block = clone(ev.block);
        this.open.set(block.id, block);
        this.sink.upsertBlock(block, false);
        break;
      }
      case "block.commit": {
        const block = clone(ev.block);
        this.open.delete(block.id);
        if (this.typingBlockId === block.id) this.typingBlockId = null;
        this.sink.commitBlock(block);
        break;
      }
      case "doc.close":
        // end of a stream: nothing to do for the first write (the run end sends doc.final)
        break;
      case "doc.final": {
        this.open.clear();
        this.typingBlockId = null;
        this.sink.setDoc(ev.doc);
        break;
      }
    }
  }

  /** append raw text to the provisional block's inlines; returns the updated block */
  private appendText(blockId: string, text: string): Block | null {
    let block = this.open.get(blockId);
    if (!block) {
      // delta for a block we never saw opened (e.g. reconnect): create a plain paragraph
      block = { id: blockId, k: "para", role: "plain", inlines: [] };
      this.open.set(blockId, block);
    }
    if (this.typingBlockId !== blockId) this.typingBlockId = blockId;
    if (!("inlines" in block)) return block;
    const inlines = block.inlines as Inline[];
    appendRaw(inlines, text);
    return block;
  }
}

/** append raw DSL text; a "\n" (continuation line) becomes a br inline */
export function appendRaw(inlines: Inline[], text: string): void {
  let rest = text;
  while (rest.length) {
    const nl = rest.indexOf("\n");
    const piece = nl < 0 ? rest : rest.slice(0, nl);
    if (piece) {
      const last = inlines[inlines.length - 1];
      if (last && last.t === "text" && !last.bold && !last.color && last.size === undefined && last.font === undefined) last.text += piece;
      else inlines.push({ t: "text", text: piece });
    }
    if (nl < 0) break;
    inlines.push({ t: "br" });
    rest = rest.slice(nl + 1);
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
