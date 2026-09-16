/**
 * Per-stage execution limits.
 *
 * Runs use the user's Claude subscription through the local CLI, so there is no dollar budget:
 * we never pass `--max-budget-usd`. `total_cost_usd` from the CLI is recorded for reference only.
 */
import type { Stage } from "./runner";

export interface StageLimits {
  maxTurns: number;
  wallTimeoutMs: number;
  idleTimeoutMs: number;
}

const MIN = 60_000;

/** no stream-json output at all for this long (a WebFetch or a long subagent turn can be quiet for minutes) */
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/**
 * Wall limits are sized from real runs on 2026-09-15 (opus): research 17–20 min with three
 * researcher subagents, plan 18 min, notice 11 min, press 7 min, review 8 min.
 */
export const STAGE_LIMITS: Record<Stage, StageLimits> = {
  research: { maxTurns: 45, wallTimeoutMs: 35 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  plan: { maxTurns: 40, wallTimeoutMs: 30 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  notice: { maxTurns: 30, wallTimeoutMs: 25 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  press: { maxTurns: 20, wallTimeoutMs: 15 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  review: { maxTurns: 15, wallTimeoutMs: 15 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
};

/** Default tool allow-lists per stage (see docs/architecture.md §D.2). */
export const STAGE_ALLOWED_TOOLS: Record<Stage, string[]> = {
  research: ["WebSearch", "WebFetch", "Read", "Write", "Edit", "Glob", "Grep", "Task"],
  plan: ["Read", "Write", "Glob", "Grep"], // 2026-09-16: no 보충 조사 in the plan stage (the 28-min plan run spent most of its time on it)
  notice: ["Read", "Write"],
  press: ["Read", "Write"],
  review: ["Read"],
};

export const DEFAULT_MODEL = "opus";

/** CLI model aliases a run may use (`claude --model <alias>`); full model ids are accepted via env only. */
export const MODEL_ALIASES = ["opus", "sonnet", "haiku"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];
export function isModelAlias(v: unknown): v is ModelAlias {
  return typeof v === "string" && (MODEL_ALIASES as readonly string[]).includes(v);
}

/**
 * Per-stage default model — hybrid since 2026-09-16: the judgement-heavy stages (research
 * synthesis, the 13-page plan) stay on opus; template-driven ones (notice/press fill the 6-1
 * skeleton, review is a checklist with a JSON schema) run on sonnet, which consumes the
 * subscription's usage limit far more slowly. The `researcher` subagent (bulk WebFetch, the
 * largest token sink) is set to sonnet in agent/.claude/agents/researcher.md.
 */
export const STAGE_MODELS: Record<Stage, ModelAlias> = {
  research: "opus",
  plan: "opus",
  notice: "sonnet",
  press: "sonnet",
  review: "sonnet",
};

/**
 * Model for a stage run. Precedence: explicit per-run override (API body) → `GEPA_MODEL_<STAGE>`
 * → `GEPA_MODEL` → STAGE_MODELS. Env values are passed to the CLI verbatim (alias or model id).
 */
export function modelFor(stage: Stage, override?: string | null, env: Record<string, string | undefined> = process.env): string {
  const pick = (v: string | undefined | null) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return pick(override) ?? pick(env[`GEPA_MODEL_${stage.toUpperCase()}`]) ?? pick(env.GEPA_MODEL) ?? STAGE_MODELS[stage];
}

/** Grace period between SIGTERM and SIGKILL when killing a run. */
export const KILL_GRACE_MS = 5_000;

export function limitsFor(stage: Stage, overrides?: Partial<StageLimits>): StageLimits {
  const out = { ...STAGE_LIMITS[stage] };
  // an explicit `undefined` in overrides must not erase the default (spreading would)
  for (const k of ["maxTurns", "wallTimeoutMs", "idleTimeoutMs"] as const) {
    const v = overrides?.[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
