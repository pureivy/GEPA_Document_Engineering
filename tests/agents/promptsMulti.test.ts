/**
 * 참고 문서가 여럿일 때의 프롬프트 — "(원본 파일 …)" 에 전부 나열하고 건수를 단다.
 * 파일이 하나면(fileNames 가 있어도) 예전 문구 그대로여야 한다(얼어붙은 세 family).
 */
import { describe, it, expect } from "vitest";
import { buildStagePrompt } from "../../lib/agents/prompts";
import type { ProjectDTO } from "../../lib/contracts";

const base: ProjectDTO = {
  id: "p1",
  kind: "program",
  title: "2027년 안동시 수출기업 역량강화 지원사업",
  topic: "안동시 수출기업 30개사 지원",
  region: "안동시",
  organizer: "(재)경상북도경제진흥원",
  contact: { 부서명: "북부지소", 전화: "054-900-3801", 이메일: "gepa_north@naver.com" },
  createdAt: "2026-11-09T00:00:00Z",
  updatedAt: "2026-11-09T00:00:00Z",
};
const ws = "/tmp/ws";

describe("buildStagePrompt — 참고 문서 여러 개", () => {
  it("사업: 파일이 하나면 fileNames 가 있어도 예전 문구 그대로다", () => {
    const one: ProjectDTO = { ...base, reference: { fileName: "2026 계획서.hwp", fileNames: ["2026 계획서.hwp"], changes: "연도 2027" } };
    const p = buildStagePrompt({ stage: "plan", project: one, workspaceDir: ws }).prompt;
    expect(p).toContain(`기존 사업계획서: ${ws}/reference/base-plan.md (원본 파일 2026 계획서.hwp) — 이번 프로젝트는 이 계획서를 갱신하는 것이다.`);
    expect(p).not.toContain("첫 파일이 기존 사업계획서");
  });

  it("사업: 여럿이면 전부 나열하고 건수를 달며, 첫 파일이 계획서임을 덧붙인다", () => {
    const multi: ProjectDTO = { ...base, reference: { fileName: "2026 계획서.hwp", fileNames: ["2026 계획서.hwp", "결과보고.pdf"], changes: "연도 2027" } };
    for (const stage of ["research", "plan", "notice", "press"] as const) {
      const p = buildStagePrompt({ stage, project: multi, workspaceDir: ws }).prompt;
      expect(p, stage).toContain("(원본 파일 2026 계획서.hwp, 결과보고.pdf — 2건)");
      expect(p, stage).toContain("첫 파일이 기존 사업계획서이고 나머지는 함께 올린 참고 문서다");
      expect(p, stage).toContain("이번에 바뀌는 내용: 연도 2027");
    }
  });

  it("공문·업무보고: 용도 줄에 모든 파일을 싣는다", () => {
    const official: ProjectDTO = {
      ...base,
      kind: "official",
      contact: { ...base.contact, 수신유형: "수신자", 수신: "경상북도지사", 참고문서용도: "받은공문" },
      reference: { fileName: "공문.hwpx", fileNames: ["공문.hwpx", "첨부.pdf"], changes: "회신" },
    };
    const p = buildStagePrompt({ stage: "official", project: official, workspaceDir: ws }).prompt;
    expect(p).toMatch(/^참고 문서\(용도: 받은공문\): \/tmp\/ws\/reference\/base-plan\.md \(원본 파일 공문\.hwpx, 첨부\.pdf — 2건\)$/m);

    const report: ProjectDTO = { ...base, kind: "report", reference: { fileName: "a.hwp", fileNames: ["a.hwp", "b.hwp", "c.hwp"], changes: "" } };
    const q = buildStagePrompt({ stage: "report", project: report, workspaceDir: ws }).prompt;
    expect(q).toContain("참고 문서: /tmp/ws/reference/base-plan.md (원본 파일 a.hwp, b.hwp, c.hwp — 3건)");
    expect(q).not.toContain("기존 사업계획서");
  });
});
