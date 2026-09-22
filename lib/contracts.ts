/**
 * Client ⇄ server contracts shared by the API routes and the browser UI.
 * (Kept dependency-free so both sides can import it.)
 */
import type { Block, DocModel, Family, OfficialMeta } from "./docmodel/schema";
import type { ProjectKind } from "./kinds";

/** 문서·파이프라인 단계 — 화면에 탭으로 보이는 것들 */
export type Stage = "research" | "plan" | "notice" | "press" | "official" | "report";
export const STAGES: Stage[] = ["research", "plan", "notice", "press", "official", "report"];
export const STAGE_LABEL: Record<Stage, string> = { research: "조사", plan: "사업계획서", notice: "공고문", press: "보도자료", official: "공문서", report: "업무보고서" };
export const STAGE_FAMILY: Partial<Record<Stage, Family>> = { plan: "plan", notice: "notice", press: "press", official: "official", report: "report" };

/** 공문에 붙인 참고 문서의 용도 — 에이전트에게 줄 지시가 이 값에 따라 갈린다 */
export const REFERENCE_ROLES = ["근거자료", "받은공문", "붙임"] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];
/**
 * 용도별로 reference.changes 칸이 무엇을 담는지 — 폼의 label 과 프롬프트에 싣는 줄 이름이
 * 같아야 한다(다르면 담당자가 적은 것과 에이전트가 읽는 것의 이름이 갈린다). 그래서 한 벌만 둔다.
 */
export const REFERENCE_CHANGES_LABEL: Record<ReferenceRole, string> = {
  근거자료: "이 문서에서 쓸 내용",
  받은공문: "회신 취지",
  붙임: "붙임에 적을 이름",
};
/**
 * 용도별로 붙인 파일을 뭐라고 부를지 — 에이전트가 **실제로 읽는 파일**(reference/base-plan.md)의
 * 제목이 된다. 프롬프트만 고치면 모자란다: 그 파일이 스스로를 "기존 사업계획서"라고 소개하면
 * 에이전트는 붙임 서식을 갱신할 계획서로 읽는다.
 */
export const REFERENCE_DOC_TITLE: Record<ReferenceRole, string> = {
  근거자료: "참고 문서",
  받은공문: "받은 공문",
  붙임: "붙임 문서",
};

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
  /** 문서 종류 — 화면에 보이는 단계 목록이 여기서 파생된다 (lib/kinds.ts stagesOf) */
  kind: ProjectKind;
  title: string;
  topic: string;
  region: string;
  organizer: string;
  contact: {
    부서명: string;
    담당자?: string;
    전화: string;
    /** 결문 연락처의 전송(팩스) — OfficialMetaSchema.연락처.전송 과 같은 값 */
    전송?: string;
    이메일: string;
    우편주소?: string;
    /** 결문 연락처의 우편번호 — OfficialMetaSchema.연락처.우편번호 과 같은 값(우편주소 옆의 다섯 자리) */
    우편번호?: string;
    /** 공문(official) 전용 — OfficialMetaSchema 의 같은 이름 필드와 값이 같다(program 프로젝트는 쓰지 않는다) */
    수신유형?: OfficialMeta["수신유형"];
    /** 수신유형=수신자 일 때의 수신 대상 */
    수신?: string;
    /** 수신유형=수신자참조 일 때의 수신자 목록 — 쉼표로 구분한 문자열(배열로 바꾸는 것은 에이전트의 몫) */
    수신자?: string;
    /** 공문(official) 전용 — 결재란과 발신명의를 함께 정하는 전결 단계(OfficialMetaSchema.전결과 같은 값) */
    전결?: OfficialMeta["전결"];
    /** 공문(official) 전용 — 붙인 참고 문서의 용도. 값이 있으면 reference 도 있다 */
    참고문서용도?: ReferenceRole;
  };
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
