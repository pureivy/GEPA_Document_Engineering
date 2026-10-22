/**
 * Per-stage execution limits.
 *
 * Runs use the user's Claude subscription through the local CLI, so there is no dollar budget:
 * we never pass `--max-budget-usd`. `total_cost_usd` from the CLI is recorded for reference only.
 */
import type { RunStage } from "./runner";

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
export const STAGE_LIMITS: Record<RunStage, StageLimits> = {
  research: { maxTurns: 45, wallTimeoutMs: 35 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  plan: { maxTurns: 40, wallTimeoutMs: 30 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  notice: { maxTurns: 30, wallTimeoutMs: 25 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  press: { maxTurns: 20, wallTimeoutMs: 15 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  official: { maxTurns: 20, wallTimeoutMs: 15 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  // 업무보고는 참고본 골격을 채우는 일이라 공문서와 같은 크기로 둔다(실측 전 잠정값)
  report: { maxTurns: 20, wallTimeoutMs: 15 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  // 정산자료는 엑셀 여러 장을 읽어 건별로 옮긴다 — 통장내역이 길면 턴이 많이 든다(실측 전 잠정값)
  // 집계표 없이 지급 공문 PDF 30여 건만 올리는 경우가 실제로 있다(2026-10-02) — 건마다 Read 가 필요하다
  ledger: { maxTurns: 80, wallTimeoutMs: 45 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  // 성과 분석은 자료 전부와 홈페이지 글을 다시 읽고 메모를 쓴다(실측 전 잠정값)
  analysis: { maxTurns: 50, wallTimeoutMs: 30 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  result: { maxTurns: 30, wallTimeoutMs: 25 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  settlement: { maxTurns: 25, wallTimeoutMs: 20 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  submit: { maxTurns: 20, wallTimeoutMs: 15 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
  review: { maxTurns: 15, wallTimeoutMs: 15 * MIN, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS },
};

/** Default tool allow-lists per stage (see docs/architecture.md §D.2). */
export const STAGE_ALLOWED_TOOLS: Record<RunStage, string[]> = {
  research: ["WebSearch", "WebFetch", "Read", "Write", "Edit", "Glob", "Grep", "Task"],
  plan: ["Read", "Write", "Glob", "Grep"], // 2026-09-16: no 보충 조사 in the plan stage (the 28-min plan run spent most of its time on it)
  notice: ["Read", "Write"],
  press: ["Read", "Write"],
  // 공문서는 사람이 사실을 이미 아는 사무 문서다. 조사 도구를 주지 않는다
  official: ["Read", "Write"],
  // 업무보고도 사람이 실적·계획을 이미 아는 문서다 — 조사 도구를 주지 않는다
  report: ["Read", "Write"],
  // 정산·결과보고는 올린 자료만 근거로 쓴다 — 조사 도구를 주지 않는다. 자료가 여러 개라 Glob·Grep 은 준다
  ledger: ["Read", "Write", "Edit", "Glob", "Grep"],
  // 성과 분석은 메모를 Edit 로 고친다. 홈페이지 자료는 플랫폼이 미리 내려받아 두므로 웹 도구는 주지 않는다
  analysis: ["Read", "Write", "Edit", "Glob", "Grep"],
  result: ["Read", "Write", "Glob", "Grep"],
  settlement: ["Read", "Write", "Glob", "Grep"],
  submit: ["Read", "Write", "Glob", "Grep"],
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
export const STAGE_MODELS: Record<RunStage, ModelAlias> = {
  research: "opus",
  plan: "opus",
  notice: "sonnet",
  press: "sonnet",
  official: "sonnet",
  report: "sonnet",
  // 원장 옮기기는 양식이 제각각인 엑셀의 열을 판단하는 일이라 opus, 결과보고서도 서술이 길어 opus.
  // 정산보고서·공문은 숫자가 매크로로 들어가고 골격이 정해져 있어 sonnet 으로 충분하다.
  ledger: "opus",
  // 무엇을 성과로 볼지 판단하는 단계라 opus
  analysis: "opus",
  result: "opus",
  settlement: "sonnet",
  submit: "sonnet",
  review: "sonnet",
};

/**
 * Model for a stage run. Precedence: explicit per-run override (API body) → `GEPA_MODEL_<STAGE>`
 * → `GEPA_MODEL` → STAGE_MODELS. Env values are passed to the CLI verbatim (alias or model id).
 */
export function modelFor(stage: RunStage, override?: string | null, env: Record<string, string | undefined> = process.env): string {
  const pick = (v: string | undefined | null) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return pick(override) ?? pick(env[`GEPA_MODEL_${stage.toUpperCase()}`]) ?? pick(env.GEPA_MODEL) ?? STAGE_MODELS[stage];
}

/** Grace period between SIGTERM and SIGKILL when killing a run. */
export const KILL_GRACE_MS = 5_000;

export function limitsFor(stage: RunStage, overrides?: Partial<StageLimits>): StageLimits {
  const out = { ...STAGE_LIMITS[stage] };
  // an explicit `undefined` in overrides must not erase the default (spreading would)
  for (const k of ["maxTurns", "wallTimeoutMs", "idleTimeoutMs"] as const) {
    const v = overrides?.[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
