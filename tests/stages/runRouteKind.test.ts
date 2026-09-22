/**
 * 실행 라우트의 kind 게이트. 화면은 stagesOf 로 404 를 내지만, 라우트를 직접 POST 하면
 * 사업 프로젝트 안에 공문이 생길 수 있었다 — 그 구멍을 막았는지 양방향으로 본다.
 *
 * 통과 방향은 `resume: true` 로 두드린다: kind 게이트를 지나면 "이어서 진행할 이전 실행이 없습니다"(409)에
 * 걸리므로, 에이전트를 띄우지 않고도 게이트를 통과했다는 것이 증명된다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "gepa-runroute-"));
process.env.DATA_DIR = tmp;

import { getDb, closeDb } from "../../lib/db/client";
import { projects, type ProjectRow } from "../../lib/db/schema";
import { POST } from "../../app/api/projects/[id]/stages/[stage]/run/route";

const PROGRAM = "p-program";
const OFFICIAL = "p-official";

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

/** POST …/projects/<id>/stages/<stage>/run */
function run(id: string, stage: string, body: Record<string, unknown> = {}): Promise<Response> {
  const req = new Request(`http://localhost/api/projects/${id}/stages/${stage}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id, stage }) });
}

beforeAll(() => {
  getDb().insert(projects).values([row(PROGRAM, "program"), row(OFFICIAL, "official")]).run();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe("실행 라우트의 kind 게이트", () => {
  it("사업 프로젝트에서 공문 단계 실행을 거부한다 — 사업 안에 공문이 생기면 안 된다", async () => {
    const res = await run(PROGRAM, "official");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("official");
  });

  it("공문 프로젝트에서 사업 단계 실행을 거부한다", async () => {
    for (const stage of ["research", "plan", "notice", "press"]) {
      const res = await run(OFFICIAL, stage);
      expect(res.status, stage).toBe(404);
    }
  });

  it("검토(review)는 어느 종류에서도 통과한다 — 어느 kind 의 목록에도 없지만 문서 단계에 덧붙는다", async () => {
    for (const id of [PROGRAM, OFFICIAL]) {
      const res = await run(id, "review", { resume: true });
      // kind 게이트를 지났으므로 "이전 실행 없음"에서 멈춘다 (404 가 아니다)
      expect(res.status, id).toBe(409);
    }
  });

  it("자기 종류의 단계는 통과한다", async () => {
    expect((await run(PROGRAM, "notice", { resume: true })).status).toBe(409);
    expect((await run(OFFICIAL, "official", { resume: true })).status).toBe(409);
  });

  /**
   * `report` 는 예전에 여기서 "모르는 단계"의 본보기였다. 이제는 실재하는 단계라 kind 게이트에
   * 걸려 404 가 된다(아직 어느 kind 의 목록에도 없다) — 모르는 단계 쪽은 진짜 없는 이름으로 본다.
   */
  it("사업 프로젝트에서 업무보고 단계 실행을 거부한다", async () => {
    expect((await run(PROGRAM, "report")).status).toBe(404);
  });

  it("모르는 단계는 400, 없는 프로젝트는 404 그대로다", async () => {
    expect((await run(PROGRAM, "없는단계")).status).toBe(400);
    expect((await run("no-such-project", "plan")).status).toBe(404);
  });
});
