/**
 * Synthetic `claude -p` stream-json fixtures for ReplayRunner: a writer session that
 * streams the document through `Write(<stage>/draft.dsl.md)` exactly as the real CLI does
 * (content_block_start → input_json_delta… → assistant tool_use → user tool_result), then
 * answers briefly. Used by the integration tests and the dev-only replay route behind the
 * Playwright e2e suite — no agent, no quota.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const line = (obj: unknown) => JSON.stringify(obj);

/** One streamed Write tool call, chunked pseudo-randomly (1–29 chars) so escapes get cut. */
export function writeCallLines(id: string, filePath: string, content: string, seed: number, sessionId = "replay"): string[] {
  const input = { file_path: filePath, content };
  const json = JSON.stringify(input);
  const out: string[] = [];
  out.push(line({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "Write", input: {} } }, session_id: sessionId, parent_tool_use_id: null }));
  let i = 0;
  while (i < json.length) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = 1 + (seed % 29);
    out.push(line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(i, i + n) } }, session_id: sessionId, parent_tool_use_id: null }));
    i += n;
  }
  out.push(line({ type: "stream_event", event: { type: "content_block_stop", index: 0 }, session_id: sessionId, parent_tool_use_id: null }));
  out.push(line({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Write", input }] }, session_id: sessionId, parent_tool_use_id: null }));
  out.push(line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "File written" }] }, session_id: sessionId, parent_tool_use_id: null }));
  return out;
}

/** A whole writer run: init → one Write per version → short answer → result. */
export function writerRunLines(filePath: string, versions: string[], sessionId = "replay"): string[] {
  const out: string[] = [line({ type: "system", subtype: "init", session_id: sessionId, model: "claude-opus-5", tools: ["Read", "Write"] })];
  versions.forEach((v, i) => out.push(...writeCallLines(`tu_w${i + 1}`, filePath, v, 11 + i, sessionId)));
  out.push(line({ type: "assistant", message: { content: [{ type: "text", text: "문서를 저장했습니다." }] }, session_id: sessionId, parent_tool_use_id: null }));
  out.push(line({ type: "result", subtype: "success", is_error: false, result: "문서를 저장했습니다.", num_turns: versions.length + 1, duration_ms: 900, total_cost_usd: 0, session_id: sessionId }));
  return out;
}

export type ReplayFixtureName = "notice-golden" | "notice-double";

export function goldenNoticeDsl(): string {
  return readFileSync(join(process.cwd(), "templates/notice/golden/6-1.dsl.md"), "utf8");
}

/** Named fixtures for the dev replay route / e2e. */
export function replayFixture(name: ReplayFixtureName, filePath: string): string[] {
  const dsl = goldenNoticeDsl();
  switch (name) {
    case "notice-golden":
      return writerRunLines(filePath, [dsl]);
    case "notice-double": {
      const v2 = dsl.replace("# 사업목적", "# 사업목적\n□ **(추가)** 두 번째 판에서 덧붙인 문단");
      return writerRunLines(filePath, [dsl, v2]);
    }
  }
}
