/** stream-json fixture lines (shapes verified against claude 2.1.271 output). */
export const SID = "11111111-2222-4333-8444-555555555555";

const j = (o: unknown) => JSON.stringify(o);

export const initLine = j({
  type: "system",
  subtype: "init",
  cwd: "/repo/agent",
  session_id: SID,
  tools: ["Task", "Read", "Write", "WebSearch"],
  agents: ["researcher", "plan-writer"],
  model: "claude-opus-5",
  permissionMode: "bypassPermissions",
  uuid: "u-init",
});

export const hookLine = j({ type: "system", subtype: "hook_started", hook_name: "SessionStart:startup", session_id: SID });
export const rateLimitLine = j({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } });
export const statusLine = j({ type: "system", subtype: "status", status: "requesting", session_id: SID });

export const messageStartLine = j({
  type: "stream_event",
  event: { type: "message_start", message: { id: "msg_1", role: "assistant", content: [] } },
  session_id: SID,
  parent_tool_use_id: null,
});

export const thinkingStart = j({
  type: "stream_event",
  event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  session_id: SID,
  parent_tool_use_id: null,
});
export const thinkingDelta = j({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "", estimated_tokens: 50 } },
  session_id: SID,
  parent_tool_use_id: null,
});
export const thinkingDeltaText = j({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } },
  session_id: SID,
  parent_tool_use_id: null,
});

export const textStart = j({
  type: "stream_event",
  event: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  session_id: SID,
  parent_tool_use_id: null,
});
export const textDelta = (text: string, parent: string | null = null) =>
  j({
    type: "stream_event",
    event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text } },
    session_id: SID,
    parent_tool_use_id: parent,
  });
export const textStop = j({ type: "stream_event", event: { type: "content_block_stop", index: 1 }, session_id: SID, parent_tool_use_id: null });

export const TASK_ID = "toolu_task_01";
export const taskStart = j({
  type: "stream_event",
  event: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: TASK_ID, name: "Task", input: {} } },
  session_id: SID,
  parent_tool_use_id: null,
});
export const taskInputDelta = (partial: string) =>
  j({
    type: "stream_event",
    event: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: partial } },
    session_id: SID,
    parent_tool_use_id: null,
  });
export const taskStop = j({ type: "stream_event", event: { type: "content_block_stop", index: 2 }, session_id: SID, parent_tool_use_id: null });

export const assistantWithTask = j({
  type: "assistant",
  message: {
    model: "claude-opus-5",
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [
      { type: "text", text: "조사를 시작합니다." },
      {
        type: "tool_use",
        id: TASK_ID,
        name: "Task",
        input: { subagent_type: "researcher", description: "경북 수출 통계 조사", prompt: "..." },
      },
    ],
  },
  parent_tool_use_id: null,
  session_id: SID,
});

// --- inside the subagent (parent_tool_use_id = TASK_ID)
export const SUB_TOOL_ID = "toolu_sub_ws_01";
export const subAssistantWebSearch = j({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id: SUB_TOOL_ID, name: "WebSearch", input: { query: "경북 수출액 2025" } }],
  },
  parent_tool_use_id: TASK_ID,
  session_id: SID,
});
export const subUserWebSearchResult = j({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: SUB_TOOL_ID, content: [{ type: "text", text: "3 results" }], is_error: false }],
  },
  parent_tool_use_id: TASK_ID,
  session_id: SID,
});
export const subTextDelta = textDelta("서브에이전트 텍스트", TASK_ID);

export const userTaskResult = j({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: TASK_ID, content: "조사 완료: 경북 수출액 400억 달러", is_error: false }],
  },
  parent_tool_use_id: null,
  session_id: SID,
});

export const READ_ID = "toolu_read_01";
export const assistantRead = j({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id: READ_ID, name: "Read", input: { file_path: "/x/notes.md" } }] },
  parent_tool_use_id: null,
  session_id: SID,
});
export const userReadError = j({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: READ_ID, content: "File not found", is_error: true }] },
  parent_tool_use_id: null,
  session_id: SID,
});

export const finalAssistantText = j({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text: "<<<DOC\n---\nfamily: notice\n---\n# 제목\nDOC>>>" }] },
  parent_tool_use_id: null,
  session_id: SID,
});

export const resultSuccess = j({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 12345,
  duration_api_ms: 12000,
  num_turns: 4,
  result: "<<<DOC\n---\nfamily: notice\n---\n# 제목\nDOC>>>",
  stop_reason: "end_turn",
  session_id: SID,
  total_cost_usd: 0.42,
  usage: { input_tokens: 10, output_tokens: 20 },
  uuid: "u-result",
});

export const resultMaxTurns = j({
  type: "result",
  subtype: "error_max_turns",
  is_error: true,
  duration_ms: 999,
  num_turns: 2,
  session_id: SID,
  total_cost_usd: 0.1,
  usage: {},
});

export const resultNotLoggedIn = j({
  type: "result",
  subtype: "error_during_execution",
  is_error: true,
  duration_ms: 10,
  num_turns: 0,
  result: "Not logged in · Please run /login",
  session_id: SID,
  total_cost_usd: 0,
  usage: {},
});

/** Full happy-path run. */
export const basicRunLines: string[] = [
  hookLine,
  rateLimitLine,
  initLine,
  statusLine,
  messageStartLine,
  thinkingStart,
  thinkingDelta,
  thinkingDeltaText,
  textStart,
  textDelta("조사를 "),
  textDelta("시작합니다."),
  textStop,
  taskStart,
  taskInputDelta('{"subagent_type":'),
  taskInputDelta('"researcher"}'),
  taskStop,
  assistantWithTask,
  subAssistantWebSearch,
  subTextDelta,
  subUserWebSearchResult,
  userTaskResult,
  assistantRead,
  userReadError,
  textDelta("<<<DOC\n---\nfamily: notice\n"),
  textDelta("---\n# 제목\nDOC>>>"),
  finalAssistantText,
  resultSuccess,
];
