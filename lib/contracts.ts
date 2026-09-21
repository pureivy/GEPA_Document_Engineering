/**
 * Client ⇄ server contracts shared by the API routes and the browser UI.
 * (Kept dependency-free so both sides can import it.)
 */
import type { Block, DocModel, Family } from "./docmodel/schema";

/** 문서·파이프라인 단계 — 화면에 탭으로 보이는 것들 */
export type Stage = "research" | "plan" | "notice" | "press" | "official";
export const STAGES: Stage[] = ["research", "plan", "notice", "press", "official"];
export const STAGE_LABEL: Record<Stage, string> = { research: "조사", plan: "사업계획서", notice: "공고문", press: "보도자료", official: "공문서" };
export const STAGE_FAMILY: Partial<Record<Stage, Family>> = { plan: "plan", notice: "notice", press: "press", official: "official" };

/** 실행 단위 — 문서 단계에 덧붙는 검토(review)를 포함한다. 어느 kind 의 탭에도 나오지 않는다. */
export type RunStage = Stage | "review";
export const RUN_STAGES: RunStage[] = [...STAGES, "review"];
export function isRunStage(v: unknown): v is RunStage {
  return typeof v === "string" && (RUN_STAGES as string[]).includes(v);
}

/**
 * 문서를 만들어 내는 단계인가 — 실시간 타이핑·doc.json 저장·HWPX 내보내기가 이 판정에 달려 있다.
 * STAGE_FAMILY 를 진실의 출처로 삼는다. 단계 이름을 손으로 나열하면 새 단계가 조용히 빠지고,
 * 그때 아무 오류도 나지 않는다(예전 runIntegration.ts 의 지역 상수가 그랬다).
 */
export function isDocStage(stage: string): boolean {
  return Object.hasOwn(STAGE_FAMILY, stage) && STAGE_FAMILY[stage as Stage] !== undefined;
}

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface ProjectDTO {
  id: string;
  title: string;
  topic: string;
  region: string;
  organizer: string;
  contact: { 부서명: string; 담당자?: string; 전화: string; 이메일: string; 우편주소?: string };
  /** uploaded 기존 사업계획서 (projects/<id>/reference/<fileName>, text in reference/base-plan.md) and what changes */
  reference?: { fileName: string; changes: string };
  createdAt: string;
  updatedAt: string;
}

export interface RunDTO {
  id: string;
  projectId: string;
  stage: Stage | "review";
  sessionId: string | null;
  status: RunStatus;
  model: string;
  startedAt: string;
  endedAt: string | null;
  numTurns: number | null;
  costUsd: number | null;
  error: string | null;
}

/** Events the DSL streaming parser produces while the agent types the document. */
export type DocEvent =
  /** a document stream starts; `rewrite` = the agent writes the file again in the same run (seq ≥ 2) */
  | { type: "doc.open"; stage?: string; seq?: number; rewrite?: boolean }
  | { type: "meta"; family: Family; meta: DocModel["meta"] }
  | { type: "block.open"; block: Block }
  | { type: "text.delta"; blockId: string; text: string }
  | { type: "block.upsert"; block: Block }
  | { type: "block.commit"; block: Block }
  /** the stream that `doc.open` started is complete (the Write finished / DOC>>> seen) */
  | { type: "doc.close"; seq?: number }
  | { type: "doc.final"; doc: DocModel };

/** Agent activity events (mirrors lib/agents/runner.ts AgentEvent, serialized). */
export type AgentActivityEvent =
  | { type: "init"; sessionId: string; model: string; tools: string[] }
  | { type: "text.delta"; text: string; parentToolUseId?: string | null }
  | { type: "assistant.text"; text: string; parentToolUseId?: string | null }
  | { type: "tool.start"; toolUseId: string; name: string; input?: unknown; parentToolUseId?: string | null }
  | { type: "tool.input.delta"; toolUseId: string; json: string }
  | { type: "tool.input"; toolUseId: string; name: string; input: unknown; parentToolUseId?: string | null }
  | { type: "tool.result"; toolUseId: string; name?: string; content: string; isError: boolean; parentToolUseId?: string | null }
  | { type: "subagent.start"; toolUseId: string; agent: string; description: string }
  | { type: "subagent.end"; toolUseId: string }
  | { type: "thinking"; text: string }
  | { type: "result"; ok: boolean; costUsd?: number; turns?: number; durationMs?: number; structured?: unknown; error?: string }
  | { type: "stderr"; text: string }
  | { type: "error"; message: string; hint?: string };

/** One SSE frame: `id: <seq>` `event: <kind>` `data: <json>` */
export type SseFrame =
  | { seq: number; kind: "agent"; data: AgentActivityEvent }
  | { seq: number; kind: "doc"; data: DocEvent }
  | { seq: number; kind: "run"; data: { status: RunStatus; error?: string } };

export interface ExportReportDTO {
  ok: boolean;
  pageCount: number;
  contentLossCount: number | null;
  appendedStyles: number;
  warnings: string[];
  errors: string[];
  builtAt: string;
  hash: string;
}
