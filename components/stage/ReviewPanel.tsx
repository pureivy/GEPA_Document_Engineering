"use client";
/**
 * ReviewPanel — the "검토" strip under the editor: starts a reviewer run on the current stage's
 * document, lists the structured issues (severity · message · suggested DSL fix) and offers
 * "자동 수정" which resumes the writer session with the issues as the instruction.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ClipboardCheck, Wand2 } from "lucide-react";
import type { RunStatus } from "@/lib/contracts";
import { fixableIssues, sortIssues, type ReviewResult, type ReviewSeverity } from "@/lib/client/review";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { cn } from "@/lib/client/format";

const SEV_TONE: Record<ReviewSeverity, BadgeTone> = { error: "danger", warn: "warning", info: "info" };
const SEV_LABEL: Record<ReviewSeverity, string> = { error: "오류", warn: "주의", info: "참고" };

export interface ReviewPanelProps {
  /** a document exists to review */
  hasDoc: boolean;
  /** the writer run for this stage is active (review is disabled meanwhile) */
  writerRunning: boolean;
  reviewing: boolean;
  reviewStatus: RunStatus | null;
  reviewTurns: number | null;
  result: ReviewResult | null;
  /** the document changed after this review (edit, restore, new run): score no longer applies */
  stale?: boolean;
  error: string | null;
  busy: boolean;
  onReview: () => void;
  onAutoFix: () => void;
}

function scoreTone(score: number): BadgeTone {
  if (score >= 85) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export function ReviewPanel(p: ReviewPanelProps) {
  const [open, setOpen] = useState(true);
  const issues = useMemo(() => (p.result ? sortIssues(p.result.issues) : []), [p.result]);
  const fixable = useMemo(() => (p.result ? fixableIssues(p.result.issues) : []), [p.result]);
  const counts = useMemo(() => {
    const c: Record<ReviewSeverity, number> = { error: 0, warn: 0, info: 0 };
    for (const i of issues) c[i.severity]++;
    return c;
  }, [issues]);
  const disabled = !p.hasDoc || p.writerRunning || p.reviewing || p.busy;

  return (
    <div className="border-t border-slate-200 bg-white text-xs">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <Button size="sm" variant="outline" disabled={disabled} onClick={p.onReview} title={p.hasDoc ? "검토관 에이전트가 문서를 점검합니다 (골격·글머리·고정문구·수치·공문 표기)" : "검토할 문서가 없습니다"}>
          <ClipboardCheck className="h-3.5 w-3.5" /> 검토
        </Button>
        {p.reviewing ? (
          <span className="flex items-center gap-1.5 text-slate-600">
            <Spinner className="h-3 w-3" /> 검토 중…{p.reviewTurns !== null ? ` 턴 ${p.reviewTurns}` : ""}
          </span>
        ) : null}
        {p.result && !p.reviewing ? (
          <>
            <Badge tone={p.stale ? "neutral" : scoreTone(p.result.score)}>점수 {p.result.score}</Badge>
            <span className="text-slate-600">
              오류 {counts.error} · 주의 {counts.warn} · 참고 {counts.info}
            </span>
            {p.stale ? <Badge tone="warning">문서가 바뀜 · 다시 검토 필요</Badge> : null}
            <Button size="sm" variant="primary" disabled={fixable.length === 0 || p.writerRunning || p.busy || !!p.stale} onClick={p.onAutoFix} title={p.stale ? "문서가 바뀌었습니다. 다시 검토한 뒤 자동 수정할 수 있습니다" : "오류·주의 항목을 작성자 세션에 전달해 문서를 고칩니다 (이어서 수정 요청)"}>
              <Wand2 className="h-3.5 w-3.5" /> 자동 수정 ({fixable.length}건)
            </Button>
            <button type="button" className="ml-auto flex items-center gap-1 text-slate-500 hover:text-slate-800" onClick={() => setOpen((o) => !o)}>
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />} {open ? "접기" : "펼치기"}
            </button>
          </>
        ) : null}
        {p.reviewStatus && p.reviewStatus !== "succeeded" && !p.reviewing ? <Badge tone="danger">검토 {p.reviewStatus === "failed" ? "실패" : "취소됨"}</Badge> : null}
        {p.error ? <span className="text-red-700">{p.error}</span> : null}
      </div>
      {p.result && open && !p.reviewing ? (
        <div className="max-h-56 overflow-auto border-t border-slate-100 px-3 py-2">
          {p.result.summary ? <p className="mb-2 text-slate-600">{p.result.summary}</p> : null}
          {issues.length === 0 ? (
            <p className="text-slate-500">지적 사항이 없습니다.</p>
          ) : (
            <ol className="space-y-1.5">
              {issues.map((i, n) => (
                <li key={n} className={cn("rounded border px-2 py-1.5", i.severity === "error" ? "border-red-200 bg-red-50/60" : i.severity === "warn" ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50")}>
                  <div className="flex items-start gap-2">
                    <Badge tone={SEV_TONE[i.severity]}>{SEV_LABEL[i.severity]}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-800">{i.message}</div>
                      {i.blockHint ? <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">위치: {i.blockHint}</div> : null}
                      {i.fix ? <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-white/80 p-1.5 font-mono text-[11px] text-slate-700">{i.fix}</pre> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
