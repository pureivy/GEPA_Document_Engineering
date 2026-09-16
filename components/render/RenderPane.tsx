"use client";
/**
 * RenderPane — the paginated truth: POST /export builds the HWPX and returns a report;
 * pages are shown as SVG thumbnails + one selected page (`/render?page=n&h=hash`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import type { ExportReportDTO, Stage } from "@/lib/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { cn, formatDateTime } from "@/lib/client/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface RenderPaneProps {
  projectId: string;
  stage: Stage;
  /** bump to export + re-render (after run end, after save) */
  refreshKey: number;
  running: boolean;
  /** there is a document to export */
  hasDoc: boolean;
  onReport?: (r: ExportReportDTO) => void;
}

export function RenderPane({ projectId, stage, refreshKey, running, hasDoc, onReport }: RenderPaneProps) {
  const [report, setReport] = useState<ExportReportDTO | null>(null);
  const [loading, setLoading] = useState(hasDoc);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const inflight = useRef(false);
  const onReportRef = useRef(onReport);
  useEffect(() => {
    onReportRef.current = onReport;
  });

  /** POST /export then show the report; state changes happen after the request (async) */
  const doExport = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await api.exportStage(projectId, stage);
      setReport(r);
      setError(null);
      setPage((p) => (r.pageCount > 0 ? Math.min(p, r.pageCount - 1) : 0));
      onReportRef.current?.(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      inflight.current = false;
    }
  }, [projectId, stage]);

  const refresh = () => {
    setLoading(true);
    void doExport();
  };

  // export on mount (when a doc exists) and whenever the caller bumps refreshKey
  useEffect(() => {
    if (!hasDoc) return;
    const t = setTimeout(() => void doExport(), 0);
    return () => clearTimeout(t);
  }, [refreshKey, hasDoc, doExport]);

  useEffect(() => {
    if (!running || !autoRefresh) return;
    const t = setInterval(() => void doExport(), 20000);
    return () => clearInterval(t);
  }, [running, autoRefresh, doExport]);

  const pages = report?.pageCount ?? 0;
  const pageUrl = (n: number) => api.renderPageUrl(projectId, stage, n, report?.hash);
  const ok = report ? report.ok && report.errors.length === 0 : null;

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="text-xs font-semibold text-slate-700">실제 렌더</div>
        {report ? (
          <>
            <Badge tone={ok ? "success" : "danger"} title={[...report.errors, ...report.warnings].join("\n") || undefined}>
              {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {ok ? "검증 통과" : "검증 실패"}
            </Badge>
            <Badge tone="neutral">{report.pageCount}쪽</Badge>
            <Badge tone={report.contentLossCount === null ? "neutral" : report.contentLossCount === 0 ? "success" : "danger"}>손실 {report.contentLossCount ?? "?"}</Badge>
            {report.warnings.length ? (
              <Badge tone="warning" title={report.warnings.join("\n")}>
                경고 {report.warnings.length}
              </Badge>
            ) : null}
            {report.appendedStyles ? <Badge tone="neutral">스타일 +{report.appendedStyles}</Badge> : null}
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {running ? (
            <label className="mr-1 flex items-center gap-1 text-[11px] text-slate-500">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> 20초마다 갱신
            </label>
          ) : null}
          <Button size="sm" variant="outline" onClick={refresh} loading={loading} disabled={!hasDoc}>
            <RefreshCw className="h-3.5 w-3.5" /> 렌더 갱신
          </Button>
        </div>
      </div>

      {error ? (
        <div className="m-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <div className="font-medium">렌더에 실패했습니다</div>
          <div className="mt-1 whitespace-pre-wrap">{error}</div>
        </div>
      ) : null}

      {!report && !error ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-slate-500">
          {loading ? "HWPX를 생성하고 렌더하는 중…" : hasDoc ? "렌더 결과가 없습니다. ‘렌더 갱신’을 눌러 주세요." : running ? "실행이 끝나면 실제 렌더가 표시됩니다." : "문서가 생성되면 실제 렌더가 표시됩니다."}
        </div>
      ) : null}

      {report ? (
        <div className={cn("flex min-h-0 flex-1", running && "opacity-60 grayscale-[30%]")}>
          <div className="w-[88px] shrink-0 space-y-2 overflow-y-auto border-r border-slate-200 bg-white p-2">
            {Array.from({ length: pages }, (_, i) => (
              <button key={i} type="button" onClick={() => setPage(i)} className={cn("block w-full rounded border bg-white p-0.5 text-left", i === page ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-200 hover:border-slate-400")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pageUrl(i)} alt={`${i + 1}쪽`} className="aspect-[210/297] w-full bg-white object-contain" loading="lazy" />
                <div className="pt-0.5 text-center text-[10px] text-slate-500">{i + 1}</div>
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 overflow-auto p-3">
            {pages > 0 ? (
              <div style={zoom === "fit" ? { width: "100%" } : { width: `${zoom}%`, minWidth: "210mm" }} className="mx-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={`${report.hash}-${page}`} src={pageUrl(page)} alt={`${page + 1}쪽 렌더`} className="w-full bg-white shadow-[0_0_0_1px_rgba(15,23,42,.08),0_8px_24px_rgba(15,23,42,.12)]" />
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500">렌더된 쪽이 없습니다.</div>
            )}
            <div className="sticky bottom-2 mt-3 flex justify-center gap-1">
              <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-2 py-1 text-[11px] text-slate-600 shadow">
                <button type="button" className="rounded p-0.5 hover:bg-slate-100" onClick={() => setZoom((z) => (z === "fit" ? 80 : Math.max(50, z - 10)))} aria-label="축소">
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="px-1" onClick={() => setZoom("fit")}>
                  {zoom === "fit" ? "폭 맞춤" : `${zoom}%`}
                </button>
                <button type="button" className="rounded p-0.5 hover:bg-slate-100" onClick={() => setZoom((z) => (z === "fit" ? 120 : Math.min(200, z + 10)))} aria-label="확대">
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <span className="ml-1 text-slate-400">{page + 1} / {pages}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {report ? <div className="border-t border-slate-200 bg-white px-3 py-1 text-[10px] text-slate-400">빌드 {formatDateTime(report.builtAt)} · {report.hash.slice(0, 10)}</div> : null}
    </div>
  );
}
