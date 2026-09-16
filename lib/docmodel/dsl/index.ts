/**
 * Public DSL API.
 *
 *   parseDsl(text)             one-shot: DSL text → { doc, warnings }
 *   createStreamingParser()    chunked: push(chunk) / end() → DslEvent[]
 *
 * Both are the same `LineParser`; `parseDsl` is literally `push(text)` + `end()`. Streaming
 * adds provisional `block.open` / `text.delta` events for the paragraph whose line is still
 * incomplete, so a UI can show text as it arrives. The final DocModel is identical either way.
 */
import type { Block, DocModel } from "../schema";
import { normalizeNewlines } from "./frontmatter";
import { LineParser, classifyPrefix, splitGlyph, type DslEvent, type DslWarning, type ParaBlock } from "./parser";
import { glyphRole } from "../indent";

export type { DslEvent, DslWarning } from "./parser";
export { LineParser, classifyPrefix, splitGlyph, splitPipeRow, splitLeadingNumeral, splitChipLabel, romanNumeral, parseKeyValues, formatId } from "./parser";
export { parseInlines, serializeInlines, normalizeInlines, inlinesToPlain, escapeInlineText } from "./inline";
export { parseFrontMatter, splitFrontMatter, validateFrontMatter, fallbackMeta } from "./frontmatter";
export { familyContext } from "./expanders";
export type { BlockInput, FamilyContext } from "./expanders";

export interface ParseResult {
  doc: DocModel;
  warnings: DslWarning[];
}

export interface StreamingParser {
  /** feed a chunk of DSL text; returns the events it produced */
  push(chunk: string): DslEvent[];
  /** flush the remaining partial line and close open blocks */
  end(): DslEvent[];
  /** the DocModel built so far (complete after end()) */
  doc(): DocModel;
  warnings(): DslWarning[];
}

export function createStreamingParser(): StreamingParser {
  const machine = new LineParser();
  let buf = "";
  let lineNo = 0;
  let ended = false;
  /** provisional paragraph opened for the current partial line */
  let openId: string | null = null;
  /** how many chars of the current partial line have been delivered as open/delta */
  let sent = 0;
  let pendingCR = false;

  const partialEvents = (): DslEvent[] => {
    const ev: DslEvent[] = [];
    if (!buf || machine.phase !== "body" || machine.inFence()) return ev;
    const contId = machine.openParaId();
    if (contId) {
      // continuation line of a paragraph that ended with `\`
      if (sent === 0) ev.push({ type: "text.delta", blockId: contId, text: "\n" });
      if (buf.length > sent) ev.push({ type: "text.delta", blockId: contId, text: buf.slice(sent) });
      sent = buf.length;
      return ev;
    }
    const cls = classifyPrefix(buf);
    if (cls !== "para") return ev;
    if (openId === null) {
      // a paragraph line always ends an open table; commit it first so event order is tidy
      ev.push(...machine.closeTable());
      openId = machine.peekNextId();
      const { glyph, rest } = splitGlyph(buf);
      const block: ParaBlock = glyph
        ? { k: "para", id: openId, role: glyphRole(glyph), glyph, inlines: rest ? [{ t: "text", text: rest }] : [] }
        : { k: "para", id: openId, role: machine.plainRole(), inlines: rest ? [{ t: "text", text: rest }] : [] };
      ev.push({ type: "block.open", block });
      sent = buf.length;
      return ev;
    }
    if (buf.length > sent) {
      ev.push({ type: "text.delta", blockId: openId, text: buf.slice(sent) });
      sent = buf.length;
    }
    return ev;
  };

  const feedComplete = (line: string): DslEvent[] => {
    lineNo += 1;
    const ev = machine.feedLine(line, lineNo);
    openId = null;
    sent = 0;
    return ev;
  };

  return {
    push(chunk: string): DslEvent[] {
      if (ended || !chunk) return [];
      const ev: DslEvent[] = [];
      let text = chunk;
      if (pendingCR) {
        text = "\r" + text;
        pendingCR = false;
      }
      // keep a trailing \r so that a split \r\n is handled on the next push
      if (text.endsWith("\r")) {
        pendingCR = true;
        text = text.slice(0, -1);
      }
      buf += normalizeNewlines(text);
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        ev.push(...feedComplete(line));
      }
      ev.push(...partialEvents());
      return ev;
    },
    end(): DslEvent[] {
      if (ended) return [];
      ended = true;
      const ev: DslEvent[] = [];
      if (pendingCR) {
        // a lone trailing \r is a line terminator
        pendingCR = false;
        const line = buf;
        buf = "";
        ev.push(...feedComplete(line));
      }
      if (buf.length > 0) {
        const line = buf;
        buf = "";
        ev.push(...feedComplete(line));
      }
      ev.push(...machine.finish());
      return ev;
    },
    doc: () => machine.doc(),
    warnings: () => machine.warnings,
  };
}

/** One-shot parse. Never throws; problems are reported in `warnings` (front-matter errors carry severity 'error'). */
export function parseDsl(text: string): ParseResult {
  const p = createStreamingParser();
  p.push(text);
  p.end();
  return { doc: p.doc(), warnings: p.warnings() };
}

/**
 * Rebuild the block list from a stream of events (what a UI does). Useful for tests and for
 * consumers that only keep the event log.
 */
export function applyEvents(events: DslEvent[]): { family?: DocModel["family"]; meta?: DocModel["meta"]; blocks: Block[] } {
  const order: string[] = [];
  const byId = new Map<string, Block>();
  let family: DocModel["family"] | undefined;
  let meta: DocModel["meta"] | undefined;
  for (const e of events) {
    switch (e.type) {
      case "meta":
        family = e.family;
        meta = e.meta;
        break;
      case "block.open":
      case "block.upsert":
      case "block.commit":
        if (!byId.has(e.block.id)) order.push(e.block.id);
        byId.set(e.block.id, e.block);
        break;
      case "text.delta": {
        const b = byId.get(e.blockId);
        if (b && b.k === "para") {
          const last = b.inlines[b.inlines.length - 1];
          if (last && last.t === "text") last.text += e.text;
          else b.inlines.push({ t: "text", text: e.text });
        }
        break;
      }
    }
  }
  const num = (id: string) => parseInt(id.replace(/^\D+/, ""), 10);
  order.sort((a, b) => num(a) - num(b));
  return { family, meta, blocks: order.map((id) => byId.get(id)!) };
}
