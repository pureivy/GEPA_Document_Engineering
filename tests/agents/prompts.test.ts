import { describe, it, expect } from "vitest";
import { buildStagePrompt } from "../../lib/agents/prompts";
import type { ProjectDTO } from "../../lib/contracts";

const project: ProjectDTO = {
  id: "p1",
  kind: "program",
  title: "2027년 안동시 수출기업 역량강화 지원사업",
  topic: "안동시 수출기업 30개사 지원",
  region: "안동시",
  organizer: "(재)경상북도경제진흥원",
  contact: { 부서명: "북부지소", 전화: "054-900-3801", 이메일: "gepa_north@naver.com" },
  createdAt: "2026-09-16T00:00:00Z",
  updatedAt: "2026-09-16T00:00:00Z",
};
const ws = "/tmp/ws";

describe("buildStagePrompt — reference plan and 보충 조사 option", () => {
  it("plan stage has no research tools by default and forbids 보충 조사", () => {
    const p = buildStagePrompt({ stage: "plan", project, workspaceDir: ws });
    expect(p.allowedTools).toEqual(["Read", "Write", "Glob", "Grep"]);
    expect(p.prompt).toContain("보충 조사는 하지 않는다");
    expect(p.prompt).not.toContain("reference/base-plan.md");
  });
  it("supplementalResearch re-enables Task/WebSearch/WebFetch with a 2-call cap", () => {
    const p = buildStagePrompt({ stage: "plan", project, workspaceDir: ws, supplementalResearch: true });
    expect(p.allowedTools).toContain("Task");
    expect(p.prompt).toContain("최대 2회");
  });
  it("an uploaded 기존 사업계획서 is announced in the brief and guides research/plan/notice", () => {
    const withRef: ProjectDTO = { ...project, reference: { fileName: "2026 계획서.hwp", changes: "연도 2027, 30개사" } };
    for (const stage of ["research", "plan", "notice", "press"] as const) {
      const p = buildStagePrompt({ stage, project: withRef, workspaceDir: ws });
      expect(p.prompt).toContain(`${ws}/reference/base-plan.md`);
      expect(p.prompt).toContain("연도 2027, 30개사");
    }
    expect(buildStagePrompt({ stage: "research", project: withRef, workspaceDir: ws }).prompt).toContain("바뀌는 내용과 관련된 최신 근거");
    expect(buildStagePrompt({ stage: "plan", project: withRef, workspaceDir: ws }).prompt).toContain("골격");
  });
});

describe("official 단계 프롬프트", () => {
  const p = buildStagePrompt({
    stage: "official",
    project: { id: "x", kind: "official", title: "t", topic: "제출 요청", region: "경상북도", organizer: "(재)경상북도경제진흥원", contact: { 부서명: "전략기획팀", 전화: "054-470-8527", 이메일: "a@gepa.kr" }, createdAt: "", updatedAt: "" },
    workspaceDir: "/tmp",
  });
  it("공문서 작성자를 부르고 시행번호를 만들지 말라고 지시한다", () => {
    expect(p.systemPromptAppend).toContain("공문서");
    expect(p.systemPromptAppend + p.prompt).toMatch(/시행번호|일련번호/);
  });
});
