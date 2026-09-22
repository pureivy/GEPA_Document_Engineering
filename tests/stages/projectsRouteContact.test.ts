/**
 * POST /api/projects — 결문의 우편번호·전송이 contact(looseObject)를 거쳐 그대로 저장되는지.
 * 둘 다 선택 입력이라, 준 값은 온전히 남고 안 준 값은 스키마를 거절하지 않아야 한다
 * (user 2026-09-22: 결문 우/주소/전송 빈칸 보완).
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "gepa-projects-contact-"));
process.env.DATA_DIR = tmp;

import { closeDb } from "../../lib/db/client";
import { POST } from "../../app/api/projects/route";

function create(contact: Record<string, unknown>): Promise<Response> {
  const req = new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "t", topic: "t", contact }),
  });
  return POST(req);
}

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe("POST /api/projects — contact 의 우편번호·전송", () => {
  it("준 값은 그대로 저장된다", async () => {
    const res = await create({ 부서명: "북부지소", 전화: "054-900-3801", 이메일: "a@gepa.kr", 우편주소: "경상북도 안동시 북순환로 387", 우편번호: "39393", 전송: "054-472-2989" });
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: { contact: Record<string, unknown> } };
    expect(project.contact.우편번호).toBe("39393");
    expect(project.contact.전송).toBe("054-472-2989");
  });

  it("안 준 값은 스키마를 거절하지 않고 그냥 빠진다", async () => {
    const res = await create({ 부서명: "북부지소", 전화: "054-900-3801", 이메일: "a@gepa.kr" });
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: { contact: Record<string, unknown> } };
    expect(project.contact.우편번호).toBeUndefined();
    expect(project.contact.전송).toBeUndefined();
  });
});
