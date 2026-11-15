/**
 * 참고 문서 업로드 라우트의 누적 — 부를 때마다 더해지고, 같은 이름은 제자리에서 바뀌고,
 * 에이전트가 읽는 base-plan.md 는 전체 목록으로 다시 만들어진다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "gepa-refmulti-"));
process.env.DATA_DIR = tmp;

import { getDb, closeDb } from "../../lib/db/client";
import { projects, type ProjectRow } from "../../lib/db/schema";
import { projectDir } from "../../lib/storage/paths";
import type { ProjectDTO } from "../../lib/contracts";
import { POST } from "../../app/api/projects/[id]/reference/route";

const OFFICIAL = "p-official-multi";
const PROGRAM = "p-program-multi";

function row(id: string, kind: string): ProjectRow {
  const now = new Date().toISOString();
  return {
    id,
    kind,
    title: "t",
    topic: "t",
    region: "",
    organizer: "",
    contact: JSON.stringify({ 부서명: "전략기획팀", 전화: "054-470-8527", 이메일: "a@gepa.kr", ...(kind === "official" ? { 참고문서용도: "근거자료" } : {}) }),
    referenceName: null,
    referenceChanges: null,
    referenceNames: null,
    createdAt: now,
    updatedAt: now,
  };
}

type Body = { project: ProjectDTO; files: { name: string; chars: number }[]; chars: number; error?: string };

async function upload(id: string, files: [string, string][], changes?: string): Promise<{ status: number; body: Body }> {
  const form = new FormData();
  for (const [name, text] of files) form.append("file", new File([text], name, { type: "text/plain" }));
  if (changes !== undefined) form.append("changes", changes);
  const req = new Request(`http://localhost/api/projects/${id}/reference`, { method: "POST", body: form });
  const res = await POST(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Body };
}

const basePlan = (id: string) => readFileSync(join(projectDir(id), "reference", "base-plan.md"), "utf8");

beforeAll(() => {
  getDb().insert(projects).values([row(OFFICIAL, "official"), row(PROGRAM, "program")]).run();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe("참고 문서 업로드 — 여러 파일 누적", () => {
  it("두 번 올리면 둘 다 남고, base-plan.md 에 둘 다 실린다", async () => {
    const first = await upload(OFFICIAL, [["a.txt", "A 본문"]], "회신 근거");
    expect(first.status).toBe(201);
    expect(first.body.project.reference).toEqual({ fileName: "a.txt", fileNames: ["a.txt"], changes: "회신 근거" });
    // 파일이 하나일 때는 예전 단일 파일 문자열 그대로다
    expect(basePlan(OFFICIAL)).toContain("# 참고 문서 — a.txt");

    const second = await upload(OFFICIAL, [["b.txt", "B 본문"]]);
    expect(second.status).toBe(201);
    expect(second.body.project.reference).toEqual({ fileName: "a.txt", fileNames: ["a.txt", "b.txt"], changes: "회신 근거" });
    const md = basePlan(OFFICIAL);
    expect(md).toContain("# 참고 문서 2건 — a.txt, b.txt");
    expect(md).toContain("## 참고 문서 1/2 원문 — a.txt\n\nA 본문");
    expect(md).toContain("## 참고 문서 2/2 원문 — b.txt\n\nB 본문");
    // changes 필드를 보내지 않으면 앞서 적은 것이 그대로 남는다
    expect(md).toContain("## 이 문서에서 쓸 내용\n\n회신 근거");
    for (const n of ["a.txt", "b.txt"]) {
      expect(existsSync(join(projectDir(OFFICIAL), "reference", n))).toBe(true);
      expect(existsSync(join(projectDir(OFFICIAL), "reference", ".extracted", `${n}.txt`))).toBe(true);
    }
  });

  it("같은 이름을 다시 올리면 제자리에서 내용만 바뀐다", async () => {
    const r = await upload(OFFICIAL, [["a.txt", "A 본문(고침)"]]);
    expect(r.status).toBe(201);
    expect(r.body.project.reference?.fileNames).toEqual(["a.txt", "b.txt"]);
    const md = basePlan(OFFICIAL);
    expect(md).toContain("## 참고 문서 1/2 원문 — a.txt\n\nA 본문(고침)");
    expect(md).not.toContain("A 본문\n");
  });

  it("한 요청에 여러 file 을 담아도 되고, 하나라도 못 읽으면 아무 것도 더하지 않는다", async () => {
    const ok = await upload(PROGRAM, [["2026 계획서.txt", "계획서 본문"], ["결과보고.txt", "결과 본문"]], "연도 2027");
    expect(ok.status).toBe(201);
    expect(ok.body.files.map((f) => f.name)).toEqual(["2026 계획서.txt", "결과보고.txt"]);
    expect(ok.body.project.reference?.fileNames).toEqual(["2026 계획서.txt", "결과보고.txt"]);
    const md = basePlan(PROGRAM);
    expect(md).toContain("# 기존 사업계획서 — 2026 계획서.txt (함께 올린 참고 문서 1건: 결과보고.txt)");
    expect(md).toContain("## 함께 올린 참고 문서 2/2 원문 — 결과보고.txt");

    const bad = await upload(PROGRAM, [["c.txt", "C 본문"], ["empty.txt", "   "]]);
    expect(bad.status).toBe(422);
    expect(bad.body.error).toContain("empty.txt");
    expect(basePlan(PROGRAM)).not.toContain("C 본문");
    expect(existsSync(join(projectDir(PROGRAM), "reference", "c.txt"))).toBe(false);
  });

  it("base-plan.md 라는 이름은 받지 않는다 — 에이전트가 읽는 파일을 덮어쓰게 된다", async () => {
    const r = await upload(OFFICIAL, [["base-plan.md", "덮어쓰기"]]);
    expect(r.status).toBe(400);
  });
});
