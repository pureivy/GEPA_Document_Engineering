import { describe, expect, it } from "vitest";
import { TypingController, appendRaw, type TypingScheduler, type TypingSink } from "@/components/editor/TypingController";
import type { Block, DocModel, Inline } from "@/lib/docmodel/schema";

type Call = ["meta", unknown] | ["upsert", Block, boolean] | ["commit", Block] | ["doc", DocModel] | ["reset"];

function makeSink() {
  const calls: Call[] = [];
  const sink: TypingSink = {
    setMeta: (family, meta) => void calls.push(["meta", { family, meta }]),
    upsertBlock: (block, typing) => void calls.push(["upsert", JSON.parse(JSON.stringify(block)), typing]),
    commitBlock: (block) => void calls.push(["commit", JSON.parse(JSON.stringify(block))]),
    setDoc: (doc) => void calls.push(["doc", doc]),
    reset: () => void calls.push(["reset"]),
  };
  return { sink, calls };
}

function makeScheduler() {
  let t = 0;
  let pending: (() => void) | null = null;
  const scheduler: TypingScheduler = {
    now: () => t,
    schedule: (cb) => {
      pending = cb;
      return () => {
        if (pending === cb) pending = null;
      };
    },
  };
  /** advance the clock and run one frame */
  const frame = (ms: number) => {
    t += ms;
    const cb = pending;
    pending = null;
    cb?.();
  };
  return { scheduler, frame, hasPending: () => pending !== null };
}

const para = (id: string, text = ""): Block => ({ id, k: "para", role: "body1", glyph: "□", inlines: text ? [{ t: "text", text }] : [] });
const textOf = (b: Block) => ("inlines" in b ? (b.inlines as Inline[]).map((i) => (i.t === "br" ? "\n" : i.text)).join("") : "");

describe("TypingController", () => {
  it("opens a block with its initial text, paces characters, then commits the final block", () => {
    const { sink, calls } = makeSink();
    const { scheduler, frame } = makeScheduler();
    const tc = new TypingController({ sink, scheduler });

    tc.push({ type: "block.open", block: para("b001", "안동") });
    tc.push({ type: "text.delta", blockId: "b001", text: "시 수출기업" });
    // open is applied on the first frame; 24 ms at 12 ms/char → 2 chars
    frame(24);
    expect(calls[0]).toEqual(["upsert", para("b001", "안동"), true]);
    expect(calls[1][0]).toBe("upsert");
    expect(textOf(calls[1][1] as Block)).toBe("안동시 ");
    expect(tc.state.backlog).toBe(4);

    frame(48); // 4 more chars
    expect(textOf(calls[2][1] as Block)).toBe("안동시 수출기업");
    expect(tc.state.backlog).toBe(0);
    expect(tc.state.typingBlockId).toBe("b001");

    const final: Block = { id: "b001", k: "para", role: "body1", glyph: "□", inlines: [{ t: "text", text: "안동시 수출기업", bold: true }] };
    tc.push({ type: "block.commit", block: final });
    frame(1);
    expect(calls[calls.length - 1]).toEqual(["commit", final]);
    expect(tc.state.typingBlockId).toBeNull();
  });

  it("keeps event order: a commit waits until the preceding text has been typed", () => {
    const { sink, calls } = makeSink();
    const { scheduler, frame } = makeScheduler();
    const tc = new TypingController({ sink, scheduler });
    tc.push({ type: "block.open", block: para("b001") });
    tc.push({ type: "text.delta", blockId: "b001", text: "1234567890" });
    tc.push({ type: "block.commit", block: para("b001", "1234567890") });
    frame(12 * 3);
    expect(calls.filter((c) => c[0] === "commit")).toHaveLength(0);
    frame(12 * 7);
    expect(calls[calls.length - 1][0]).toBe("commit");
  });

  it("drains 40-char chunks per frame when the backlog exceeds 400 chars", () => {
    const { sink, calls } = makeSink();
    const { scheduler, frame } = makeScheduler();
    const tc = new TypingController({ sink, scheduler });
    tc.push({ type: "block.open", block: para("b001") });
    tc.push({ type: "text.delta", blockId: "b001", text: "가".repeat(500) });
    frame(1);
    const last = calls[calls.length - 1][1] as Block;
    expect(textOf(last).length).toBe(40);
    expect(tc.state.backlog).toBe(460);
    frame(1);
    expect(tc.state.backlog).toBe(420);
  });

  it("flush() applies everything synchronously (애니메이션 건너뛰기)", () => {
    const { sink, calls } = makeSink();
    const { scheduler, hasPending } = makeScheduler();
    const tc = new TypingController({ sink, scheduler });
    tc.push({ type: "meta", family: "notice", meta: {} as DocModel["meta"] });
    tc.push({ type: "block.open", block: para("b001") });
    tc.push({ type: "text.delta", blockId: "b001", text: "긴 문장 ".repeat(100) });
    tc.push({ type: "block.commit", block: para("b001", "final") });
    tc.push({ type: "block.upsert", block: { id: "b002", k: "table", role: "generic", rows: [{ cells: [{ inlines: [] }] }] } });
    expect(hasPending()).toBe(true);
    tc.flush();
    expect(hasPending()).toBe(false);
    expect(tc.state.backlog).toBe(0);
    expect(calls.map((c) => c[0])).toEqual(["meta", "upsert", "upsert", "commit", "upsert"]);
    expect(calls[3]).toEqual(["commit", para("b001", "final")]);
  });

  it("doc.final replaces the document and reset() clears provisional state", () => {
    const { sink, calls } = makeSink();
    const { scheduler } = makeScheduler();
    const tc = new TypingController({ sink, scheduler });
    const doc = { version: 1, family: "press", meta: {}, blocks: [para("b001", "x")] } as unknown as DocModel;
    tc.push({ type: "doc.final", doc });
    tc.flush();
    expect(calls[calls.length - 1]).toEqual(["doc", doc]);
    tc.reset();
    expect(calls[calls.length - 1]).toEqual(["reset"]);
    expect(tc.state).toEqual({ backlog: 0, typingBlockId: null, animating: false, rewriting: false });
  });

  it("a delta for an unknown block creates a plain paragraph; continuation newlines become br", () => {
    const { sink, calls } = makeSink();
    const { scheduler } = makeScheduler();
    const tc = new TypingController({ sink, scheduler });
    tc.push({ type: "text.delta", blockId: "b009", text: "첫 줄\n둘째 줄" });
    tc.flush();
    const b = calls[0][1] as Block;
    expect(b.k).toBe("para");
    expect("inlines" in b && b.inlines).toEqual([{ t: "text", text: "첫 줄" }, { t: "br" }, { t: "text", text: "둘째 줄" }]);
  });

  it("appendRaw merges into an unstyled trailing text inline only", () => {
    const inlines: Inline[] = [{ t: "text", text: "a", bold: true }];
    appendRaw(inlines, "b");
    expect(inlines).toEqual([{ t: "text", text: "a", bold: true }, { t: "text", text: "b" }]);
    appendRaw(inlines, "c");
    expect(inlines[1]).toEqual({ t: "text", text: "bc" });
  });

  it("a rewrite (doc.open seq 2) keeps the screen until doc.close, then swaps the new version in at once", () => {
    const { sink, calls } = makeSink();
    const { scheduler, frame } = makeScheduler();
    const tc = new TypingController({ sink, scheduler });

    tc.push({ type: "doc.open", seq: 1 });
    tc.push({ type: "block.open", block: para("b001", "첫 번째 판") });
    tc.push({ type: "block.commit", block: para("b001", "첫 번째 판") });
    tc.push({ type: "block.open", block: para("b002", "둘째 문단") });
    frame(1000);
    const shown = calls.length;
    expect(tc.state.rewriting).toBe(false);

    // the agent writes the file again
    tc.push({ type: "doc.open", seq: 2, rewrite: true });
    expect(tc.state.rewriting).toBe(true);
    tc.push({ type: "block.open", block: para("b001", "두 번째 판") });
    tc.push({ type: "text.delta", blockId: "b001", text: " 수정" });
    tc.push({ type: "block.commit", block: para("b001", "두 번째 판 수정") });
    frame(500);
    // nothing new reached the sink while the rewrite is buffered (no reset either)
    expect(calls.length).toBe(shown);
    expect(calls.slice(shown).some((c) => c[0] === "reset")).toBe(false);

    tc.push({ type: "doc.close", seq: 2 });
    expect(tc.state.rewriting).toBe(false);
    const after = calls.slice(shown);
    expect(after[0]).toEqual(["reset"]);
    const committed = after.find((c) => c[0] === "commit");
    expect(committed && textOf(committed[1] as Block)).toBe("두 번째 판 수정");
    // the block that only existed in the first version is gone (reset + only b001 replayed)
    expect(after.some((c) => (c[0] === "upsert" || c[0] === "commit") && (c[1] as Block).id === "b002")).toBe(false);
  });

  it("doc.close after a first write is a no-op", () => {
    const { sink, calls } = makeSink();
    const { scheduler, frame } = makeScheduler();
    const tc = new TypingController({ sink, scheduler });
    tc.push({ type: "doc.open", seq: 1 });
    tc.push({ type: "block.open", block: para("b001", "x") });
    tc.push({ type: "doc.close", seq: 1 });
    frame(100);
    expect(calls.filter((c) => c[0] === "reset").length).toBe(1); // only the doc.open reset
  });
});
