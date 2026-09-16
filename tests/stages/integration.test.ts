/**
 * End-to-end pipeline without the real CLI: a replayed stream-json run that "types" a notice
 * DSL inside <<<DOC … DOC>>> → live doc frames → saved version → HWPX export + render.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "gepa-it-"));
process.env.DATA_DIR = tmp;

import { getDb, closeDb } from "../../lib/db/client";
import { projects } from "../../lib/db/schema";
import { ReplayRunner } from "../../lib/agents/replayRunner";
import { writerRunLines } from "../../lib/agents/replayFixtures";
import { getRunManager } from "../../lib/agents/runManager";
import { startStageRun } from "../../lib/stages/runIntegration";
import { readStageDoc, listVersions, currentReport } from "../../lib/stages/service";
import type { ProjectDTO } from "../../lib/contracts";
import type { RunFrame } from "../../lib/agents/runner";

const dsl = readFileSync(join(process.cwd(), "templates/notice/golden/6-1.dsl.md"), "utf8");

function line(obj: unknown): string {
  return JSON.stringify(obj);
}
function textDelta(text: string): string {
  return line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, session_id: "s1", parent_tool_use_id: null });
}
function fixture(): string[] {
  const full = `작성 완료. 아래가 문서입니다.\n<<<DOC\n${dsl}\nDOC>>>\n저장했습니다.`;
  const lines: string[] = [line({ type: "system", subtype: "init", session_id: "s1", model: "claude-opus-5", tools: ["Read", "Write"] })];
  lines.push(line({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, session_id: "s1", parent_tool_use_id: null }));
  // random 1..37 char chunks
  let i = 0, seed = 7;
  while (i < full.length) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = 1 + (seed % 37);
    lines.push(textDelta(full.slice(i, i + n)));
    i += n;
  }
  lines.push(line({ type: "stream_event", event: { type: "content_block_stop", index: 0 }, session_id: "s1", parent_tool_use_id: null }));
  lines.push(line({ type: "assistant", message: { content: [{ type: "text", text: full }] }, session_id: "s1", parent_tool_use_id: null }));
  lines.push(line({ type: "result", subtype: "success", is_error: false, result: full, num_turns: 1, duration_ms: 1200, total_cost_usd: 0, session_id: "s1" }));
  return lines;
}

/** The current contract: the agent streams the document through Write(<stage>/draft.dsl.md) and answers briefly. */
function writeFixture(versions: string[] = [dsl]): string[] {
  return writerRunLines(join(tmp, "projects", "p-it-1", "notice", "draft.dsl.md"), versions, "s2");
}

const project: ProjectDTO = {
  id: "p-it-1", title: "테스트 사업", topic: "안동시 수출기업 지원", region: "안동시", organizer: "안동시",
  contact: { 부서명: "북부지소", 담당자: "김OO", 전화: "054-900-3801", 이메일: "gepa_north@naver.com" },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

beforeAll(() => {
  getDb().insert(projects).values({ id: project.id, title: project.title, topic: project.topic, region: project.region, organizer: project.organizer, contact: JSON.stringify(project.contact), createdAt: project.createdAt, updatedAt: project.updatedAt }).run();
});
afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe("stage run integration (replayed notice run)", () => {
  it("streams doc frames, saves a version, exports and renders HWPX", async () => {
    const rm = getRunManager();
    const { runId } = startStageRun({ project, stage: "notice", runner: new ReplayRunner(fixture()) });
    const frames: RunFrame[] = [];
    const unsub = rm.subscribe(runId, (f) => frames.push(f));
    await rm.waitForRun(runId);
    unsub();
    // export runs in the background after finalize; poll the report file
    let report = currentReport(project.id, "notice");
    for (let i = 0; i < 200 && !report; i++) {
      await new Promise((r) => setTimeout(r, 100));
      report = currentReport(project.id, "notice");
    }
    const docFrames = frames.filter((f) => f.kind === "doc").map((f) => f.data as { type: string } & Record<string, unknown>);
    const types = docFrames.map((d) => d.type);
    expect(types).toContain("doc.open");
    expect(types).toContain("block.open");
    expect(types).toContain("text.delta");
    expect(types).toContain("block.commit");
    expect(types).toContain("doc.final");
    expect(report?.errors).toEqual([]);
    expect(report?.ok).toBe(true);
    expect(report?.pageCount).toBe(7);
    // persisted
    const doc = readStageDoc(project.id, "notice");
    expect(doc?.family).toBe("notice");
    expect(listVersions(project.id, "notice").length).toBe(1);
    expect(existsSync(join(tmp, "projects", project.id, "notice", "out.hwpx"))).toBe(true);
    expect(existsSync(join(tmp, "projects", project.id, "notice", "draft.dsl.md"))).toBe(true);
    // run row
    const run = rm.getRun(runId);
    expect(run?.status).toBe("succeeded");
    // replayed events were persisted and are replayable for SSE reconnects
    expect(rm.listEvents(runId, 0).length).toBeGreaterThan(50);
  }, 120_000);

  it("types the document live from the streamed Write tool input and saves it as the version", async () => {
    const rm = getRunManager();
    const before = listVersions(project.id, "notice").length;
    const { runId } = startStageRun({ project, stage: "notice", runner: new ReplayRunner(writeFixture()) });
    const frames: RunFrame[] = [];
    const unsub = rm.subscribe(runId, (f) => frames.push(f));
    await rm.waitForRun(runId);
    unsub();
    const docFrames = frames.filter((f) => f.kind === "doc").map((f) => f.data as { type: string } & Record<string, unknown>);
    const types = docFrames.map((d) => d.type);
    expect(types.filter((t) => t === "doc.open").length).toBe(1);
    expect(types).toContain("text.delta");
    expect(types).toContain("block.commit");
    expect(types).toContain("doc.final");
    expect(types).not.toContain("doc.error");
    // the live stream must reach the very last body block of the golden document
    const commits = docFrames.filter((d) => d.type === "block.commit");
    expect(JSON.stringify(commits[commits.length - 1])).toContain("\"isTotal\":true");
    expect(listVersions(project.id, "notice").length).toBe(before + 1);
    const saved = readStageDoc(project.id, "notice");
    expect(saved?.family).toBe("notice");
    expect(saved?.blocks.length).toBeGreaterThan(40);
  }, 120_000);

  it("a second Write in the same run opens a rewrite stream (seq 2) and closes both streams", async () => {
    const rm = getRunManager();
    const v2 = dsl.replace("# 사업목적", "# 사업목적\n□ **(추가)** 두 번째 판에서 덧붙인 문단");
    const { runId } = startStageRun({ project, stage: "notice", runner: new ReplayRunner(writeFixture([dsl, v2])) });
    const frames: RunFrame[] = [];
    const unsub = rm.subscribe(runId, (f) => frames.push(f));
    await rm.waitForRun(runId);
    unsub();
    const docFrames = frames.filter((f) => f.kind === "doc").map((f) => f.data as { type: string; seq?: number; rewrite?: boolean } & Record<string, unknown>);
    const opens = docFrames.filter((d) => d.type === "doc.open");
    expect(opens.map((o) => [o.seq, !!o.rewrite])).toEqual([
      [1, false],
      [2, true],
    ]);
    const closes = docFrames.filter((d) => d.type === "doc.close").map((c) => c.seq);
    expect(closes).toEqual([1, 2]);
    // the order is open(1) … close(1) open(2) … close(2) final
    const seq = docFrames.filter((d) => ["doc.open", "doc.close", "doc.final"].includes(d.type)).map((d) => d.type);
    expect(seq).toEqual(["doc.open", "doc.close", "doc.open", "doc.close", "doc.final"]);
    const fin = docFrames.find((d) => d.type === "doc.final") as { doc: { blocks: unknown[] } } | undefined;
    expect(JSON.stringify(fin?.doc)).toContain("두 번째 판에서 덧붙인 문단");
  }, 120_000);
});
