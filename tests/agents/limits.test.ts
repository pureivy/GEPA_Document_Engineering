import { describe, it, expect } from "vitest";
import { isModelAlias, limitsFor, modelFor, STAGE_LIMITS, STAGE_MODELS } from "../../lib/agents/limits";

describe("limitsFor", () => {
  it("keeps the stage defaults when an override is undefined (runManager passes spec fields verbatim)", () => {
    const l = limitsFor("research", { maxTurns: 40, wallTimeoutMs: undefined, idleTimeoutMs: undefined });
    expect(l.maxTurns).toBe(40);
    expect(l.wallTimeoutMs).toBe(STAGE_LIMITS.research.wallTimeoutMs);
    expect(l.idleTimeoutMs).toBe(STAGE_LIMITS.research.idleTimeoutMs);
    expect(l.wallTimeoutMs).toBeGreaterThan(0);
  });
  it("applies numeric overrides", () => {
    expect(limitsFor("press", { wallTimeoutMs: 1234 }).wallTimeoutMs).toBe(1234);
  });
});

describe("modelFor", () => {
  it("uses the hybrid stage defaults when nothing overrides them", () => {
    const env: Record<string, string | undefined> = {};
    expect(modelFor("research", undefined, env)).toBe("opus");
    expect(modelFor("plan", undefined, env)).toBe("opus");
    expect(modelFor("notice", undefined, env)).toBe("sonnet");
    expect(modelFor("press", undefined, env)).toBe("sonnet");
    expect(modelFor("review", undefined, env)).toBe("sonnet");
    for (const s of Object.keys(STAGE_MODELS)) expect(isModelAlias(STAGE_MODELS[s as keyof typeof STAGE_MODELS])).toBe(true);
  });
  it("prefers the per-run override, then GEPA_MODEL_<STAGE>, then GEPA_MODEL", () => {
    const env = { GEPA_MODEL: "haiku", GEPA_MODEL_PLAN: "claude-opus-5" };
    expect(modelFor("plan", "sonnet", env)).toBe("sonnet");
    expect(modelFor("plan", undefined, env)).toBe("claude-opus-5");
    expect(modelFor("notice", undefined, env)).toBe("haiku");
    expect(modelFor("notice", "  ", env)).toBe("haiku"); // blank override is ignored
    expect(modelFor("notice", null, { GEPA_MODEL: " " })).toBe("sonnet");
  });
});
