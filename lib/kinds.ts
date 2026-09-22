/**
 * 문서 종류. 프로젝트는 종류를 하나 갖고, 화면에 보이는 단계 목록은 여기서 파생된다.
 * program 만 연쇄(research→plan→notice→press)이고 나머지는 단일 단계다.
 * `review` 는 어느 kind 의 단계 목록에도 없다 — 문서 단계에 덧붙는 별도 실행이다.
 */
import type { Stage } from "./contracts";

export type ProjectKind = "program" | "official";
export const PROJECT_KINDS: ProjectKind[] = ["program", "official"];
export const KIND_LABEL: Record<ProjectKind, string> = { program: "사업", official: "공문" };
export const KIND_STAGES: Record<ProjectKind, Stage[]> = {
  program: ["research", "plan", "notice", "press"],
  official: ["official"],
};
export function stagesOf(kind: ProjectKind): Stage[] {
  return KIND_STAGES[kind];
}
export function isProjectKind(v: unknown): v is ProjectKind {
  return typeof v === "string" && (PROJECT_KINDS as string[]).includes(v);
}
