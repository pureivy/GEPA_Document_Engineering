"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import type { RunDTO, Stage } from "@/lib/contracts";
import { STAGES, STAGE_LABEL, type ProjectDTO } from "@/lib/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { formatCost, formatDateTime, formatDuration, RUN_STATUS_LABEL } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PipelineBar } from "./PipelineBar";

interface OverviewData {
  project: ProjectDTO;
  runs: RunDTO[];
  active: Partial<Record<Stage, string | null>>;
  hasDoc: Partial<Record<Stage, boolean>>;
}

/** pure fetch of everything the overview shows (project, runs, active runs, which stages have a doc) */
async function fetchOverview(projectId: string): Promise<OverviewData> {
  const d = await api.getProject(projectId);
  const active: Partial<Record<Stage, string | null>> = {};
  for (const s of STAGES) active[s] = d.stages?.[s]?.activeRunId ?? (d.runs ?? []).find((r) => r.stage === s && r.status === "running")?.id ?? null;
  // best effort, independent requests
  const results = await Promise.all(
    STAGES.map(async (s) => {
      try {
        if (s === "research") return [s, !!(await api.getResearch(projectId)).markdown] as const;
        return [s, !!(await api.getDoc(projectId, s)).doc] as const;
      } catch {
        return [s, false] as const;
      }
    }),
  );
  return { project: d.project, runs: d.runs ?? [], active, hasDoc: Object.fromEntries(results) };
}

export function ProjectOverview({ projectId }: { projectId: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const polling = !!data && Object.values(data.active).some(Boolean);

  // initial load + manual refresh + polling while a run is active; state changes only in callbacks
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetchOverview(projectId)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((e: unknown) => {
          if (alive) setError(errorMessage(e));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    void tick();
    const timer = polling ? setInterval(() => void tick(), 5000) : null;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [projectId, reloadKey, polling]);

  const reload = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  const project = data?.project ?? null;
  const runs = data?.runs ?? [];
  const active = data?.active ?? {};
  const hasDoc = data?.hasDoc ?? {};

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100">
          <ChevronLeft className="h-4 w-4" /> 프로젝트 목록
        </Link>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={reload} loading={loading}>
          <RefreshCw className="h-3.5 w-3.5" /> 새로 고침
        </Button>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          프로젝트를 불러오지 못했습니다: {error}
        </div>
      ) : null}

      {project ? (
        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-bold text-slate-900">{project.title}</h1>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{project.topic}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600 md:grid-cols-4">
            <div>
              <dt className="text-slate-400">지역</dt>
              <dd className="text-slate-800">{project.region || "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">주관기관</dt>
              <dd className="text-slate-800">{project.organizer || "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">담당</dt>
              <dd className="text-slate-800">
                {project.contact?.부서명 || "-"} {project.contact?.담당자 ? `· ${project.contact.담당자}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">연락처</dt>
              <dd className="text-slate-800">
                {project.contact?.전화 || "-"} {project.contact?.이메일 ? `· ${project.contact.이메일}` : ""}
              </dd>
            </div>
          </dl>
        </section>
      ) : !error ? (
        <div className="mb-6 h-32 animate-pulse rounded-lg bg-slate-100" />
      ) : null}

      <h2 className="mb-2 text-sm font-semibold text-slate-700">문서 파이프라인</h2>
      <PipelineBar projectId={projectId} runs={runs} activeRunIds={active} hasDoc={hasDoc} />

      <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-700">실행 기록</h2>
      {runs.length === 0 ? (
        <p className="text-xs text-slate-500">아직 실행 기록이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">단계</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">시작</th>
                <th className="px-3 py-2 font-medium">소요</th>
                <th className="px-3 py-2 font-medium">턴</th>
                <th className="px-3 py-2 font-medium">비용</th>
                <th className="px-3 py-2 font-medium">모델</th>
                <th className="px-3 py-2 font-medium">오류</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    {r.stage === "review" ? (
                      "검토"
                    ) : (
                      <Link href={`/projects/${projectId}/${r.stage}`} className="text-sky-700 hover:underline">
                        {STAGE_LABEL[r.stage]}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={r.status === "running" ? "running" : r.status === "succeeded" ? "success" : r.status === "failed" ? "danger" : "warning"}>{RUN_STATUS_LABEL[r.status]}</Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatDateTime(r.startedAt)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.endedAt ? formatDuration(new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) : "-"}</td>
                  <td className="px-3 py-2 text-slate-600">{r.numTurns ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-600">{formatCost(r.costUsd)}</td>
                  <td className="px-3 py-2 text-slate-500">{r.model}</td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-red-600" title={r.error ?? undefined}>
                    {r.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
