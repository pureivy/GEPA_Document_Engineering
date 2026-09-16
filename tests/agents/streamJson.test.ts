import { describe, expect, it } from "vitest";
import { parseStreamJsonLines, StreamJsonParser, toolResultContentToString } from "../../lib/agents/streamJson";
import type { AgentEvent } from "../../lib/agents/runner";
import * as F from "./fixtures";

function types(events: AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("StreamJsonParser", () => {
  it("maps a full run to the expected event sequence", () => {
    const events = parseStreamJsonLines(F.basicRunLines);
    expect(types(events)).toEqual([
      "init",
      "thinking",
      "text.delta",
      "text.delta",
      "tool.start",
      "tool.input.delta",
      "tool.input.delta",
      "assistant.text",
      "tool.input",
      "subagent.start",
      "tool.start",
      "tool.input",
      "text.delta",
      "tool.result",
      "tool.result",
      "subagent.end",
      "tool.start",
      "tool.input",
      "tool.result",
      "text.delta",
      "text.delta",
      "assistant.text",
      "result",
    ]);
  });

  it("emits init with session, model, tools and agents", () => {
    const [init] = parseStreamJsonLines([F.initLine]);
    expect(init).toEqual({
      type: "init",
      sessionId: F.SID,
      model: "claude-opus-5",
      tools: ["Task", "Read", "Write", "WebSearch"],
      agents: ["researcher", "plan-writer"],
    });
  });

  it("ignores hooks, rate limit, status, message_* and empty thinking deltas", () => {
    expect(parseStreamJsonLines([F.hookLine, F.rateLimitLine, F.statusLine, F.messageStartLine, F.thinkingStart, F.thinkingDelta])).toEqual([]);
    expect(parseStreamJsonLines([F.thinkingDeltaText])).toEqual([{ type: "thinking", text: "let me think" }]);
  });

  it("routes unparseable stdout lines to stderr events and skips blank lines", () => {
    expect(parseStreamJsonLines(["", "   ", "not json"])).toEqual([{ type: "stderr", text: "[unparsed stdout] not json" }]);
  });

  it("emits text.delta with parentToolUseId for subagent text", () => {
    const events = parseStreamJsonLines([F.textDelta("hi"), F.subTextDelta]);
    expect(events).toEqual([
      { type: "text.delta", text: "hi" },
      { type: "text.delta", text: "서브에이전트 텍스트", parentToolUseId: F.TASK_ID },
    ]);
  });

  it("tracks tool_use blocks: early tool.start, input deltas, then authoritative tool.input + subagent.start", () => {
    const p = new StreamJsonParser();
    expect(p.push(F.taskStart)).toEqual([{ type: "tool.start", toolUseId: F.TASK_ID, name: "Task", input: null }]);
    expect(p.push(F.taskInputDelta('{"a":'))).toEqual([{ type: "tool.input.delta", toolUseId: F.TASK_ID, json: '{"a":' }]);
    expect(p.push(F.taskStop)).toEqual([]);
    const fromAssistant = p.push(F.assistantWithTask);
    expect(fromAssistant).toEqual([
      { type: "assistant.text", text: "조사를 시작합니다." },
      {
        type: "tool.input",
        toolUseId: F.TASK_ID,
        name: "Task",
        input: { subagent_type: "researcher", description: "경북 수출 통계 조사", prompt: "..." },
      },
      { type: "subagent.start", toolUseId: F.TASK_ID, agent: "researcher", description: "경북 수출 통계 조사" },
    ]);
  });

  it("emits tool.start from the assistant message when no partial block was seen", () => {
    const p = new StreamJsonParser();
    expect(p.push(F.assistantRead)).toEqual([
      { type: "tool.start", toolUseId: F.READ_ID, name: "Read", input: { file_path: "/x/notes.md" } },
      { type: "tool.input", toolUseId: F.READ_ID, name: "Read", input: { file_path: "/x/notes.md" } },
    ]);
    expect(p.push(F.userReadError)).toEqual([
      { type: "tool.result", toolUseId: F.READ_ID, name: "Read", content: "File not found", isError: true },
    ]);
  });

  it("nests subagent activity under parentToolUseId and closes the subagent on its tool_result", () => {
    const p = new StreamJsonParser();
    p.push(F.assistantWithTask);
    expect(p.push(F.subAssistantWebSearch)).toEqual([
      { type: "tool.start", toolUseId: F.SUB_TOOL_ID, name: "WebSearch", input: { query: "경북 수출액 2025" }, parentToolUseId: F.TASK_ID },
      { type: "tool.input", toolUseId: F.SUB_TOOL_ID, name: "WebSearch", input: { query: "경북 수출액 2025" }, parentToolUseId: F.TASK_ID },
    ]);
    expect(p.push(F.subUserWebSearchResult)).toEqual([
      { type: "tool.result", toolUseId: F.SUB_TOOL_ID, name: "WebSearch", content: "3 results", isError: false, parentToolUseId: F.TASK_ID },
    ]);
    expect(p.push(F.userTaskResult)).toEqual([
      { type: "tool.result", toolUseId: F.TASK_ID, name: "Task", content: "조사 완료: 경북 수출액 400억 달러", isError: false },
      { type: "subagent.end", toolUseId: F.TASK_ID, isError: false },
    ]);
  });

  it("maps a successful result", () => {
    const [result] = parseStreamJsonLines([F.resultSuccess]);
    expect(result).toMatchObject({
      type: "result",
      ok: true,
      costUsd: 0.42,
      turns: 4,
      durationMs: 12345,
      usage: { input_tokens: 10, output_tokens: 20 },
      subtype: "success",
      sessionId: F.SID,
    });
    expect((result as { error?: string }).error).toBeUndefined();
  });

  it("maps error_max_turns to ok=false with the subtype as error", () => {
    const [result] = parseStreamJsonLines([F.resultMaxTurns]);
    expect(result).toMatchObject({ type: "result", ok: false, error: "error_max_turns", subtype: "error_max_turns", turns: 2 });
  });

  it("detects 'Not logged in' and emits an error with a login hint before the result", () => {
    const events = parseStreamJsonLines([F.resultNotLoggedIn]);
    expect(types(events)).toEqual(["error", "result"]);
    expect(events[0]).toMatchObject({ type: "error", hint: expect.stringContaining("claude login") });
    expect(events[1]).toMatchObject({ type: "result", ok: false });
  });

  it("normalizes tool_result content", () => {
    expect(toolResultContentToString("x")).toBe("x");
    expect(toolResultContentToString([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(toolResultContentToString([{ type: "image", source: {} }])).toBe("[image]");
    expect(toolResultContentToString(null)).toBe("");
    expect(toolResultContentToString({ k: 1 })).toBe('{"k":1}');
  });
});
