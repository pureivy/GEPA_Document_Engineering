/**
 * Test-only runner: replays recorded stream-json NDJSON lines through the parser with small
 * delays, so RunManager / SSE / extractor code can be exercised without the real CLI.
 */
import type { AgentEvent, AgentRunner, RunSpec } from "./runner";
import { StreamJsonParser } from "./streamJson";

export interface ReplayRunnerOptions {
  /** Delay between lines in ms (default 0 → yields to the event loop only). */
  delayMs?: number;
  /** If true (default), synthesize a failed `result` when the fixture has none. */
  ensureResult?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ReplayRunner implements AgentRunner {
  constructor(
    private readonly lines: readonly string[],
    private readonly options: ReplayRunnerOptions = {},
  ) {}

  async *run(spec: RunSpec, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const parser = new StreamJsonParser();
    const delayMs = this.options.delayMs ?? 0;
    const started = Date.now();
    for (const line of this.lines) {
      if (signal?.aborted) break;
      if (delayMs > 0) await sleep(delayMs);
      else await Promise.resolve();
      if (signal?.aborted) break;
      for (const ev of parser.push(line)) {
        yield ev;
        if (ev.type === "result") return;
      }
    }
    if (signal?.aborted) {
      yield {
        type: "result",
        ok: false,
        costUsd: 0,
        turns: 0,
        durationMs: Date.now() - started,
        usage: null,
        error: "cancelled",
        subtype: "cancelled",
        sessionId: spec.resumeSessionId ?? spec.sessionId,
      };
      return;
    }
    if (this.options.ensureResult !== false && !parser.hasResult) {
      yield {
        type: "result",
        ok: false,
        costUsd: 0,
        turns: 0,
        durationMs: Date.now() - started,
        usage: null,
        error: "fixture ended without a result line",
        subtype: "replay_incomplete",
        sessionId: spec.resumeSessionId ?? spec.sessionId,
      };
    }
  }
}
