import { describe, expect, it } from "vitest";
import { ActivityStore, stripDocBlocks, toolSummary } from "@/lib/client/activityStore";

describe("stripDocBlocks", () => {
  it("hides <<<DOC … DOC>>> segments including an unterminated one", () => {
    expect(stripDocBlocks("설명 <<<DOC\n# 제목\nDOC>>> 마무리")).toEqual({ visible: "설명  마무리", inDoc: false });
    expect(stripDocBlocks("생각 중 <<<DOC\n□ 본문")).toEqual({ visible: "생각 중 ", inDoc: true });
    expect(stripDocBlocks("없음")).toEqual({ visible: "없음", inDoc: false });
  });
});

describe("ActivityStore", () => {
  it("groups tool calls under their parent and merges text deltas", () => {
    const store = new ActivityStore();
    store.push({ type: "init", sessionId: "s", model: "claude-opus-5", tools: ["WebSearch"] });
    store.push({ type: "text.delta", text: "먼저 " });
    store.push({ type: "text.delta", text: "조사합니다 <<<DOC\n" });
    store.push({ type: "tool.start", toolUseId: "t1", name: "Task", input: { description: "통계 조사" } });
    store.push({ type: "subagent.start", toolUseId: "t1", agent: "researcher", description: "통계 조사" });
    store.push({ type: "tool.start", toolUseId: "t2", name: "WebSearch", input: { query: "안동시 수출" }, parentToolUseId: "t1" });
    store.push({ type: "text.delta", text: "검색 결과 확인", parentToolUseId: "t1" });
    store.push({ type: "tool.result", toolUseId: "t2", content: "10 results", isError: false, parentToolUseId: "t1" });
    store.push({ type: "tool.result", toolUseId: "t1", content: "done", isError: false });
    store.push({ type: "subagent.end", toolUseId: "t1" });
    store.push({ type: "result", ok: true, turns: 3, durationMs: 1200 });
    store.flushSnapshot();
    const snap = store.getSnapshot();
    expect(snap.items.map((i) => i.kind)).toEqual(["init", "text", "tool", "result"]);
    const text = snap.items[1];
    expect(text.kind === "text" && stripDocBlocks(text.raw)).toEqual({ visible: "먼저 조사합니다 ", inDoc: true });
    const task = snap.items[2];
    expect(task.kind === "tool" && task.subagent?.agent).toBe("researcher");
    expect(task.kind === "tool" && task.children.map((c) => c.kind)).toEqual(["tool", "text"]);
    expect(task.kind === "tool" && task.done && task.subagent?.ended).toBe(true);
    expect(snap.toolCount).toBe(2);
  });

  it("assistant.text supersedes the streamed deltas of the same segment", () => {
    const store = new ActivityStore();
    store.push({ type: "text.delta", text: "부분" });
    store.push({ type: "assistant.text", text: "부분 전체 문장" });
    store.push({ type: "assistant.text", text: "두 번째 메시지" });
    store.flushSnapshot();
    const items = store.getSnapshot().items;
    expect(items).toHaveLength(2);
    expect(items[0].kind === "text" && items[0].raw).toBe("부분 전체 문장");
  });

  it("tool.input.delta accumulates partial JSON until it parses", () => {
    const store = new ActivityStore();
    store.push({ type: "tool.start", toolUseId: "t1", name: "WebFetch" });
    store.push({ type: "tool.input.delta", toolUseId: "t1", json: '{"url":"https://ex' });
    store.push({ type: "tool.input.delta", toolUseId: "t1", json: 'ample.com"}' });
    store.flushSnapshot();
    const t = store.getSnapshot().items[0];
    expect(t.kind === "tool" && toolSummary(t.name, t.input)).toEqual({ label: "웹 페이지", detail: "https://example.com" });
  });
});
