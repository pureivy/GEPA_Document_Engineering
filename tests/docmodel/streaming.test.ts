import { describe, expect, it } from "vitest";
import { applyEvents, createStreamingParser, parseDsl, type DslEvent } from "../../lib/docmodel/dsl";
import { fixture, randomChunks } from "./helpers";

const FIXTURES = ["notice", "plan", "press"] as const;

function stream(text: string, chunks: string[]): { events: DslEvent[]; doc: ReturnType<typeof parseDsl>["doc"]; warnings: ReturnType<typeof parseDsl>["warnings"] } {
  const p = createStreamingParser();
  const events: DslEvent[] = [];
  for (const c of chunks) events.push(...p.push(c));
  events.push(...p.end());
  void text;
  return { events, doc: p.doc(), warnings: p.warnings() };
}

describe("streaming parser", () => {
  it("yields the same DocModel as one-shot parsing for random 1–40 char chunks", () => {
    for (const name of FIXTURES) {
      const text = fixture(name);
      const expected = parseDsl(text);
      for (let seed = 1; seed <= 12; seed++) {
        const chunks = randomChunks(text, seed * 7919 + name.length);
        const got = stream(text, chunks);
        expect(got.doc, `${name} seed ${seed}`).toEqual(expected.doc);
        expect(got.warnings).toEqual(expected.warnings);
      }
    }
  });

  it("yields the same DocModel for one-char chunks and for CRLF split across chunks", () => {
    const text = fixture("plan");
    const expected = parseDsl(text);
    const one = stream(text, [...text]);
    expect(one.doc).toEqual(expected.doc);
    const crlf = text.replace(/\n/g, "\r\n");
    const parts: string[] = [];
    for (let i = 0; i < crlf.length; i += 13) parts.push(crlf.slice(i, i + 13));
    expect(stream(crlf, parts).doc).toEqual(expected.doc);
  });

  it("replaying the events reproduces the final block list", () => {
    for (const name of FIXTURES) {
      const text = fixture(name);
      const expected = parseDsl(text);
      const { events } = stream(text, randomChunks(text, 42, 1, 25));
      const replay = applyEvents(events);
      expect(replay.family).toBe(expected.doc.family);
      expect(replay.meta).toEqual(expected.doc.meta);
      expect(replay.blocks).toEqual(expected.doc.blocks);
    }
  });

  it("emits meta first, then commits for synthesized blocks, and open/delta/commit for a streamed paragraph", () => {
    const text = "---\nfamily: press\n배포일: x\n담당부서: x\n담당자: x\n연락처: x\n제목: t\n---\nㅇ 안녕\n하세요\n";
    const p = createStreamingParser();
    const ev: DslEvent[] = [];
    ev.push(...p.push("---\nfamily: press\n배포일: x\n담당부서: x\n"));
    expect(ev).toEqual([]);
    ev.push(...p.push("담당자: x\n연락처: x\n제목: t\n---\n"));
    expect(ev.map((e) => e.type)).toEqual(["meta", "block.commit", "block.commit"]);
    const before = ev.length;
    ev.push(...p.push("ㅇ 안"));
    expect(ev.slice(before).map((e) => e.type)).toEqual(["block.open"]);
    const open = ev[before] as Extract<DslEvent, { type: "block.open" }>;
    expect(open.block).toMatchObject({ k: "para", id: "b003", role: "body2", glyph: "ㅇ", inlines: [{ t: "text", text: "안" }] });
    ev.push(...p.push("녕"));
    expect(ev.slice(before + 1)).toEqual([{ type: "text.delta", blockId: "b003", text: "녕" }]);
    ev.push(...p.push("\n하"));
    expect(ev.slice(before + 2).map((e) => e.type)).toEqual(["block.commit", "block.open"]);
    expect((ev[before + 2] as Extract<DslEvent, { type: "block.commit" }>).block).toMatchObject({ id: "b003", inlines: [{ t: "text", text: "안녕" }] });
    expect((ev[before + 3] as Extract<DslEvent, { type: "block.open" }>).block).toMatchObject({ id: "b004", role: "pressBody", inlines: [{ t: "text", text: "하" }] });
    ev.push(...p.push("세요\n"), ...p.end());
    expect(p.doc()).toEqual(parseDsl(text).doc);
  });

  it("streams tables as upserts per row and fences as open/upsert/commit", () => {
    const text = "---\nfamily: plan\n제목: t\n---\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n```flow\n모집 | 7월\n선정 | 8월\n```\n";
    const { events, doc } = stream(text, [text]);
    const tableEvents = events.filter((e) => e.type !== "meta" && "block" in e && e.block.k === "table");
    expect(tableEvents.map((e) => e.type)).toEqual(["block.open", "block.upsert", "block.upsert", "block.upsert", "block.commit"]);
    const flowEvents = events.filter((e) => e.type !== "meta" && "block" in e && e.block.k === "procedureFlow");
    expect(flowEvents.map((e) => e.type)).toEqual(["block.open", "block.upsert", "block.upsert", "block.commit"]);
    expect(doc).toEqual(parseDsl(text).doc);
  });

  it("does not open a provisional paragraph for ambiguous prefixes", () => {
    const p = createStreamingParser();
    p.push("---\nfamily: plan\n제목: t\n---\n");
    expect(p.push("{tab")).toEqual([]);
    expect(p.push("le role=budget}\n").map((e) => e.type)).toEqual([]);
    expect(p.push("| a |\n").map((e) => e.type)).toEqual(["block.open", "block.upsert"]);
    expect(p.push("(단위").map((e) => e.type)).toEqual([]); // could still become a (단위: …) caption → nothing yet
    expect(p.push(": 천원)\n").map((e) => e.type)).toEqual(["block.commit", "block.commit"]); // table closed + caption committed
    expect(p.push("{re").map((e) => e.type)).toEqual(["block.open"]); // `{re…` can only be a paragraph
    p.end();
    expect(p.doc().blocks.map((b) => b.k)).toEqual(["approvalBlock", "coverTitle", "table", "para", "para"]);
  });
});
