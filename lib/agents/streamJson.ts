/**
 * Pure NDJSON (`claude -p --output-format stream-json --verbose --include-partial-messages`)
 * line → AgentEvent[] mapper. No I/O; safe to use from tests and the replay runner.
 */
import type { AgentEvent } from "./runner";

type Json = Record<string, unknown>;

interface ToolUseInfo {
  name: string;
  parentToolUseId?: string;
  isSubagent: boolean;
  /** `tool.start` already emitted for this id. */
  started: boolean;
  /** `subagent.start` already emitted for this id. */
  subagentStarted: boolean;
}

const SUBAGENT_TOOL_NAMES = new Set(["Task", "Agent"]);
const NOT_LOGGED_IN_RE = /not logged in|please run \/login|please log in|run `?claude login`?|invalid api key|authentication_error|401 unauthorized/i;

export const LOGIN_HINT = "Claude Code CLI is not logged in. Run `claude login` in a terminal and retry.";

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function optId(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Normalize tool_result content (string | [{type:'text',text}] | other) to a plain string. */
export function toolResultContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          const o = c as Json;
          if (o.type === "text" && typeof o.text === "string") return o.text;
          if (o.type === "image") return "[image]";
          return JSON.stringify(o);
        }
        return str(c);
      })
      .join("\n");
  }
  if (content == null) return "";
  if (typeof content === "object") return JSON.stringify(content);
  return str(content);
}

export function isNotLoggedInText(text: string): boolean {
  return NOT_LOGGED_IN_RE.test(text);
}

export class StreamJsonParser {
  private toolUses = new Map<string, ToolUseInfo>();
  /** `${parentToolUseId ?? ""}:${index}` → tool_use id for streaming content blocks. */
  private blockTool = new Map<string, string>();
  private resultSeen = false;

  get hasResult(): boolean {
    return this.resultSeen;
  }

  /** Parse one NDJSON line. Unknown / irrelevant lines yield no events. */
  push(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let msg: Json;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object") return [];
      msg = parsed as Json;
    } catch {
      return [{ type: "stderr", text: `[unparsed stdout] ${trimmed}` }];
    }
    return this.handle(msg);
  }

  handle(msg: Json): AgentEvent[] {
    switch (msg.type) {
      case "system":
        return this.handleSystem(msg);
      case "stream_event":
        return this.handleStreamEvent(msg);
      case "assistant":
        return this.handleAssistant(msg);
      case "user":
        return this.handleUser(msg);
      case "result":
        return this.handleResult(msg);
      default:
        // rate_limit_event, tool_progress, etc.
        return [];
    }
  }

  private handleSystem(msg: Json): AgentEvent[] {
    if (msg.subtype !== "init") return [];
    const tools = Array.isArray(msg.tools) ? msg.tools.map(str) : [];
    const agents = Array.isArray(msg.agents) ? msg.agents.map(str) : undefined;
    return [
      {
        type: "init",
        sessionId: str(msg.session_id),
        model: str(msg.model),
        tools,
        ...(agents ? { agents } : {}),
      },
    ];
  }

  private handleStreamEvent(msg: Json): AgentEvent[] {
    const event = msg.event as Json | undefined;
    if (!event || typeof event !== "object") return [];
    const parentToolUseId = optId(msg.parent_tool_use_id);
    const index = typeof event.index === "number" ? event.index : -1;
    const blockKey = `${parentToolUseId ?? ""}:${index}`;

    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block as Json | undefined;
        if (!block) return [];
        if (block.type === "tool_use") {
          const id = str(block.id);
          const name = str(block.name);
          this.blockTool.set(blockKey, id);
          const info = this.toolUses.get(id) ?? {
            name,
            parentToolUseId,
            isSubagent: SUBAGENT_TOOL_NAMES.has(name),
            started: false,
            subagentStarted: false,
          };
          this.toolUses.set(id, info);
          if (info.started) return [];
          info.started = true;
          return [{ type: "tool.start", toolUseId: id, name, input: null, ...(parentToolUseId ? { parentToolUseId } : {}) }];
        }
        this.blockTool.delete(blockKey);
        return [];
      }
      case "content_block_delta": {
        const delta = event.delta as Json | undefined;
        if (!delta) return [];
        if (delta.type === "text_delta") {
          const text = str(delta.text);
          if (!text) return [];
          return [{ type: "text.delta", text, ...(parentToolUseId ? { parentToolUseId } : {}) }];
        }
        if (delta.type === "input_json_delta") {
          const toolUseId = this.blockTool.get(blockKey);
          const json = str(delta.partial_json);
          if (!toolUseId || !json) return [];
          return [{ type: "tool.input.delta", toolUseId, json, ...(parentToolUseId ? { parentToolUseId } : {}) }];
        }
        if (delta.type === "thinking_delta") {
          const text = str(delta.thinking);
          if (!text) return [];
          return [{ type: "thinking", text, ...(parentToolUseId ? { parentToolUseId } : {}) }];
        }
        return [];
      }
      case "content_block_stop": {
        this.blockTool.delete(blockKey);
        return [];
      }
      default:
        // message_start / message_delta / message_stop
        return [];
    }
  }

  private handleAssistant(msg: Json): AgentEvent[] {
    const message = msg.message as Json | undefined;
    const content = message && Array.isArray(message.content) ? (message.content as unknown[]) : [];
    const parentToolUseId = optId(msg.parent_tool_use_id);
    const out: AgentEvent[] = [];
    for (const raw of content) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as Json;
      if (block.type === "text") {
        const text = str(block.text);
        if (!text) continue;
        out.push({ type: "assistant.text", text, ...(parentToolUseId ? { parentToolUseId } : {}) });
      } else if (block.type === "tool_use") {
        const id = str(block.id);
        const name = str(block.name);
        const input = block.input;
        const info = this.toolUses.get(id) ?? {
          name,
          parentToolUseId,
          isSubagent: SUBAGENT_TOOL_NAMES.has(name),
          started: false,
          subagentStarted: false,
        };
        this.toolUses.set(id, info);
        if (!info.started) {
          info.started = true;
          out.push({ type: "tool.start", toolUseId: id, name, input, ...(parentToolUseId ? { parentToolUseId } : {}) });
        }
        out.push({ type: "tool.input", toolUseId: id, name, input, ...(parentToolUseId ? { parentToolUseId } : {}) });
        const inputObj = input && typeof input === "object" ? (input as Json) : undefined;
        const subagentType = inputObj ? optId(inputObj.subagent_type) : undefined;
        if (SUBAGENT_TOOL_NAMES.has(name) && subagentType && !info.subagentStarted) {
          info.isSubagent = true;
          info.subagentStarted = true;
          const description = str(inputObj?.description ?? inputObj?.prompt ?? "");
          out.push({
            type: "subagent.start",
            toolUseId: id,
            agent: subagentType,
            description,
            ...(parentToolUseId ? { parentToolUseId } : {}),
          });
        }
      }
    }
    return out;
  }

  private handleUser(msg: Json): AgentEvent[] {
    const message = msg.message as Json | undefined;
    const content = message && Array.isArray(message.content) ? (message.content as unknown[]) : [];
    const parentToolUseId = optId(msg.parent_tool_use_id);
    const out: AgentEvent[] = [];
    for (const raw of content) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as Json;
      if (block.type !== "tool_result") continue;
      const toolUseId = str(block.tool_use_id);
      const info = this.toolUses.get(toolUseId);
      const isError = block.is_error === true;
      out.push({
        type: "tool.result",
        toolUseId,
        ...(info ? { name: info.name } : {}),
        content: toolResultContentToString(block.content),
        isError,
        ...(parentToolUseId ? { parentToolUseId } : {}),
      });
      if (info?.subagentStarted) {
        out.push({ type: "subagent.end", toolUseId, isError });
      }
    }
    return out;
  }

  private handleResult(msg: Json): AgentEvent[] {
    this.resultSeen = true;
    const subtype = str(msg.subtype) || "unknown";
    const isError = msg.is_error === true || subtype !== "success";
    const text = typeof msg.result === "string" ? msg.result : "";
    const errorsArr = Array.isArray(msg.errors) ? msg.errors.map(str).filter(Boolean) : [];
    const out: AgentEvent[] = [];
    let error: string | undefined;
    if (isError) {
      error = text || errorsArr.join("; ") || subtype;
    }
    if (isNotLoggedInText(text) || errorsArr.some(isNotLoggedInText)) {
      out.push({ type: "error", message: text || errorsArr.join("; ") || "Not logged in", hint: LOGIN_HINT });
    }
    const costRaw = msg.total_cost_usd;
    const costUsd = typeof costRaw === "number" ? costRaw : Number(costRaw ?? 0) || 0;
    out.push({
      type: "result",
      ok: !isError,
      costUsd,
      turns: typeof msg.num_turns === "number" ? msg.num_turns : Number(msg.num_turns ?? 0) || 0,
      durationMs: typeof msg.duration_ms === "number" ? msg.duration_ms : Number(msg.duration_ms ?? 0) || 0,
      usage: msg.usage ?? null,
      ...(msg.structured_output !== undefined ? { structured: msg.structured_output } : {}),
      ...(error ? { error } : {}),
      subtype,
      ...(optId(msg.session_id) ? { sessionId: str(msg.session_id) } : {}),
      ...(text ? { text } : {}),
    });
    return out;
  }
}

/** Convenience: map a whole array of NDJSON lines. */
export function parseStreamJsonLines(lines: Iterable<string>): AgentEvent[] {
  const parser = new StreamJsonParser();
  const out: AgentEvent[] = [];
  for (const line of lines) out.push(...parser.push(line));
  return out;
}
