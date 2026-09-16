/**
 * Agent runner abstraction.
 *
 * The only production implementation is `ClaudeCliRunner` (lib/agents/claudeCliRunner.ts),
 * which drives the locally installed Claude Code CLI as a subprocess using the user's
 * subscription login. No API keys are used anywhere in this project.
 */

export type Stage = "research" | "plan" | "notice" | "press" | "review";
export const STAGES: readonly Stage[] = ["research", "plan", "notice", "press", "review"] as const;

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export interface RunSpec {
  /** Server-side run id (uuid). */
  runId: string;
  /** Session id handed to the CLI via `--session-id` (uuid v4). Ignored when `resumeSessionId` is set. */
  sessionId: string;
  /** When set, the CLI is started with `--resume <id>` and the session keeps that id. */
  resumeSessionId?: string;
  /** Working directory of the CLI process (where `.claude/agents` and `.claude/skills` live). */
  cwd: string;
  /** Extra directories the agent may access (`--add-dir`). */
  addDirs: string[];
  /** Text appended to the default system prompt (`--append-system-prompt`). Empty string = none. */
  systemPromptAppend: string;
  /** The user prompt, written to the CLI's stdin. */
  prompt: string;
  /**
   * Tools the agent may use without prompting (`--allowedTools`). NOTE: under
   * `--permission-mode bypassPermissions` this does not restrict anything; use `tools` for that.
   */
  allowedTools: string[];
  /**
   * Optional hard restriction of the built-in tool set (`--tools`). Omit to keep the default set.
   * Excluding `Skill`/`Task` also disables skills / subagents, so include them when needed.
   */
  tools?: string[];
  /**
   * Pass `--strict-mcp-config` (no `--mcp-config`) so the run loads NO MCP servers from the
   * user's global/project settings (Gmail, Drive, browser tools …). Default: true. Skills and
   * `.claude/agents` still load. Set false to inherit the user's MCP servers.
   */
  strictMcpConfig?: boolean;
  /**
   * `--mcp-config <file>`: the only MCP server(s) the run may load (research public-data tools).
   * Combined with --strict-mcp-config so the user's global servers still stay out.
   */
  mcpConfigPath?: string;
  /**
   * `--setting-sources`: which settings scopes the child loads. Default "project" — the user's
   * global agents/plugins/hooks (oh-my-claudecode etc.) stay out of document runs; the agent/
   * workspace's own agents, skills and CLAUDE.md still load. (~/.claude/CLAUDE.md memory is
   * still read by the CLI regardless — verified 2026-09-16.)
   */
  settingSources?: string;
  /** Model alias or full name. Defaults to `opus`. */
  model?: string;
  /** `--max-turns`. */
  maxTurns: number;
  /** Kill the process after this many milliseconds regardless of activity. */
  wallTimeoutMs: number;
  /** Kill the process when no stdout line arrives for this many milliseconds. */
  idleTimeoutMs: number;
  /** Optional JSON schema for structured output (`--json-schema`). */
  jsonSchema?: object;
  /** Extra environment variables for the child (still filtered through the subscription-only guard). */
  env?: Record<string, string>;
}

export type AgentEvent =
  | { type: "init"; sessionId: string; model: string; tools: string[]; agents?: string[] }
  | { type: "text.delta"; text: string; parentToolUseId?: string }
  /** Complete text block from an `assistant` message (authoritative full text). */
  | { type: "assistant.text"; text: string; parentToolUseId?: string }
  /**
   * A tool call started. When emitted from a partial `content_block_start` the input is not yet
   * known (`input` is `null`); the authoritative input follows in `tool.input`.
   */
  | { type: "tool.start"; toolUseId: string; name: string; input: unknown; parentToolUseId?: string }
  /** Authoritative, complete tool input taken from the `assistant` message. */
  | { type: "tool.input"; toolUseId: string; name: string; input: unknown; parentToolUseId?: string }
  | { type: "tool.input.delta"; toolUseId: string; json: string; parentToolUseId?: string }
  | { type: "tool.result"; toolUseId: string; name?: string; content: string; isError: boolean; parentToolUseId?: string }
  /** `Task`/`Agent` tool_use with a `subagent_type` input. */
  | { type: "subagent.start"; toolUseId: string; agent: string; description: string; parentToolUseId?: string }
  | { type: "subagent.end"; toolUseId: string; isError: boolean }
  | { type: "thinking"; text: string; parentToolUseId?: string }
  | {
      type: "result";
      ok: boolean;
      costUsd: number;
      turns: number;
      durationMs: number;
      usage: unknown;
      structured?: unknown;
      error?: string;
      /** CLI result subtype (`success`, `error_max_turns`, ...) or a runner-synthesized reason. */
      subtype?: string;
      sessionId?: string;
      /** Final assistant text as reported by the CLI. */
      text?: string;
    }
  | { type: "stderr"; text: string }
  | { type: "error"; message: string; hint?: string };

export type AgentEventType = AgentEvent["type"];

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type RunFrameKind = "agent" | "doc" | "run";

/**
 * One persisted / broadcast frame of a run (mirrors `SseFrame` in lib/contracts.ts, plus `ts`).
 * `agent` frames carry AgentEvents; `doc` frames are published by the document extraction
 * pipeline; a single `run` frame with the final status closes the stream.
 */
export type RunFrame =
  | { seq: number; ts: string; kind: "agent"; data: AgentEvent }
  | { seq: number; ts: string; kind: "doc"; data: { type: string } & Record<string, unknown> }
  | { seq: number; ts: string; kind: "run"; data: { status: RunStatus; error?: string } };

export type AgentFrame = Extract<RunFrame, { kind: "agent" }>;

export interface AgentRunner {
  run(spec: RunSpec, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}
