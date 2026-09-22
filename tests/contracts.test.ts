import { describe, expect, it } from "vitest";
import { isDocStage, isRunStage, RUN_STAGES, STAGE_FAMILY, STAGES } from "../lib/contracts";

describe("isDocStage", () => {
  it("is true for exactly the stages that map to a family", () => {
    expect(isDocStage("plan")).toBe(true);
    expect(isDocStage("notice")).toBe(true);
    expect(isDocStage("press")).toBe(true);
    expect(isDocStage("research")).toBe(false);
    expect(isDocStage("review")).toBe(false);
    expect(isDocStage("없는단계")).toBe(false);
  });

  it("tracks STAGE_FAMILY rather than a hand-written list", () => {
    for (const stage of Object.keys(STAGE_FAMILY)) {
      expect(isDocStage(stage), stage).toBe(true);
    }
    for (const stage of STAGES) {
      expect(isDocStage(stage), stage).toBe(STAGE_FAMILY[stage] !== undefined);
    }
  });

  it("does not treat inherited Object.prototype keys as stages", () => {
    expect(isDocStage("toString")).toBe(false);
    expect(isDocStage("constructor")).toBe(false);
    expect(isDocStage("__proto__")).toBe(false);
    expect(isDocStage("hasOwnProperty")).toBe(false);
  });
});

describe("RunStage", () => {
  it("adds review on top of the document/pipeline stages", () => {
    expect(RUN_STAGES).toEqual([...STAGES, "review"]);
  });

  it("isRunStage accepts every doc stage and review, rejects garbage", () => {
    for (const s of STAGES) expect(isRunStage(s)).toBe(true);
    expect(isRunStage("review")).toBe(true);
    expect(isRunStage("없는단계")).toBe(false);
  });
});
