/**
 * 반영 장부(docs/반영-장부.md)의 결과보고 지시 규칙이 지시문·스킬에서 빠지거나, 폐기한 방향이 되살아나지 않는지 지킨다.
 * 규칙 문구를 고치면 이 시험도 함께 고친다 — 장부의 그 줄도 함께 본다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildStagePrompt } from "../../lib/agents/prompts";
import type { ProjectDTO } from "../../lib/contracts";

const ws = "/ws";
const base: ProjectDTO = {
  id: "c1",
  kind: "closeout",
  title: "2026년 시험 사업",
  topic: "사업 종료 후 결과보고",
  region: "",
  organizer: "(재)경상북도경제진흥원",
  contact: { 부서명: "전략기획팀", 전화: "054-000-0000", 이메일: "a@gepa.kr", 사업구분: "수탁" },
  createdAt: "",
  updatedAt: "",
};
const self: ProjectDTO = { ...base, contact: { ...base.contact, 사업구분: "자체" } };
const resultPrompt = (p: ProjectDTO) => buildStagePrompt({ stage: "result", project: p, workspaceDir: ws }).prompt;
const SKILL = readFileSync(join(__dirname, "../../agent/.claude/skills/gepa-closeout-design/SKILL.md"), "utf8");

describe("반영 장부 — 결과보고 지시 규칙", () => {
  it("C1·G3 계획서 골격을 낱말·위계·순서 그대로, 두 축을 모두", () => {
    const p = resultPrompt(base);
    expect(p).toContain("낱말·위계·순서를 바꾸지 않고");
    expect(p).toContain("두 축");
  });
  it("C7 성과 분석 메모를 먼저 읽고 결과보고서 내용의 기준으로 삼는다", () => {
    expect(resultPrompt(base)).toContain("analysis/notes.md(성과 분석 메모 — 담당자가 검토한 것)를 먼저 읽는다");
  });
  it("C5 하지 않은 회차·세부사업은 절을 만들지 않는다", () => {
    expect(resultPrompt(base)).toContain("하지 않은 회차·세부사업은 절을 만들지 않는다");
  });
  it("T5 견주는 내용은 표로 — 스킬 §2-2", () => {
    expect(SKILL).toContain("### 2-2. 표로 보여 줄 것 — 줄글로 늘어놓지 않는다");
  });
  it("C3 자체사업 예산 절은 요약만 — 건별 집행내역을 넣지 않는다", () => {
    expect(resultPrompt(self)).toContain("건별 집행내역({{정산:집행현황}}·{{정산:세부내역}})은 넣지 않는다");
    expect(SKILL).toContain("건별 집행내역은 넣지 않는다");
  });
});

describe("반영 장부 — 폐기한 방향이 되살아나지 않는다", () => {
  it("X1 자체사업 결과보고서에 건별 집행 세부내역을 녹이라는 지시가 없다", () => {
    for (const text of [resultPrompt(self), SKILL]) {
      expect(text).not.toMatch(/집행 세부내역[^\n]{0,30}(녹인다|녹여)/);
      expect(text).not.toMatch(/(녹인다|녹여)[^\n]{0,30}집행 세부내역/);
    }
  });
  it("X3 결과보고서 Ⅰ 에 「※ 근거: 문서번호」 줄을 두라는 지시가 없다", () => {
    const p = resultPrompt(base);
    expect(p).toContain("문서번호는 본문에 쓰지 않는다");
    expect(p).not.toMatch(/※ 근거[^\n]{0,20}(한 줄|만 쓴다|를 둔다)/);
  });
  it("X7 공문에 받는 쪽 서식을 별지로 만들어 붙이지 않는다(10-01 결정, 11-16 머지)", () => {
    const root = join(__dirname, "../..");
    const read = (f: string) => readFileSync(join(root, f), "utf8");
    expect(read("components/pipeline/ProjectList.tsx")).not.toContain("(붙임 서식)");
    expect(read("agent/.claude/agents/official-writer.md")).toContain("서식을 별지로 만들어 본문 뒤에 쓰지 않는다");
    const skill = read("agent/.claude/skills/gepa-official-design/SKILL.md");
    expect(skill).toContain("### 서식(별지)은 만들지 않는다");
    expect(skill).not.toContain("제출·회신을 요구하면 서식을 별지로 붙인다");
  });
  it("X4 프롬프트에 지역 줄이 없다(옛 region 값도 싣지 않는다)", () => {
    const old = { ...base, kind: "program" as const, region: "안동시" };
    for (const stage of ["research", "plan", "notice", "press"] as const) {
      expect(buildStagePrompt({ stage, project: old, workspaceDir: ws }).prompt).not.toContain("지역: 안동시");
    }
  });
});
