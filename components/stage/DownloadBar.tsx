"use client";
import { useCallback, useEffect, useState } from "react";
import { Code2, Download, History, RotateCcw } from "lucide-react";
import type { Stage } from "@/lib/contracts";
import { api, errorMessage, type VersionDTO } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Dialog, Sheet } from "@/components/ui/dialog";

export interface DownloadBarProps {
  projectId: string;
  stage: Stage;
  /** a document exists on the server (downloads make sense) */
  hasDoc: boolean;
  running: boolean;
  /** bump to refresh the history list */
  historyKey: number;
  onRestored: () => void;
  /** flush any pending editor save before downloading */
  beforeDownload?: () => void;
}

const SOURCE_LABEL: Record<string, string> = { agent: "에이전트", user: "사용자 편집", restore: "복원", import: "가져오기" };

export function DownloadBar({ projectId, stage, hasDoc, running, historyKey, onRestored, beforeDownload }: DownloadBarProps) {
  const [histOpen, setHistOpen] = useState(false);
  const [versions, setVersions] = useState<VersionDTO[] | null>(null);
  const [histError, setHistError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [dslOpen, setDslOpen] = useState(false);
  const [dsl, setDsl] = useState<{ text: string | null; error: string | null }>({ text: null, error: null });

  const loadHistory = useCallback(async () => {
    try {
      const r = await api.history(projectId, stage);
      setVersions(r.versions);
      setHistError(null);
    } catch (e) {
      setHistError(errorMessage(e));
    }
  }, [projectId, stage]);

  useEffect(() => {
    if (!histOpen) return;
    let active = true;
    api
      .history(projectId, stage)
      .then((r) => {
        if (!active) return;
        setVersions(r.versions);
        setHistError(null);
      })
      .catch((e: unknown) => {
        if (active) setHistError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [histOpen, historyKey, projectId, stage]);

  const restore = async (seq: number) => {
    setRestoring(seq);
    try {
      await api.restore(projectId, stage, seq);
      onRestored();
      await loadHistory();
    } catch (e) {
      setHistError(errorMessage(e));
    } finally {
      setRestoring(null);
    }
  };

  const openDsl = async () => {
    setDslOpen(true);
    setDsl({ text: null, error: null });
    try {
      const r = await api.getDsl(projectId, stage);
      const text = typeof r === "string" ? r : (r.dsl ?? r.markdown ?? JSON.stringify(r, null, 2));
      setDsl({ text, error: null });
    } catch (e) {
      setDsl({ text: null, error: errorMessage(e) });
    }
  };

  const isResearch = stage === "research";
  const disabled = !hasDoc || running;

  /** research has no DocModel (the download route needs one): fetch notes.md and save it client-side */
  const downloadNotes = async () => {
    try {
      const r = await api.getResearch(projectId);
      const blob = new Blob([r.markdown ?? ""], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `research-notes_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setHistError(errorMessage(e));
    }
  };
  const link = (format: "hwpx" | "pdf" | "md" | "txt", label: string) => (
    <a
      key={format}
      href={disabled ? undefined : api.downloadUrl(projectId, stage, format)}
      onClick={(e) => {
        if (disabled) e.preventDefault();
        else beforeDownload?.();
      }}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium ${disabled ? "pointer-events-none border-slate-200 text-slate-400" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}
      aria-disabled={disabled}
      download
    >
      <Download className="h-3.5 w-3.5" /> {label}
    </a>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-3 py-2">
      {isResearch ? (
        <Button variant="outline" size="sm" className="h-8" disabled={disabled} onClick={() => void downloadNotes()}>
          <Download className="h-3.5 w-3.5" /> 조사 노트(.md)
        </Button>
      ) : (
        <>
          {link("hwpx", "HWPX 다운로드")}
          {link("pdf", "PDF 다운로드")}
          {stage === "press" ? link("md", ".md") : null}
          {stage === "press" ? link("txt", ".txt") : null}
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        {!isResearch ? (
          <Button variant="ghost" size="sm" onClick={openDsl} disabled={!hasDoc}>
            <Code2 className="h-3.5 w-3.5" /> 원본 DSL 보기
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setHistOpen(true)}>
          <History className="h-3.5 w-3.5" /> 버전 기록
        </Button>
      </div>

      <Sheet open={histOpen} onClose={() => setHistOpen(false)} title="버전 기록" description="저장된 문서 버전입니다. 복원하면 새 버전으로 기록됩니다.">
        {histError ? <p className="rounded bg-red-50 p-2 text-xs text-red-700">{histError}</p> : null}
        {versions === null && !histError ? <p className="text-xs text-slate-500">불러오는 중…</p> : null}
        {versions && versions.length === 0 ? <p className="text-xs text-slate-500">저장된 버전이 없습니다.</p> : null}
        <ul className="divide-y divide-slate-100">
          {versions?.map((v) => (
            <li key={v.seq} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="text-sm text-slate-800">
                  v{v.seq} <span className="ml-1 text-xs text-slate-500">{SOURCE_LABEL[v.source] ?? v.source}</span>
                </div>
                <div className="text-[11px] text-slate-400">{formatDateTime(v.createdAt)}</div>
              </div>
              <Button size="sm" variant="outline" disabled={running || restoring !== null} loading={restoring === v.seq} onClick={() => restore(v.seq)}>
                <RotateCcw className="h-3 w-3" /> 복원
              </Button>
            </li>
          ))}
        </ul>
      </Sheet>

      <Dialog open={dslOpen} onClose={() => setDslOpen(false)} title="원본 DSL" description="에이전트가 작성한 문서 원문(Markdown 계열 DSL)입니다." className="max-w-3xl">
        {dsl.error ? <p className="rounded bg-red-50 p-2 text-xs text-red-700">{dsl.error}</p> : null}
        {dsl.text === null && !dsl.error ? <p className="text-xs text-slate-500">불러오는 중…</p> : null}
        {dsl.text !== null ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-[12px] leading-relaxed text-slate-800">{dsl.text}</pre> : null}
      </Dialog>
    </div>
  );
}
