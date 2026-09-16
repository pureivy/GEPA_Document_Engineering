/**
 * RunManager: globalThis singleton that owns active agent runs.
 *
 * - creates the `runs` row, spawns the runner, persists every frame to `run_events` (seq
 *   increasing) and to `<stage>/run-<id>.ndjson`, and broadcasts to in-memory subscribers
 * - enforces one active run per (project, stage)
 * - updates the `runs` row on the terminal `result` event and emits a final `run` frame
 *
 * Frames (see `RunFrame` in runner.ts / `SseFrame` in lib/contracts.ts):
 *   kind=agent  → AgentEvent from the CLI
 *   kind=doc    → published by the document extraction pipeline via `publish()`
 *   kind=run    → `{status, error?}` exactly once, last frame of every run
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, asc, count, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../db/client";
import { runEvents, runs, type RunRow } from "../db/schema";
import { appendRunLogLine } from "../storage/files";
import { ensureStageDir } from "../storage/paths";
import { ClaudeCliRunner, effectiveSessionId } from "./claudeCliRunner";
import { limitsFor, modelFor, STAGE_ALLOWED_TOOLS } from "./limits";
import type { AgentEvent, AgentFrame, AgentRunner, RunFrame, RunSpec, RunStatus, Stage } from "./runner";

export type FrameListener = (frame: RunFrame) => void;
export type AgentEventListener = (frame: AgentFrame) => void;

export interface StartRunInput {
  projectId: string;
  stage: Stage;
  /** Partial spec; `prompt` is required. Missing limits/tools/model come from stage defaults. */
  spec: Partial<Omit<RunSpec, "runId" | "sessionId">> & { prompt: string };
  /** Called synchronously for every agent event after persistence, before broadcast (document extractor hook). */
  onEvent?: AgentEventListener;
  /** Called once after the run row is finalized, before the final `run` frame is broadcast. */
  onEnd?: (run: RunRow, result: Extract<AgentEvent, { type: "result" }> | undefined) => void;
  /** Runner override (tests / replay). Defaults to ClaudeCliRunner. */
  runner?: AgentRunner;
}

export interface StartRunResult {
  runId: string;
  sessionId: string;
}

export class RunConflictError extends Error {
  constructor(
    public readonly projectId: string,
    public readonly stage: Stage,
    public readonly activeRunId: string,
  ) {
    super(`A run is already active for project ${projectId} stage ${stage} (run ${activeRunId})`);
    this.name = "RunConflictError";
  }
}

interface ActiveRun {
  runId: string;
  projectId: string;
  stage: Stage;
  sessionId: string;
  abort: AbortController;
  subscribers: Set<FrameListener>;
  seq: number;
  done: boolean;
  cancelRequested: boolean;
  onEvent?: AgentEventListener;
  onEnd?: StartRunInput["onEnd"];
  finished: Promise<void>;
}

function log(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) console.log("[runManager]", ...args);
}

/** Working directory of spawned CLI runs: `<repo>/agent` (holds `.claude/agents` and `.claude/skills`). */
export function defaultAgentCwd(): string {
  return path.join(process.cwd(), "agent");
}

export class RunManager {
  private active = new Map<string, ActiveRun>();
  private byStage = new Map<string, string>(); // `${projectId}:${stage}` → runId
  private defaultRunner: AgentRunner | undefined;

  /** Inject a default runner (tests). */
  setDefaultRunner(runner: AgentRunner | undefined): void {
    this.defaultRunner = runner;
  }

  private stageKey(projectId: string, stage: Stage): string {
    return `${projectId}:${stage}`;
  }

  isActive(runId: string): boolean {
    const a = this.active.get(runId);
    return !!a && !a.done;
  }

  activeRunFor(projectId: string, stage: Stage): string | undefined {
    const id = this.byStage.get(this.stageKey(projectId, stage));
    return id && this.isActive(id) ? id : undefined;
  }

  listActive(): Array<{ runId: string; projectId: string; stage: Stage; sessionId: string }> {
    return [...this.active.values()]
      .filter((a) => !a.done)
      .map(({ runId, projectId, stage, sessionId }) => ({ runId, projectId, stage, sessionId }));
  }

  startRun(input: StartRunInput): StartRunResult {
    const { projectId, stage } = input;
    const existing = this.activeRunFor(projectId, stage);
    if (existing) throw new RunConflictError(projectId, stage, existing);

    const db = getDb();
    const limits = limitsFor(stage, {
      maxTurns: input.spec.maxTurns,
      wallTimeoutMs: input.spec.wallTimeoutMs,
      idleTimeoutMs: input.spec.idleTimeoutMs,
    });
    const runId = randomUUID();
    const spec: RunSpec = {
      runId,
      sessionId: randomUUID(),
      ...(input.spec.resumeSessionId ? { resumeSessionId: input.spec.resumeSessionId } : {}),
      cwd: input.spec.cwd ?? defaultAgentCwd(),
      addDirs: input.spec.addDirs ?? [],
      systemPromptAppend: input.spec.systemPromptAppend ?? "",
      prompt: input.spec.prompt,
      allowedTools: input.spec.allowedTools ?? STAGE_ALLOWED_TOOLS[stage],
      ...(input.spec.tools ? { tools: input.spec.tools } : {}),
      ...(input.spec.strictMcpConfig !== undefined ? { strictMcpConfig: input.spec.strictMcpConfig } : {}),
      ...(input.spec.mcpConfigPath ? { mcpConfigPath: input.spec.mcpConfigPath } : {}),
      ...(input.spec.settingSources ? { settingSources: input.spec.settingSources } : {}),
      model: input.spec.model ?? modelFor(stage),
      maxTurns: limits.maxTurns,
      wallTimeoutMs: limits.wallTimeoutMs,
      idleTimeoutMs: limits.idleTimeoutMs,
      ...(input.spec.jsonSchema ? { jsonSchema: input.spec.jsonSchema } : {}),
      ...(input.spec.env ? { env: input.spec.env } : {}),
    };
    const sessionId = effectiveSessionId(spec);
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();

    ensureStageDir(projectId, stage);
    db.insert(runs)
      .values({
        id: runId,
        projectId,
        stage,
        sessionId,
        status: "running",
        model: spec.model ?? modelFor(stage),
        startedAt,
      })
      .run();

    const abort = new AbortController();
    let resolveFinished: () => void = () => {};
    const finished = new Promise<void>((r) => (resolveFinished = r));
    const active: ActiveRun = {
      runId,
      projectId,
      stage,
      sessionId,
      abort,
      subscribers: new Set(),
      seq: 0,
      done: false,
      cancelRequested: false,
      onEvent: input.onEvent,
      onEnd: input.onEnd,
      finished,
    };
    this.active.set(runId, active);
    this.byStage.set(this.stageKey(projectId, stage), runId);

    const runner = input.runner ?? this.defaultRunner ?? new ClaudeCliRunner();
    log(`start run=${runId} project=${projectId} stage=${stage} session=${sessionId} resume=${!!spec.resumeSessionId}`);

    const failedResult = (error: string, subtype: string): Extract<AgentEvent, { type: "result" }> => ({
      type: "result",
      ok: false,
      costUsd: 0,
      turns: 0,
      durationMs: Date.now() - startedMs,
      usage: null,
      error,
      subtype,
      sessionId,
    });

    void (async () => {
      let result: Extract<AgentEvent, { type: "result" }> | undefined;
      try {
        for await (const ev of runner.run(spec, abort.signal)) {
          if (active.done) break;
          this.recordAgent(active, ev);
          if (ev.type === "result") {
            result = ev;
            break;
          }
        }
        if (!result) {
          result = failedResult("runner ended without a result event", "runner_error");
          this.recordAgent(active, result);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.recordAgent(active, { type: "error", message });
        result = failedResult(message, "runner_error");
        this.recordAgent(active, result);
      } finally {
        this.finalize(active, result);
        resolveFinished();
      }
    })();

    return { runId, sessionId };
  }

  /** Persist + broadcast one frame. */
  private record(active: ActiveRun, frame: Omit<RunFrame, "seq" | "ts">): RunFrame {
    const seq = ++active.seq;
    const ts = new Date().toISOString();
    const full = { ...frame, seq, ts } as RunFrame;
    const db = getDb();
    try {
      db.insert(runEvents)
        .values({
          runId: active.runId,
          seq,
          type: `${full.kind}:${full.kind === "run" ? "status" : full.data.type}`,
          payload: JSON.stringify(full.data),
          createdAt: ts,
        })
        .run();
    } catch (err) {
      log(`failed to persist frame seq=${seq} run=${active.runId}:`, err);
    }
    try {
      appendRunLogLine(active.projectId, active.stage, active.runId, JSON.stringify(full));
    } catch (err) {
      log(`failed to append run log run=${active.runId}:`, err);
    }
    if (full.kind === "agent" && active.onEvent) {
      try {
        active.onEvent(full);
      } catch (err) {
        log(`onEvent hook threw for run=${active.runId}:`, err);
      }
    }
    for (const cb of [...active.subscribers]) {
      try {
        cb(full);
      } catch (err) {
        log(`subscriber threw for run=${active.runId}:`, err);
      }
    }
    return full;
  }

  private recordAgent(active: ActiveRun, ev: AgentEvent): RunFrame {
    return this.record(active, { kind: "agent", data: ev });
  }

  /**
   * Publish a `doc` frame for an active run (used by the document extraction pipeline).
   * Returns the persisted frame, or undefined when the run is not active.
   */
  publish(runId: string, data: { type: string } & Record<string, unknown>): RunFrame | undefined {
    const a = this.active.get(runId);
    if (!a || a.done) return undefined;
    return this.record(a, { kind: "doc", data });
  }

  private finalize(active: ActiveRun, result: Extract<AgentEvent, { type: "result" }> | undefined): void {
    if (active.done) return;
    const db = getDb();
    let status: RunStatus;
    if (result?.ok) status = "succeeded";
    else if (active.cancelRequested || result?.subtype === "cancelled") status = "cancelled";
    else status = "failed";
    const error = result && !result.ok ? (result.error ?? result.subtype ?? "failed") : null;
    const summary = result
      ? {
          subtype: result.subtype,
          usage: result.usage,
          durationMs: result.durationMs,
          events: active.seq,
          ...(result.structured !== undefined ? { structured: result.structured } : {}),
          ...(result.text ? { text: result.text.slice(0, 4000) } : {}),
        }
      : undefined;
    db.update(runs)
      .set({
        status,
        endedAt: new Date().toISOString(),
        numTurns: result?.turns ?? null,
        costUsd: result?.costUsd ?? null,
        error,
        summary: summary ? JSON.stringify(summary) : null,
      })
      .where(eq(runs.id, active.runId))
      .run();
    log(`end run=${active.runId} status=${status} turns=${result?.turns ?? "?"} frames=${active.seq}`);
    if (active.onEnd) {
      const row = this.getRun(active.runId);
      if (row) {
        try {
          active.onEnd(row, result);
        } catch (err) {
          log(`onEnd hook threw for run=${active.runId}:`, err);
        }
      }
    }
    // Final frame: closes SSE streams.
    this.record(active, { kind: "run", data: { status, ...(error ? { error } : {}) } });
    active.done = true;
    const key = this.stageKey(active.projectId, active.stage);
    if (this.byStage.get(key) === active.runId) this.byStage.delete(key);
    this.active.delete(active.runId);
    active.subscribers.clear();
  }

  cancelRun(runId: string): boolean {
    const a = this.active.get(runId);
    if (!a || a.done) return false;
    a.cancelRequested = true;
    a.abort.abort();
    return true;
  }

  /** Resolves when the run's final frame has been persisted (tests / graceful shutdown). */
  waitForRun(runId: string): Promise<void> {
    const a = this.active.get(runId);
    return a ? a.finished : Promise.resolve();
  }

  getRun(runId: string): RunRow | undefined {
    return getDb().select().from(runs).where(eq(runs.id, runId)).get();
  }

  listRunsForProject(projectId: string): RunRow[] {
    return getDb().select().from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.startedAt)).all();
  }

  latestRun(projectId: string, stage: Stage): RunRow | undefined {
    return getDb()
      .select()
      .from(runs)
      .where(and(eq(runs.projectId, projectId), eq(runs.stage, stage)))
      .orderBy(desc(runs.startedAt))
      .limit(1)
      .get();
  }

  listEvents(runId: string, afterSeq = 0): RunFrame[] {
    const rows = getDb()
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
      .orderBy(asc(runEvents.seq))
      .all();
    return rows.map((r) => {
      const kind = (r.type.split(":")[0] || "agent") as RunFrame["kind"];
      return { seq: r.seq, ts: r.createdAt, kind, data: JSON.parse(r.payload) } as RunFrame;
    });
  }

  countEventsAfter(runId: string, afterSeq = 0): number {
    const row = getDb()
      .select({ n: count() })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
      .get();
    return row?.n ?? 0;
  }

  /**
   * Subscribe to live frames. Returns an unsubscribe function. If the run is not active the
   * callback is never invoked (use `listEvents` to replay) and the returned value is a no-op.
   */
  subscribe(runId: string, cb: FrameListener): () => void {
    const a = this.active.get(runId);
    if (!a || a.done) return () => {};
    a.subscribers.add(cb);
    return () => {
      a.subscribers.delete(cb);
    };
  }
}

const GLOBAL_KEY = "__gepaRunManager" as const;
type G = typeof globalThis & { [GLOBAL_KEY]?: RunManager };

export function getRunManager(): RunManager {
  const g = globalThis as G;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new RunManager();
  return g[GLOBAL_KEY];
}
