"use client";
import Link from "next/link";
import { ArrowRight, ClipboardList, Download, FileSearch, FileText, Mail, Megaphone, Newspaper } from "lucide-react";
import type { RunDTO, RunStatus, Stage } from "@/lib/contracts";
import { STAGE_LABEL } from "@/lib/contracts";
import { api } from "@/lib/client/api";
import { cn, formatCost, formatDateTime, formatDuration, RUN_STATUS_LABEL, STAGE_DESCRIPTION } from "@/lib/client/format";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const TONE: Record<RunStatus, BadgeTone> = { running: "running", succeeded: "success", failed: "danger", cancelled: "warning" };
const ICON: Record<Stage, React.ComponentType<{ className?: string }>> = { research: FileSearch, plan: FileText, notice: Megaphone, press: Newspaper, official: Mail, report: ClipboardList };

export interface StageCardProps {
  projectId: string;
  stage: Stage;
  /** 연쇄 단계 안에서의 자리(0-based). 단일 단계 종류에서는 null — 번호를 매기지 않는다 */
  index: number | null;
  latestRun: RunDTO | null;
  active: boolean;
  hasDoc: boolean | null;
  /** the previous stage has a result (this stage can be run meaningfully) */
  ready: boolean;
}

export function StageCard({ projectId, stage, index, latestRun, active, hasDoc, ready }: StageCardProps) {
  const Icon = ICON[stage];
  const status: RunStatus | null = active ? "running" : (latestRun?.status ?? null);
  const done = status === "succeeded" && hasDoc !== false;
  const href = `/projects/${projectId}/${stage}`;
  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-1 flex-col rounded-lg border bg-white p-4 transition-shadow hover:shadow-md",
        active ? "border-sky-400 ring-2 ring-sky-100" : done ? "border-emerald-300" : "border-slate-200",
      )}
    >
      <Link href={href} className="flex items-center gap-2">
        {index !== null ? (
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", done ? "bg-emerald-600 text-white" : active ? "bg-sky-600 text-white" : "bg-slate-200 text-slate-600")}>{index + 1}</span>
        ) : null}
        <Icon className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-900">{STAGE_LABEL[stage]}</span>
        <span className="ml-auto">{status ? <Badge tone={TONE[status]}>{RUN_STATUS_LABEL[status]}</Badge> : <Badge tone="neutral">{ready ? "준비됨" : "대기"}</Badge>}</span>
      </Link>
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">{STAGE_DESCRIPTION[stage]}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
        <dt>마지막 실행</dt>
        <dd className="text-slate-700">{latestRun ? formatDateTime(latestRun.startedAt) : "-"}</dd>
        <dt>턴 / 소요</dt>
        <dd className="text-slate-700">
          {latestRun?.numTurns ?? "-"} / {latestRun?.endedAt ? formatDuration(new Date(latestRun.endedAt).getTime() - new Date(latestRun.startedAt).getTime()) : "-"}
        </dd>
        <dt>비용</dt>
        <dd className="text-slate-700">{formatCost(latestRun?.costUsd)}</dd>
      </dl>
      {latestRun?.error && status === "failed" ? (
        <p className="mt-2 truncate text-[11px] text-red-600" title={latestRun.error}>
          {latestRun.error}
        </p>
      ) : null}
      <div className="mt-auto flex items-center gap-2 pt-3">
        {hasDoc && stage !== "research" ? (
          <a href={api.downloadUrl(projectId, stage, "hwpx")} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50" download>
            <Download className="h-3 w-3" /> HWPX
          </a>
        ) : null}
        {hasDoc && stage === "press" ? (
          <a href={api.downloadUrl(projectId, stage, "md")} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50" download>
            <Download className="h-3 w-3" /> .md
          </a>
        ) : null}
        <Link href={href} className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:underline">
          {active ? "진행 상황 보기" : hasDoc ? "열기" : "시작"} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
