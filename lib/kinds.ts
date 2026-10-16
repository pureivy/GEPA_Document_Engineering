/**
 * 문서 종류. 프로젝트는 종류를 하나 갖고, 화면에 보이는 단계 목록은 여기서 파생된다.
 * program 만 연쇄(research→plan→notice→press)이고 나머지는 단일 단계다.
 * `review` 는 어느 kind 의 단계 목록에도 없다 — 문서 단계에 덧붙는 별도 실행이다.
 */
import type { Stage } from "./contracts";

export type ProjectKind = "program" | "official" | "report" | "closeout";
export const PROJECT_KINDS: ProjectKind[] = ["program", "official", "report", "closeout"];
export const KIND_LABEL: Record<ProjectKind, string> = { program: "사업", official: "공문", report: "업무보고", closeout: "결과·정산" };
export const KIND_STAGES: Record<ProjectKind, Stage[]> = {
  program: ["research", "plan", "notice", "press"],
  official: ["official"],
  report: ["report"],
  // 사업이 끝난 뒤: 자료(엑셀)를 원장으로 옮기고 → 내부 결과보고 → 위탁기관 서식 정산보고 → 둘을 붙여 보내는 공문.
  // 실문서의 결재 순서와 같다(docs/design-system/closeout-result.md §1: 내부 보고 A형을 먼저 올리고 B형 공문에 붙인다).
  closeout: ["ledger", "result", "settlement", "submit"],
};
export function stagesOf(kind: ProjectKind): Stage[] {
  return KIND_STAGES[kind];
}
export function isProjectKind(v: unknown): v is ProjectKind {
  return typeof v === "string" && (PROJECT_KINDS as string[]).includes(v);
}
