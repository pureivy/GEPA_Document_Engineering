import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { RunStatus, Stage } from "@/lib/contracts";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "-";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}초`;
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}분 ${String(r).padStart(2, "0")}초`;
  return `${h}시간 ${m % 60}분`;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "-";
  return `$${usd.toFixed(2)}`;
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = { running: "실행 중", succeeded: "완료", failed: "실패", cancelled: "중지됨" };

export const STAGE_DESCRIPTION: Record<Stage, string> = {
  research: "주제·지역 통계와 유사 사업 사례를 조사해 근거 노트를 작성합니다.",
  plan: "조사 결과를 바탕으로 내부 결재용 사업계획(안)을 작성합니다.",
  notice: "사업계획서를 참여기업 모집 공고문(6-1 서식)으로 변환합니다.",
  press: "공고문과 사업계획서를 바탕으로 배포용 보도자료를 작성합니다.",
  official: "공문서를 작성합니다.",
  report: "부서별 추진실적과 계획을 주요업무보고로 작성합니다.",
};
