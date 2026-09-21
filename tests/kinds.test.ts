import { describe, expect, it } from "vitest";
import { KIND_STAGES, stagesOf, type ProjectKind } from "../lib/kinds";
import { STAGE_FAMILY, isDocStage } from "../lib/contracts";

describe("stagesOf", () => {
  it("program 은 기존 4단계", () => {
    expect(stagesOf("program")).toEqual(["research", "plan", "notice", "press"]);
  });
  it("official 은 단일 단계", () => {
    expect(stagesOf("official")).toEqual(["official"]);
  });
  it("모든 kind 의 모든 단계는 알려진 단계다", () => {
    for (const kind of Object.keys(KIND_STAGES) as ProjectKind[]) {
      for (const s of stagesOf(kind)) expect(typeof s).toBe("string");
    }
  });
  it("official 단계는 문서 단계다 — 스트리밍·저장·내보내기가 켜져야 한다", () => {
    expect(STAGE_FAMILY.official).toBe("official");
    expect(isDocStage("official")).toBe(true);
  });
});
