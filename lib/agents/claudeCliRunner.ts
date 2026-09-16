/**
 * The only production AgentRunner: spawns the locally installed Claude Code CLI
 * (`claude -p … --output-format stream-json`) and maps its NDJSON output to AgentEvents.
 *
 * Authentication is the user's subscription login (`claude login`, state in ~/.claude).
 * The child environment is scrubbed so a stray shell variable can never route a run through
 * API billing, and so the nested-session guard of the CLI does not trip when the web server
 * itself was started from inside a Claude Code session.
 */
import type { ChildProcess } from "node:child_process";
import { resolveClaudeBin as resolvePlatformClaudeBin, spawnCommand } from "../platform";
import readline from "node:readline";
import type { AgentEvent, AgentRunner, RunSpec } from "./runner";
import { DEFAULT_MODEL, KILL_GRACE_MS } from "./limits";
import { isNotLoggedInText, LOGIN_HINT, StreamJsonParser } from "./streamJson";

/** Exact environment keys removed from the child process. */
export const STRIPPED_ENV_KEYS: readonly string[] = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
];

/** Environment key prefixes removed from the child process. */
export const STRIPPED_ENV_PREFIXES: readonly string[] = ["CLAUDE_CODE_"];

export function isStrippedEnvKey(key: string): boolean {
  return STRIPPED_ENV_KEYS.includes(key) || STRIPPED_ENV_PREFIXES.some((p) => key.startsWith(p));
}

/** Build the child environment: inherit, strip guarded keys, force NO_COLOR, then apply extras (also filtered). */
export function buildChildEnv(
  base: Record<string, string | undefined> = process.env,
  extra?: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (isStrippedEnvKey(k)) continue;
    env[k] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (isStrippedEnvKey(k)) continue;
      env[k] = v;
    }
  }
  env.NO_COLOR = "1";
  return env as NodeJS.ProcessEnv;
}

/** Resolve the CLI binary: `CLAUDE_BIN` env → `~/.local/bin/claude` if it exists → `claude` on PATH. */
/** See lib/platform.ts — CLAUDE_BIN, ~/.local/bin/claude[.exe], %APPDATA%\npm\claude.cmd, PATH. */
export function resolveClaudeBin(env: Record<string, string | undefined> = process.env): string {
  return resolvePlatformClaudeBin(env);
}

/**
 * Build the CLI argument vector. The prompt is NOT part of argv (it goes to stdin), and the
 * variadic options (`--add-dir`, `--allowedTools`) come last so nothing can be swallowed by them.
 * `--bare` is never used (it disables OAuth/keychain auth). `--max-budget-usd` is never used.
 */
export function buildArgs(spec: RunSpec): string[] {
  const args = [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--permission-mode",
    "bypassPermissions",
    "--model",
    spec.model?.trim() || DEFAULT_MODEL,
    "--max-turns",
    String(Math.max(1, Math.floor(spec.maxTurns))),
  ];
  if (spec.resumeSessionId) {
    // `--session-id` together with `--resume` is rejected by the CLI unless `--fork-session` is
    // given; resuming keeps the original session id.
    args.push("--resume", spec.resumeSessionId);
  } else {
    args.push("--session-id", spec.sessionId);
  }
  if (spec.systemPromptAppend && spec.systemPromptAppend.trim()) {
    args.push("--append-system-prompt", spec.systemPromptAppend);
  }
  if (spec.jsonSchema) {
    args.push("--json-schema", JSON.stringify(spec.jsonSchema));
  }
  // project scope only: keeps the user's global agents/plugins/hooks out of the child (verified:
  // init.agents drops oh-my-claudecode:* / vercel:* while agent/.claude/agents still load)
  args.push("--setting-sources", spec.settingSources?.trim() || "project");
  if (spec.strictMcpConfig !== false) {
    // Verified: with no --mcp-config this yields `mcp_servers: []` while skills/agents still load.
    args.push("--strict-mcp-config");
  }
  if (spec.mcpConfigPath) {
    // Verified 2026-09-16: with --strict-mcp-config only this file's servers load, and their tools
    // (mcp__<server>__<tool>) are exposed even when `--tools` restricts the built-in set.
    args.push("--mcp-config", spec.mcpConfigPath);
  }
  if (spec.tools) {
    // `--tools ""` disables every built-in tool; a list restricts to those names.
    const tools = spec.tools.map((t) => t.trim()).filter(Boolean);
    args.push("--tools", tools.length ? tools.join(",") : "");
  }
  const addDirs = spec.addDirs.filter((d) => d && d.trim());
  if (addDirs.length) args.push("--add-dir", ...addDirs);
  const tools = spec.allowedTools.filter((t) => t && t.trim());
  if (tools.length) args.push("--allowedTools", ...tools);
  return args;
}

/** Effective session id of a run: the resumed one, or the freshly assigned one. */
export function effectiveSessionId(spec: Pick<RunSpec, "sessionId" | "resumeSessionId">): string {
  return spec.resumeSessionId ?? spec.sessionId;
}

/** Minimal async queue bridging event callbacks to an async iterator. */
class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as unknown as T, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export type KillReason = "abort" | "idle-timeout" | "wall-timeout" | "consumer-closed";

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    // Negative pid → whole process group (child was spawned detached = its own group).
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

export interface ClaudeCliRunnerOptions {
  /** Override binary resolution (tests). */
  bin?: string;
  /** Override SIGTERM→SIGKILL grace period. */
  killGraceMs?: number;
}

export class ClaudeCliRunner implements AgentRunner {
  constructor(private readonly options: ClaudeCliRunnerOptions = {}) {}

  async *run(spec: RunSpec, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const bin = this.options.bin ?? resolveClaudeBin();
    const killGraceMs = this.options.killGraceMs ?? KILL_GRACE_MS;
    const args = buildArgs(spec);
    const env = buildChildEnv(process.env, spec.env);
    const queue = new AsyncQueue<AgentEvent>();
    const parser = new StreamJsonParser();

    let resultEmitted = false;
    let exited = false;
    let killReason: KillReason | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    let wallTimer: NodeJS.Timeout | undefined;
    let stderrBuf = "";

    const emit = (ev: AgentEvent) => {
      if (ev.type === "result") {
        if (resultEmitted) return;
        resultEmitted = true;
      }
      queue.push(ev);
    };

    if (!spec.prompt || !spec.prompt.trim()) {
      emit({ type: "error", message: "Empty prompt: refusing to start the CLI." });
      emit({ type: "result", ok: false, costUsd: 0, turns: 0, durationMs: 0, usage: null, error: "empty prompt", subtype: "runner_error" });
      queue.close();
      for await (const ev of queue) yield ev;
      return;
    }

    if (signal?.aborted) {
      emit({ type: "result", ok: false, costUsd: 0, turns: 0, durationMs: 0, usage: null, error: "aborted before start", subtype: "cancelled" });
      queue.close();
      for await (const ev of queue) yield ev;
      return;
    }

    const startedAt = Date.now();
    let child: ChildProcess;
    try {
      child = spawnCommand(bin, args, {
        cwd: spec.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `Failed to spawn Claude Code CLI (${bin}): ${message}`, hint: "Install Claude Code or set CLAUDE_BIN to the binary path." });
      emit({ type: "result", ok: false, costUsd: 0, turns: 0, durationMs: 0, usage: null, error: message, subtype: "spawn_error" });
      queue.close();
      for await (const ev of queue) yield ev;
      return;
    }

    const kill = (reason: KillReason) => {
      if (exited || killReason) return;
      killReason = reason;
      killProcessGroup(child, "SIGTERM");
      killTimer = setTimeout(() => {
        if (!exited) killProcessGroup(child, "SIGKILL");
      }, killGraceMs);
      killTimer.unref();
    };

    const clearTimers = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (wallTimer) clearTimeout(wallTimer);
      if (killTimer) clearTimeout(killTimer);
      idleTimer = wallTimer = killTimer = undefined;
    };

    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (spec.idleTimeoutMs > 0 && !exited) {
        idleTimer = setTimeout(() => kill("idle-timeout"), spec.idleTimeoutMs);
      }
    };

    const onAbort = () => kill("abort");
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err: NodeJS.ErrnoException) => {
      const hint =
        err.code === "ENOENT"
          ? `Claude Code CLI not found at "${bin}". Install it or set CLAUDE_BIN.`
          : undefined;
      emit({ type: "error", message: `Claude Code CLI process error: ${err.message}`, ...(hint ? { hint } : {}) });
    });

    child.stdin?.on("error", () => {
      /* EPIPE if the CLI exits early; ignore */
    });
    child.stdin?.end(spec.prompt);

    const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on("line", (line) => {
      resetIdle();
      for (const ev of parser.push(line)) emit(ev);
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrBuf = (stderrBuf + chunk).slice(-8000);
      emit({ type: "stderr", text: chunk });
      if (isNotLoggedInText(chunk)) {
        emit({ type: "error", message: chunk.trim(), hint: LOGIN_HINT });
      }
    });

    if (spec.wallTimeoutMs > 0) {
      wallTimer = setTimeout(() => kill("wall-timeout"), spec.wallTimeoutMs);
    }
    resetIdle();

    const closed = new Promise<{ code: number | null; sig: NodeJS.Signals | null }>((resolve) => {
      child.on("close", (code, sig) => resolve({ code, sig }));
    });

    void closed.then(({ code, sig }) => {
      exited = true;
      clearTimers();
      signal?.removeEventListener("abort", onAbort);
      rl.close();
      if (!resultEmitted) {
        const durationMs = Date.now() - startedAt;
        let error: string;
        let subtype: string;
        if (killReason === "abort") {
          error = "cancelled";
          subtype = "cancelled";
        } else if (killReason === "idle-timeout") {
          error = `idle timeout: no output for ${Math.round(spec.idleTimeoutMs / 1000)} s`;
          subtype = "idle_timeout";
        } else if (killReason === "wall-timeout") {
          error = `wall timeout: exceeded ${Math.round(spec.wallTimeoutMs / 1000)} s`;
          subtype = "wall_timeout";
        } else if (killReason === "consumer-closed") {
          error = "consumer closed";
          subtype = "cancelled";
        } else {
          const tail = stderrBuf.trim().split("\n").slice(-5).join("\n");
          error = `Claude Code CLI exited with ${sig ? `signal ${sig}` : `code ${code}`}${tail ? `: ${tail}` : ""}`;
          subtype = "exit_error";
          if (isNotLoggedInText(stderrBuf)) {
            emit({ type: "error", message: tail || "Not logged in", hint: LOGIN_HINT });
          }
        }
        emit({ type: "result", ok: false, costUsd: 0, turns: 0, durationMs, usage: null, error, subtype, sessionId: effectiveSessionId(spec) });
      }
      queue.close();
    });

    try {
      for await (const ev of queue) yield ev;
    } finally {
      if (!exited) {
        kill("consumer-closed");
      }
    }
  }
}
