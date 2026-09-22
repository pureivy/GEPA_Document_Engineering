/**
 * 참고 문서 업로드 라우트의 kind 게이트 — run 라우트의 구멍(runRouteKind.test.ts)의 형제.
 * 화면은 stagesOf 로 막지만, 이 라우트를 직접 POST(autoRun=1) 하면 공문 프로젝트 안에도
 * research 실행이 생길 수 있었다 — 그 구멍을 막았는지 양방향으로 본다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "gepa-refroute-"));
process.env.DATA_DIR = tmp;

import { getDb, closeDb } from "../../lib/db/client";
import { projects, type ProjectRow } from "../../lib/db/schema";
import { getRunManager } from "../../lib/agents/runManager";
import { ReplayRunner } from "../../lib/agents/replayRunner";
import * as F from "../agents/fixtures";
import { POST } from "../../app/api/projects/[id]/reference/route";

const PROGRAM = "p-program-ref";
const OFFICIAL = "p-official-ref";

function row(id: string, kind: string): ProjectRow {
  const now = new Date().toISOString();
  return {
    id,
    kind,
    title: "t",
    topic: "t",
    region: "",
    organizer: "",
    contact: JSON.stringify({ 부서명: "전략기획팀", 전화: "054-470-8527", 이메일: "a@gepa.kr" }),
    referenceName: null,
    referenceChanges: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** POST …/projects/<id>/reference (multipart) */
function upload(id: string, autoRun: boolean): Promise<Response> {
  const form = new FormData();
  form.append("file", new File(["본문"], "ref.txt", { type: "text/plain" }));
  if (autoRun) form.append("autoRun", "1");
  const req = new Request(`http://localhost/api/projects/${id}/reference`, { method: "POST", body: form });
  return POST(req, { params: Promise.resolve({ id }) });
}

beforeAll(() => {
  getDb().insert(projects).values([row(PROGRAM, "program"), row(OFFICIAL, "official")]).run();
  // research 실행이 실제로 통과하면 CLI 를 부르지 않도록 대체 러너를 기본값으로 둔다
  getRunManager().setDefaultRunner(new ReplayRunner(F.basicRunLines));
});

afterAll(() => {
  getRunManager().setDefaultRunner(undefined);
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe("참고 문서 업로드 라우트의 kind 게이트", () => {
  it("공문 프로젝트에서 autoRun 을 거부한다 — 공문 안에 research 실행이 생기면 안 된다", async () => {
    const res = await upload(OFFICIAL, true);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("공문");
  });

  it("사업 프로젝트에서는 autoRun 이 통과해 research 실행을 시작한다", async () => {
    const res = await upload(PROGRAM, true);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { run: { runId: string } | null };
    expect(body.run).not.toBeNull();
    await getRunManager().waitForRun(body.run!.runId);
  });

  it("autoRun 없이는 어느 kind 든 파일만 저장한다(게이트가 닿지 않는다)", async () => {
    const res = await upload(OFFICIAL, false);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { run: unknown };
    expect(body.run).toBeNull();
  });
});
