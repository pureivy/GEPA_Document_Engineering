/**
 * 화면이 프로젝트 종류에서 단계를 파생하는지 — 탭 개수, 라벨, 그리고 자동연쇄의 다음 단계.
 * 이 파일이 지키는 약속: 공문 프로젝트에는 이어질 단계가 없다(연쇄도 "다음 단계" 안내도 없다).
 */
import { describe, expect, it } from "vitest";
import { stagesOf } from "../../lib/kinds";
import { STAGE_LABEL } from "../../lib/contracts";
import { nextStage } from "../../lib/stages/runIntegration";

describe("kind 별 화면 단계", () => {
  it("공문 프로젝트는 탭이 하나뿐이다", () => {
    const stages = stagesOf("official");
    expect(stages).toHaveLength(1);
    expect(STAGE_LABEL[stages[0]]).toBe("공문서");
  });
  it("사업 프로젝트는 탭이 넷이다", () => {
    expect(stagesOf("program")).toHaveLength(4);
  });
  it("모든 단계에 라벨이 있다", () => {
    for (const kind of ["program", "official"] as const) {
      for (const s of stagesOf(kind)) expect(STAGE_LABEL[s]).toBeTruthy();
    }
  });
  it("공문 단계는 사업 프로젝트의 탭에 없다 — 5번째 카드가 뜨면 안 된다", () => {
    expect(stagesOf("program")).not.toContain("official");
  });
});

describe("자동연쇄의 다음 단계", () => {
  it("사업은 기존 순서대로 이어진다", () => {
    expect(nextStage("research", "program")).toBe("plan");
    expect(nextStage("plan", "program")).toBe("notice");
    expect(nextStage("notice", "program")).toBe("press");
    expect(nextStage("press", "program")).toBeNull();
  });
  it("공문은 어디서도 이어지지 않는다 — 단일 단계라 연쇄가 돌면 안 된다", () => {
    expect(nextStage("official", "official")).toBeNull();
  });
  it("검토(review)는 어느 종류에서도 다음 단계가 없다", () => {
    expect(nextStage("review", "program")).toBeNull();
    expect(nextStage("review", "official")).toBeNull();
  });
});
