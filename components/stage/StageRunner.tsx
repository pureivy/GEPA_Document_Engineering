"use client";
/**
 * StageRunner — the 3-pane stage screen: RunControls on top, AgentActivityLog | HwpEditor |
 * RenderPane in resizable panels, DownloadBar at the bottom. Owns the run lifecycle (start /
 * cancel / resume), the SSE stream, the typing controller and the edit → save → export flow.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ChevronLeft, Settings2 } from "lucide-react";
import { STAGE_FAMILY, STAGE_LABEL, STAGES, type ProjectDTO, type RunDTO, type RunStatus, type Stage } from "@/lib/contracts";
import type { DocModel } from "@/lib/docmodel/schema";
import { api, errorMessage } from "@/lib/client/api";
import { ActivityStore } from "@/lib/client/activityStore";
import { useRunStream } from "@/lib/client/runStream";
import { cn } from "@/lib/client/format";
import { TypingController } from "@/components/editor/TypingController";
import { HwpEditor, type HwpEditorHandle } from "@/components/editor/HwpEditor";
import { RenderPane } from "@/components/render/RenderPane";
import { Button } from "@/components/ui/button";
import { AgentActivityLog } from "./AgentActivityLog";
import { RunControls, type SaveState } from "./RunControls";
import { DownloadBar } from "./DownloadBar";
import { ResearchPane } from "./ResearchPane";
import { ReviewPanel } from "./ReviewPanel";
import { buildFixInstruction, parseReviewResult, type ReviewResult } from "@/lib/client/review";

export interface StageRunnerProps {
  projectId: string;
  stage: Stage;
  /** the stage's configured model (STAGE_MODELS / GEPA_MODEL env), preselected in the run controls */
  defaultModel: string;
}

const ZOOM_MIN = 50;
const ZOOM_MAX = 150;

export function StageRunner({ projectId, stage, defaultModel }: StageRunnerProps) {
  const family = STAGE_FAMILY[stage];
  const isResearch = stage === "research";
  // model for the next run of this stage (per-run override; the stage default otherwise)
  const [model, setModel] = useState(defaultModel);

  // ---- project / runs
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [runs, setRuns] = useState<RunDTO[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- run lifecycle
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [turns, setTurns] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const catchUpUntil = useRef(0);

  // ---- review (a separate `review` run whose structured result lists issues)
  const reviewKey = `gepa.review.${projectId}.${stage}`;
  const docVersionRef = useRef(0);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [reviewStale, setReviewStale] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<RunStatus | null>(null);
  const [reviewTurns, setReviewTurns] = useState<number | null>(null);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // ---- document
  const [doc, setDoc] = useState<DocModel | null>(null);
  const [docLoaded, setDocLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [historyKey, setHistoryKey] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [typingBacklog, setTypingBacklog] = useState(0);
  const [rewriting, setRewriting] = useState(false);
  // "폭 맞춤": size the A4 page (210mm ≈ 794px) to the editor pane on first layout and on resize
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const zoomTouched = useRef(false);
  useEffect(() => {
    const el = editorPaneRef.current;
    if (!el) return;
    const fit = () => {
      if (zoomTouched.current) return;
      const pageWidthPx = (210 / 25.4) * 96;
      const available = el.clientWidth - 32;
      const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor((available / pageWidthPx) * 100 / 5) * 5));
      setZoom(z);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- research (streamed assistant text; `segStart` marks where the current message began so a
  // full `assistant.text` can replace the deltas of the same message instead of duplicating them)
  const [liveText, setLiveText] = useState("");
  const liveRef = useRef({ text: "", segStart: 0 });
  const resetLive = () => {
    liveRef.current = { text: "", segStart: 0 };
    setLiveText("");
  };
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [mdLoading, setMdLoading] = useState(false);

  const editorRef = useRef<HwpEditorHandle>(null);
  const store = useMemo(() => new ActivityStore(), []);
  // the controller talks to the editor through the ref, so it lives in an effect (not render)
  const controllerRef = useRef<TypingController | null>(null);
  useEffect(() => {
    const c = new TypingController({
      sink: {
        setMeta: (f, m) => editorRef.current?.sink.setMeta(f, m),
        upsertBlock: (b, t) => editorRef.current?.sink.upsertBlock(b, t),
        commitBlock: (b) => editorRef.current?.sink.commitBlock(b),
        setDoc: (d) => editorRef.current?.sink.setDoc(d),
        reset: () => editorRef.current?.sink.reset(),
      },
      onStateChange: (st) => {
        setTypingBacklog(st.backlog);
        setRewriting(st.rewriting);
      },
    });
    controllerRef.current = c;
    if (process.env.NODE_ENV !== "production") {
      // dev hook: lets a replay script drive the panes without a live agent run
      (window as unknown as { __gepaStage?: unknown }).__gepaStage = { controller: c, store };
    }
    return () => {
      c.dispose();
      if (controllerRef.current === c) controllerRef.current = null;
      delete (window as unknown as { __gepaStage?: unknown }).__gepaStage;
    };
  }, [store]);

  const latestRun = useMemo(() => runs.find((r) => r.stage === stage) ?? null, [runs, stage]);

  const loadProject = useCallback(async () => {
    const d = await api.getProject(projectId);
    setProject(d.project);
    setRuns(d.runs ?? []);
    return d;
  }, [projectId]);

  const loadDoc = useCallback(async () => {
    if (isResearch) {
      setMdLoading(true);
      try {
        const r = await api.getResearch(projectId);
        setMarkdown(r.markdown ?? null);
      } finally {
        setMdLoading(false);
        setDocLoaded(true);
      }
      return;
    }
    const r = await api.getDoc(projectId, stage);
    setDoc(r.doc ?? null);
    docVersionRef.current = r.version ?? 0;
    setDocLoaded(true);
  }, [isResearch, projectId, stage]);

  // initial load + attach to an active run
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadProject();
        await loadDoc();
        if (cancelled) return;
        // a review from this tab is shown again only while it still describes the current version
        try {
          const raw = window.sessionStorage.getItem(reviewKey);
          const saved = raw ? (JSON.parse(raw) as { runId?: string; version?: number }) : null;
          if (saved?.runId && saved.version === docVersionRef.current) setReviewRunId(saved.runId);
          else if (raw) window.sessionStorage.removeItem(reviewKey);
        } catch {
          /* per-tab convenience only */
        }
        const active = d.stages?.[stage]?.activeRunId ?? (d.runs ?? []).find((r) => r.stage === stage && r.status === "running")?.id ?? null;
        const last = (d.runs ?? []).find((r) => r.stage === stage) ?? null;
        if (active) {
          const run = (d.runs ?? []).find((r) => r.id === active) ?? null;
          store.reset();
          controllerRef.current?.reset();
          resetLive();
          setStartedAt(run?.startedAt ?? new Date().toISOString());
          setStatus("running");
          setRunning(true);
          catchUpUntil.current = Date.now() + 1500; // replayed frames are applied without animation
          setRunId(active);
        } else if (last) {
          setStatus(last.status);
          setStartedAt(last.startedAt);
          setTurns(last.numTurns);
        }
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProject, loadDoc, stage, store, reviewKey]);

  const finishRun = useCallback(
    async (st: RunStatus) => {
      setRunning(false);
      setStatus(st);
      controllerRef.current?.flush();
      try {
        await loadDoc();
        const d = await loadProject();
        const r = d.runs?.find((x) => x.stage === stage) ?? null;
        if (r?.numTurns !== null && r?.numTurns !== undefined) setTurns(r.numTurns);
      } catch (e) {
        setActionError(errorMessage(e));
      }
      setRefreshKey((k) => k + 1);
      setHistoryKey((k) => k + 1);
    },
    [loadDoc, loadProject, stage],
  );

  const stream = useRunStream(runId, {
    onAgent: (ev) => {
      store.push(ev);
      if (ev.type === "assistant.text") setTurns((t) => (t ?? 0) + 1);
      if (isResearch && !("parentToolUseId" in ev && ev.parentToolUseId)) {
        const live = liveRef.current;
        if (ev.type === "text.delta") {
          live.text += ev.text;
          setLiveText(live.text);
        } else if (ev.type === "assistant.text") {
          live.text = live.text.slice(0, live.segStart) + ev.text + "\n";
          live.segStart = live.text.length;
          setLiveText(live.text);
        } else if (ev.type === "tool.start" || ev.type === "tool.result") {
          live.segStart = live.text.length;
        }
      }
    },
    onDoc: (ev) => {
      // server-side pipeline notices (not part of the typing stream)
      if ((ev as { type: string }).type === "doc.error") {
        setActionError((ev as unknown as { message?: string }).message ?? "문서 생성 오류");
        return;
      }
      if (isResearch) return;
      const c = controllerRef.current;
      if (!c) return;
      c.push(ev);
      if (Date.now() < catchUpUntil.current) c.flush();
    },
    onRun: ({ status: st, error }) => {
      if (st === "running") return;
      if (error) setActionError(error);
      void finishRun(st);
    },
  });

  useRunStream(reviewRunId, {
    onOpen: () => setReviewing(true),
    onAgent: (ev) => {
      if (ev.type === "assistant.text") setReviewTurns((t) => (t ?? 0) + 1);
      if (ev.type === "result") {
        const parsed = parseReviewResult(ev.structured);
        if (parsed) setReviewResult(parsed);
        else if (!ev.ok) setReviewError(ev.error ?? "검토 실행이 실패했습니다");
        else setReviewError("검토 결과(JSON)를 읽지 못했습니다");
      }
    },
    onRun: ({ status: st, error }) => {
      if (st === "running") return;
      setReviewing(false);
      setReviewStatus(st);
      if (error) setReviewError(error);
    },
  });

  const startReview = async () => {
    if (!isResearch && saveState === "dirty") editorRef.current?.flushPendingSave();
    setBusy(true);
    setReviewError(null);
    setReviewResult(null);
    setReviewStatus(null);
    setReviewTurns(0);
    try {
      const r = await api.runReview(projectId, stage);
      try {
        window.sessionStorage.setItem(reviewKey, JSON.stringify({ runId: r.runId, version: docVersionRef.current }));
      } catch {
        /* per-tab convenience only */
      }
      setReviewStale(false);
      setReviewing(true);
      setReviewRunId(r.runId);
    } catch (e) {
      setReviewError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // ---- actions
  const start = async (opts: { resume?: boolean; instruction?: string } = {}) => {
    setBusy(true);
    setActionError(null);
    try {
      editorRef.current?.flushPendingSave();
      const r = await api.runStage(projectId, stage, { ...opts, model });
      store.reset();
      controllerRef.current?.reset();
      resetLive();
      if (!opts.resume) {
        setDoc(null);
        setMarkdown(null);
      }
      setTurns(0);
      setStartedAt(new Date().toISOString());
      setStatus("running");
      setRunning(true);
      catchUpUntil.current = 0;
      setSaveState("idle");
      setRunId(r.runId);
      // the document is about to change; the last review no longer describes it
      setReviewResult(null);
      setReviewStatus(null);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const autoFix = () => {
    if (!reviewResult) return;
    const instruction = buildFixInstruction(reviewResult.issues);
    if (!instruction) return;
    void start({ resume: true, instruction });
  };

  const cancel = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      await api.cancelRun(runId);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // ---- edit → save → export
  const onChange = useCallback(
    async (next: DocModel) => {
      setSaveState("saving");
      try {
        const saved = await api.putDoc(projectId, stage, next);
        docVersionRef.current = saved.version ?? docVersionRef.current + 1;
        setSaveState("saved");
        setSaveError(null);
        setReviewStale((st) => st || reviewResult !== null);
        setRefreshKey((k) => k + 1);
        setHistoryKey((k) => k + 1);
      } catch (e) {
        setSaveState("error");
        setSaveError(errorMessage(e));
      }
    },
    [projectId, stage, reviewResult],
  );

  const onRestored = async () => {
    try {
      await loadDoc();
      setReviewStale((st) => st || reviewResult !== null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const hasDoc = isResearch ? !!markdown : !!doc;
  const stageIndex = STAGES.indexOf(stage);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <Link href={`/projects/${projectId}`} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100">
          <ChevronLeft className="h-4 w-4" /> 파이프라인
        </Link>
        <div className="min-w-0 truncate text-sm text-slate-500">{project?.title ?? "…"}</div>
        <span className="text-slate-300">/</span>
        <div className="text-sm font-semibold text-slate-900">
          {stageIndex + 1}. {STAGE_LABEL[stage]}
        </div>
        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {STAGES.map((s) => (
            <Link key={s} href={`/projects/${projectId}/${s}`} className={cn("rounded px-2 py-1 text-xs", s === stage ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100")}>
              {STAGE_LABEL[s]}
            </Link>
          ))}
        </nav>
      </header>

      <RunControls
        run={latestRun}
        status={status}
        running={running}
        turns={turns}
        startedAt={startedAt}
        canResume={!!latestRun && latestRun.status !== "running"}
        hasDoc={hasDoc}
        busy={busy}
        typingBacklog={typingBacklog}
        saveState={saveState}
        saveError={saveError}
        model={model}
        defaultModel={defaultModel}
        onModelChange={setModel}
        onRun={() => void start()}
        onCancel={() => void cancel()}
        onResume={(instruction) => void start({ resume: true, instruction })}
        onSkipAnimation={() => controllerRef.current?.flush()}
      />

      {loadError || actionError ? (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          <span className="flex-1">{loadError ?? actionError}</span>
          <button type="button" className="underline" onClick={() => (loadError ? window.location.reload() : setActionError(null))}>
            {loadError ? "다시 불러오기" : "닫기"}
          </button>
        </div>
      ) : null}

      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel id="activity" defaultSize={320} minSize={240} maxSize={560} className="min-h-0">
          <AgentActivityLog store={store} running={running} streamState={stream.state} />
        </Panel>
        <Separator className="w-1 shrink-0 bg-slate-200 transition-colors hover:bg-sky-400 data-[separator=active]:bg-sky-500" />
        <Panel id="editor" minSize="30%" className="min-h-0">
          {isResearch ? (
            <ResearchPane liveText={liveText} markdown={markdown} running={running} loading={mdLoading && !docLoaded} error={null} />
          ) : (
            <div className="flex h-full min-h-0 flex-col bg-slate-200/70">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5">
                <div className="text-xs font-semibold text-slate-700">문서 편집</div>
                <span className="text-[11px] text-slate-400">{running ? "실행 중에는 편집할 수 없습니다" : "한글 문서처럼 편집합니다 · 800ms 후 자동 저장"}</span>
                {rewriting ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">에이전트가 문서를 다시 쓰는 중… 완료되면 한 번에 반영됩니다</span> : null}
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={running || !doc} onClick={() => editorRef.current?.openMeta()}>
                    <Settings2 className="h-3.5 w-3.5" /> 메타 편집
                  </Button>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    <input
                      type="range"
                      min={ZOOM_MIN}
                      max={ZOOM_MAX}
                      step={5}
                      value={zoom}
                      onChange={(e) => {
                        zoomTouched.current = true;
                        setZoom(Number(e.target.value));
                      }}
                      className="w-24"
                    />
                    {zoom}%
                  </label>
                </div>
              </div>
              <div ref={editorPaneRef} className="min-h-0 flex-1 overflow-auto">
                {family && docLoaded ? (
                  <HwpEditor
                    ref={editorRef}
                    family={family}
                    doc={doc}
                    readOnly={running}
                    zoom={zoom}
                    onChange={(d) => void onChange(d)}
                    onDirty={() => setSaveState("dirty")}
                    onInvalid={(msg) => {
                      setSaveState("error");
                      setSaveError(msg);
                    }}
                  />
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">{loadError ? "문서를 불러오지 못했습니다." : "문서를 불러오는 중…"}</div>
                )}
              </div>
            </div>
          )}
        </Panel>
        <Separator className="w-1 shrink-0 bg-slate-200 transition-colors hover:bg-sky-400 data-[separator=active]:bg-sky-500" />
        <Panel id="render" defaultSize="32%" minSize={220} collapsible className="min-h-0">
          {isResearch ? (
            <div className="flex h-full items-center justify-center bg-slate-100 p-6 text-center text-xs text-slate-500">조사 단계는 렌더가 없습니다. 노트는 다음 단계(사업계획서)의 입력으로 쓰입니다.</div>
          ) : (
            <RenderPane projectId={projectId} stage={stage} refreshKey={refreshKey} running={running} hasDoc={!!doc} />
          )}
        </Panel>
      </Group>

      {!isResearch ? (
        <ReviewPanel
          hasDoc={hasDoc}
          writerRunning={running}
          reviewing={reviewing}
          reviewStatus={reviewStatus}
          reviewTurns={reviewTurns}
          result={reviewResult}
          stale={reviewStale}
          error={reviewError}
          busy={busy}
          onReview={() => void startReview()}
          onAutoFix={autoFix}
        />
      ) : null}
      <DownloadBar projectId={projectId} stage={stage} hasDoc={hasDoc} running={running} historyKey={historyKey} onRestored={() => void onRestored()} beforeDownload={() => editorRef.current?.flushPendingSave()} />
    </div>
  );
}
