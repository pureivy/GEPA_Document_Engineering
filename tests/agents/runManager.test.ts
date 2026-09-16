import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as F from "./fixtures";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "gepa-rm-"));
  process.env.DATA_DIR = tmp;
});

afterAll(async () => {
  const { closeDb } = await import("../../lib/db/client");
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

async function setup() {
  const { getDb } = await import("../../lib/db/client");
  const { projects } = await import("../../lib/db/schema");
  const { RunManager } = await import("../../lib/agents/runManager");
  const { ReplayRunner } = await import("../../lib/agents/replayRunner");
  const { createRunEventStream } = await import("../../lib/agents/sse");
  const { readRunLogLines } = await import("../../lib/storage/files");
  const db = getDb();
  const now = new Date().toISOString();
  const projectId = `p-${Math.random().toString(36).slice(2, 8)}`;
  db.insert(projects).values({ id: projectId, title: "t", topic: "topic", createdAt: now, updatedAt: now }).run();
  return { db, projectId, RunManager, ReplayRunner, createRunEventStream, readRunLogLines };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

function parseFrames(text: string): Array<{ id?: number; event?: string; data?: unknown }> {
  return text
    .split("\n\n")
    .filter((b) => b.trim() && !b.startsWith(":"))
    .map((block) => {
      const f: { id?: number; event?: string; data?: unknown } = {};
      for (const line of block.split("\n")) {
        if (line.startsWith("id: ")) f.id = Number(line.slice(4));
        else if (line.startsWith("event: ")) f.event = line.slice(7);
        else if (line.startsWith("data: ")) f.data = JSON.parse(line.slice(6));
      }
      return f;
    });
}

describe("RunManager", () => {
  it("persists frames, updates the run row and finishes with a run frame", async () => {
    const { projectId, RunManager, ReplayRunner, readRunLogLines } = await setup();
    const rm = new RunManager();
    const seen: string[] = [];
    const hooked: string[] = [];
    const { runId, sessionId } = rm.startRun({
      projectId,
      stage: "research",
      spec: { prompt: "go" },
      runner: new ReplayRunner(F.basicRunLines),
      onEvent: (f) => hooked.push(f.data.type),
    });
    expect(sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(rm.isActive(runId)).toBe(true);
    expect(rm.activeRunFor(projectId, "research")).toBe(runId);
    const unsub = rm.subscribe(runId, (f) => seen.push(`${f.kind}:${f.kind === "run" ? f.data.status : f.data.type}`));
    await rm.waitForRun(runId);
    unsub();

    expect(rm.isActive(runId)).toBe(false);
    const row = rm.getRun(runId)!;
    expect(row.status).toBe("succeeded");
    expect(row.numTurns).toBe(4);
    expect(row.costUsd).toBeCloseTo(0.42);
    expect(row.endedAt).not.toBeNull();
    expect(row.sessionId).toBe(sessionId);

    const frames = rm.listEvents(runId);
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i + 1));
    expect(frames[0]).toMatchObject({ kind: "agent", data: { type: "init", sessionId: F.SID } });
    expect(frames.at(-1)).toMatchObject({ kind: "run", data: { status: "succeeded" } });
    expect(frames.at(-2)).toMatchObject({ kind: "agent", data: { type: "result", ok: true } });
    expect(seen.at(-1)).toBe("run:succeeded");
    expect(hooked).toContain("text.delta");
    expect(hooked).not.toContain("status");

    expect(rm.listEvents(runId, frames.length - 2).map((f) => f.seq)).toEqual([frames.length - 1, frames.length]);
    expect(readRunLogLines(projectId, "research", runId)).toHaveLength(frames.length);
  });

  it("enforces one active run per (project, stage) and allows another stage", async () => {
    const { projectId, RunManager, ReplayRunner } = await setup();
    const rm = new RunManager();
    const a = rm.startRun({ projectId, stage: "plan", spec: { prompt: "a" }, runner: new ReplayRunner(F.basicRunLines, { delayMs: 5 }) });
    expect(() => rm.startRun({ projectId, stage: "plan", spec: { prompt: "b" }, runner: new ReplayRunner(F.basicRunLines) })).toThrow(/already active/);
    const c = rm.startRun({ projectId, stage: "notice", spec: { prompt: "c" }, runner: new ReplayRunner(F.basicRunLines) });
    await Promise.all([rm.waitForRun(a.runId), rm.waitForRun(c.runId)]);
    expect(rm.getRun(a.runId)!.status).toBe("succeeded");
    expect(rm.getRun(c.runId)!.status).toBe("succeeded");
    const d = rm.startRun({ projectId, stage: "plan", spec: { prompt: "d" }, runner: new ReplayRunner(F.basicRunLines) });
    await rm.waitForRun(d.runId);
  });

  it("cancels a run: status cancelled, run frame carries the error", async () => {
    const { projectId, RunManager, ReplayRunner } = await setup();
    const rm = new RunManager();
    const { runId } = rm.startRun({ projectId, stage: "press", spec: { prompt: "x" }, runner: new ReplayRunner(F.basicRunLines, { delayMs: 20 }) });
    await new Promise((r) => setTimeout(r, 50));
    expect(rm.cancelRun(runId)).toBe(true);
    await rm.waitForRun(runId);
    expect(rm.cancelRun(runId)).toBe(false);
    const row = rm.getRun(runId)!;
    expect(row.status).toBe("cancelled");
    const last = rm.listEvents(runId).at(-1)!;
    expect(last).toMatchObject({ kind: "run", data: { status: "cancelled" } });
  });

  it("marks failed runs and the resumed session id is reused", async () => {
    const { projectId, RunManager, ReplayRunner } = await setup();
    const rm = new RunManager();
    const { runId, sessionId } = rm.startRun({
      projectId,
      stage: "review",
      spec: { prompt: "x", resumeSessionId: "old-session" },
      runner: new ReplayRunner([F.initLine, F.resultMaxTurns]),
    });
    expect(sessionId).toBe("old-session");
    await rm.waitForRun(runId);
    const row = rm.getRun(runId)!;
    expect(row.status).toBe("failed");
    expect(row.error).toBe("error_max_turns");
  });

  it("publishes doc frames for active runs only", async () => {
    const { projectId, RunManager, ReplayRunner } = await setup();
    const rm = new RunManager();
    const { runId } = rm.startRun({ projectId, stage: "notice", spec: { prompt: "x" }, runner: new ReplayRunner(F.basicRunLines, { delayMs: 5 }) });
    const f = rm.publish(runId, { type: "block.open", block: { id: "b1" } });
    expect(f).toMatchObject({ kind: "doc", data: { type: "block.open" } });
    await rm.waitForRun(runId);
    expect(rm.publish(runId, { type: "block.open" })).toBeUndefined();
    const docFrames = rm.listEvents(runId).filter((x) => x.kind === "doc");
    expect(docFrames).toHaveLength(1);
  });

  it("SSE stream: replays after Last-Event-ID, streams live frames, and closes on the run frame", async () => {
    const { projectId, RunManager, ReplayRunner, createRunEventStream } = await setup();
    const rm = new RunManager();
    const { runId } = rm.startRun({ projectId, stage: "research", spec: { prompt: "x" }, runner: new ReplayRunner(F.basicRunLines, { delayMs: 3 }) });
    // let a few frames land in the DB first
    await new Promise((r) => setTimeout(r, 20));
    const persistedSoFar = rm.listEvents(runId).length;
    expect(persistedSoFar).toBeGreaterThan(0);
    const afterSeq = 2;
    const text = await readAll(createRunEventStream(runId, { afterSeq, manager: rm, heartbeatMs: 5 }));
    const frames = parseFrames(text);
    expect(frames[0].id).toBe(afterSeq + 1);
    const ids = frames.map((f) => f.id);
    expect(ids).toEqual(ids.map((_, i) => afterSeq + 1 + i)); // contiguous, no duplicates, no gaps
    expect(frames.at(-1)).toMatchObject({ event: "run", data: { status: "succeeded" } });
    expect(frames.some((f) => f.event === "agent" && (f.data as { type: string }).type === "text.delta")).toBe(true);
    expect(text).toContain(": replay after 2");

    // finished run: full replay then immediate close
    const again = parseFrames(await readAll(createRunEventStream(runId, { manager: rm })));
    expect(again[0].id).toBe(1);
    expect(again.at(-1)).toMatchObject({ event: "run" });
  });

  it("SSE stream closes when the request is aborted", async () => {
    const { projectId, RunManager, ReplayRunner, createRunEventStream } = await setup();
    const rm = new RunManager();
    const { runId } = rm.startRun({ projectId, stage: "plan", spec: { prompt: "x" }, runner: new ReplayRunner(F.basicRunLines, { delayMs: 30 }) });
    const ac = new AbortController();
    const p = readAll(createRunEventStream(runId, { manager: rm, signal: ac.signal, heartbeatMs: 5 }));
    setTimeout(() => ac.abort(), 40);
    const text = await p;
    expect(text).not.toContain('"status":"succeeded"');
    rm.cancelRun(runId);
    await rm.waitForRun(runId);
  });
});

describe("SSE orphaned runs", () => {
  it("synthesizes a run frame from the row when no run frame was persisted", async () => {
    const { db, projectId, RunManager, createRunEventStream } = await setup();
    const { runs, runEvents } = await import("../../lib/db/schema");
    const rm = new RunManager();
    const now = new Date().toISOString();
    db.insert(runs).values({ id: "orphan-1", projectId, stage: "plan", sessionId: "s", status: "failed", model: "opus", startedAt: now, endedAt: now, error: "server restarted while the run was active" }).run();
    db.insert(runEvents).values({ runId: "orphan-1", seq: 1, type: "agent:init", payload: JSON.stringify({ type: "init", sessionId: "s", model: "m", tools: [] }), createdAt: now }).run();
    db.insert(runEvents).values({ runId: "orphan-1", seq: 2, type: "agent:text.delta", payload: JSON.stringify({ type: "text.delta", text: "x" }), createdAt: now }).run();
    const frames = parseFrames(await readAll(createRunEventStream("orphan-1", { manager: rm })));
    expect(frames.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(frames.at(-1)).toEqual({ id: 3, event: "run", data: { status: "failed", error: "server restarted while the run was active" } });
    expect(rm.countEventsAfter("orphan-1", 2)).toBe(0);
    expect(rm.countEventsAfter("orphan-1", 0)).toBe(2);
  });
});
