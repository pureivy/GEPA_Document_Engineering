"use client";
/**
 * 양식 맞춰 쓰기 화면 — 문서 편집기가 없다(결과는 담당자가 준 양식 그대로의 한글 파일이다).
 *   왼쪽: 작업 기록 / 가운데 위: 지시와 AI 답(대화) / 가운데 아래: 바뀐 곳 표 / 오른쪽: 한글이 그린 결과 쪽
 * 고칠 것·물을 것은 「이어서 수정 요청」으로 보낸다 — AI가 근거를 답하거나 고칠 목록을 고친다.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Download, FileText, Paperclip, X } from "lucide-react";
import { STAGE_LABEL, type ProjectDTO, type RunDTO, type RunStatus } from "@/lib/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { ActivityStore } from "@/lib/client/activityStore";
import { useRunStream } from "@/lib/client/runStream";
import { cn, formatDateTime } from "@/lib/client/format";
import { Group, Panel, Separator } from "react-resizable-panels";
import { RenderPane } from "@/components/render/RenderPane";
import { AgentActivityLog } from "./AgentActivityLog";
import { RunControls } from "./RunControls";
import { ResearchPane } from "./ResearchPane";

export interface TemplateRunnerProps {
  projectId: string;
  defaultModel: string;
}

type Dialog = { at: string; role: "user" | "assistant"; text: string }[];

export function TemplateRunner({ projectId, defaultModel }: TemplateRunnerProps) {
  const stage = "template" as const;
  const [model, setModel] = useState(defaultModel);
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [runs, setRuns] = useState<RunDTO[]>([]);
  const [info, setInfo] = useState<{ template: string | null; references: string[]; changes: string | null; dialog: Dialog } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [turns, setTurns] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveText, setLiveText] = useState("");
  const store = useMemo(() => new ActivityStore(), []);
  const latestRun = useMemo(() => runs.find((r) => r.stage === stage) ?? null, [runs]);

  const load = useCallback(async () => {
    const [d, t] = await Promise.all([api.getProject(projectId), api.getTemplate(projectId)]);
    setProject(d.project);
    setRuns(d.runs ?? []);
    setInfo(t);
    return d;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await load();
        if (cancelled) return;
        const active = d.stages?.[stage]?.activeRunId ?? (d.runs ?? []).find((r) => r.stage === stage && r.status === "running")?.id ?? null;
        const last = (d.runs ?? []).find((r) => r.stage === stage) ?? null;
        if (active) {
          const run = (d.runs ?? []).find((r) => r.id === active) ?? null;
          store.reset();
          setStartedAt(run?.startedAt ?? new Date().toISOString());
          setStatus("running");
          setRunning(true);
          setRunId(active);
        } else if (last) {
          setStatus(last.status);
          setStartedAt(last.startedAt);
          setTurns(last.numTurns);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, store]);

  const stream = useRunStream(runId, {
    onAgent: (ev) => {
      store.push(ev);
      if (ev.type === "assistant.text" && !ev.parentToolUseId) {
        setTurns((t) => (t ?? 0) + 1);
        setLiveText(ev.text);
      }
    },
    onDoc: (ev) => {
      if ((ev as { type: string }).type === "doc.error") setError((ev as unknown as { message?: string }).message ?? "오류");
    },
    onRun: ({ status: st, error: err }) => {
      if (st === "running") return;
      setRunning(false);
      setStatus(st);
      if (err) setError(err);
      void load()
        .then(() => setRefreshKey((k) => k + 1))
        .catch((e) => setError(errorMessage(e)));
    },
  });

  const start = async (opts: { resume?: boolean; instruction?: string } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.runStage(projectId, stage, { ...opts, model });
      store.reset();
      setLiveText("");
      setTurns(0);
      setStartedAt(new Date().toISOString());
      setStatus("running");
      setRunning(true);
      setRunId(r.runId);
      void load().catch(() => undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      await api.cancelRun(runId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const [fileNote, setFileNote] = useState("");
  const addFiles = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      await api.uploadReference(projectId, files, "", false, false, (done, total, name) => setFileNote(done < total ? `올리는 중 ${done + 1}/${total} ${name}` : ""));
      await load();
      setFileNote(`${files.length}개 올림 — ‘실행’(처음부터) 또는 ‘이어서 수정 요청’을 누르면 반영됩니다`);
    } catch (e) {
      setError(errorMessage(e));
      setFileNote("");
    } finally {
      setBusy(false);
    }
  };
  const removeFile = async (name: string) => {
    const isTemplate = name === info?.template;
    if (!window.confirm(isTemplate ? `양식 파일 「${name}」을 빼면 다음 파일이 양식이 되고, 지금까지 고친 목록은 새 양식 기준으로 다시 만들어야 합니다. 뺄까요?` : `「${name}」을 뺄까요?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeReference(projectId, name);
      await load();
      setFileNote(`「${name}」을 뺐습니다`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** 양식 쓰임 바꾸기 — 다음 실행부터 지시가 바뀐다. 이미 만든 결과는 그대로라 처음부터 다시 실행해야 반영된다 */
  const mode = project?.contact?.양식쓰임 === "새로 쓰기" ? "새로 쓰기" : "고쳐 쓰기";
  const changeMode = async () => {
    const to = mode === "새로 쓰기" ? "고쳐 쓰기" : "새로 쓰기";
    const msg =
      to === "새로 쓰기"
        ? "「새로 쓰기」로 바꿉니다 — 양식은 모양만 빌리고, 원본 내용은 지우고, 구성·분량은 참고 문서에 맞춥니다.\n\n바꾼 뒤 ‘실행’(처음부터)을 눌러야 반영됩니다."
        : "「고쳐 쓰기」로 바꿉니다 — 같은 문서를 새 자료로 고치고, 틀·쪽수를 지키며 범위 밖은 그대로 둡니다.\n\n바꾼 뒤 ‘실행’(처음부터)을 눌러야 반영됩니다.";
    if (!window.confirm(msg)) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateProject(projectId, { 양식쓰임: to });
      await load();
      setFileNote(`양식 쓰임을 「${to}」로 바꿨습니다 — ‘실행’(처음부터)을 누르면 반영됩니다`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const hasResult = !!info?.changes;
  const dialog = info?.dialog ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <Link href={`/projects/${projectId}`} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100">
          <ChevronLeft className="h-4 w-4" /> 프로젝트
        </Link>
        <div className="min-w-0 truncate text-sm text-slate-500">{project?.title ?? "…"}</div>
        <span className="text-slate-300">/</span>
        <div className="text-sm font-semibold text-slate-900">{STAGE_LABEL[stage]}</div>
      </header>

      {/* 올린 파일 — 만든 뒤에도 참고 문서를 더 올리거나 뺄 수 있다(담당자 2026-11-17). 다시 실행하거나 이어서 수정하면 반영된다 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5" title={mode === "새로 쓰기" ? "양식은 모양만 빌리고 내용·구성·분량은 참고 문서를 따릅니다" : "같은 문서를 새 자료로 고칩니다 — 틀·쪽수를 지키고 범위 밖은 그대로 둡니다"}>
          <span className="font-semibold text-slate-800">{mode}</span>
          <button type="button" className="text-sky-700 hover:underline disabled:text-slate-400" disabled={running || busy || !project} onClick={() => void changeMode()}>
            바꾸기
          </button>
        </span>
        {info?.template ? <FileChip icon="양식" name={info.template} disabled={running || busy} onRemove={() => void removeFile(info.template!)} /> : <span className="text-red-600">양식 파일이 없습니다 — 한글 파일을 올려 주세요</span>}
        {info?.references.map((n) => <FileChip key={n} icon="참고" name={n} disabled={running || busy} onRemove={() => void removeFile(n)} />)}
        <label className={cn("inline-flex cursor-pointer items-center gap-1 rounded border border-dashed border-slate-300 px-2 py-0.5 hover:bg-white", (running || busy) && "pointer-events-none opacity-50")}>
          <Paperclip className="h-3 w-3" /> 파일 추가
          <input
            type="file"
            multiple
            className="hidden"
            accept=".hwp,.hwpx,.pdf,.docx,.xlsx,.xls,.csv,.md,.txt"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void addFiles(files);
            }}
          />
        </label>
        {fileNote ? <span className="text-sky-700">{fileNote}</span> : null}
      </div>

      <RunControls
        run={latestRun}
        status={status}
        running={running}
        turns={turns}
        startedAt={startedAt}
        canResume={!!latestRun && latestRun.status !== "running"}
        hasDoc={hasResult}
        busy={busy}
        typingBacklog={0}
        saveState="idle"
        saveError={null}
        model={model}
        defaultModel={defaultModel}
        onModelChange={setModel}
        autoChain={false}
        canAutoChain={false}
        onAutoChainChange={() => undefined}
        planResearch={false}
        canPlanResearch={false}
        onPlanResearchChange={() => undefined}
        onRun={() => void start()}
        onCancel={() => void cancel()}
        onResume={(instruction) => void start({ resume: true, instruction })}
        onSkipAnimation={() => undefined}
      />

      {error ? (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          <span className="flex-1">{error}</span>
          <button type="button" className="underline" onClick={() => setError(null)}>
            닫기
          </button>
        </div>
      ) : null}

      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel id="activity" defaultSize={300} minSize={220} maxSize={520} className="min-h-0">
          <AgentActivityLog store={store} running={running} streamState={stream.state} />
        </Panel>
        <Separator className="w-1 shrink-0 bg-slate-200 transition-colors hover:bg-sky-400 data-[separator=active]:bg-sky-500" />
        <Panel id="middle" minSize="28%" className="min-h-0">
          <Group orientation="vertical" className="h-full min-h-0">
            <Panel id="dialog" defaultSize="40%" minSize={80} className="min-h-0">
              <div className="flex h-full min-h-0 flex-col bg-white">
                <div className="border-b border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">
                  지시와 답 <span className="font-normal text-slate-400">· 근거를 묻거나 고칠 것을 ‘이어서 수정 요청’으로 보내세요</span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-xs leading-relaxed">
                  {dialog.length === 0 && !running ? <div className="text-slate-400">아직 실행하지 않았습니다. ‘실행’을 누르면 양식의 문단을 읽고 지시대로 글자를 고칩니다.</div> : null}
                  {dialog.map((m, i) => (
                    <div key={i} className={cn("rounded-md px-3 py-2 whitespace-pre-wrap", m.role === "user" ? "ml-8 bg-sky-50 text-sky-900" : "mr-8 bg-slate-100 text-slate-800")}>
                      <div className="mb-0.5 text-[10px] text-slate-400">
                        {m.role === "user" ? "지시" : "AI"} · {formatDateTime(m.at)}
                      </div>
                      {m.text}
                    </div>
                  ))}
                  {running && liveText ? <div className="mr-8 rounded-md bg-slate-100 px-3 py-2 whitespace-pre-wrap text-slate-800 opacity-80">{liveText}</div> : null}
                </div>
              </div>
            </Panel>
            <Separator className="h-1 shrink-0 bg-slate-200 transition-colors hover:bg-sky-400 data-[separator=active]:bg-sky-500" />
            <Panel id="changes" minSize={80} className="min-h-0">
              <ResearchPane liveText="" markdown={info?.changes ?? null} running={false} loading={false} error={null} fileLabel="바뀐 곳 (원본 → 바뀐 글)" emptyText="실행이 끝나면 원본과 달라진 문단이 여기에 표로 나옵니다. 표에 없는 문단은 원본 그대로입니다." />
            </Panel>
          </Group>
        </Panel>
        <Separator className="w-1 shrink-0 bg-slate-200 transition-colors hover:bg-sky-400 data-[separator=active]:bg-sky-500" />
        <Panel id="render" defaultSize="36%" minSize={220} collapsible className="min-h-0">
          <RenderPane projectId={projectId} stage={stage} refreshKey={refreshKey} running={running} hasDoc={hasResult} />
        </Panel>
      </Group>

      <footer className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="text-slate-500">결과는 올린 양식의 서식을 그대로 둔 한글 파일입니다.</span>
        <a
          href={hasResult && !running ? api.downloadUrl(projectId, stage, "hwpx") : undefined}
          aria-disabled={!hasResult || running}
          className={cn("ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1", hasResult && !running ? "border-slate-300 text-slate-700 hover:bg-slate-50" : "pointer-events-none border-slate-200 text-slate-300")}
        >
          <Download className="h-3.5 w-3.5" /> 한글(hwpx) 내려받기
        </a>
      </footer>
    </div>
  );
}

function FileChip({ icon, name, disabled, onRemove }: { icon: "양식" | "참고"; name: string; disabled: boolean; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-[22rem] items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5">
      <span className={cn("shrink-0 rounded px-1 text-[10px] font-semibold", icon === "양식" ? "bg-sky-100 text-sky-800" : "bg-slate-200 text-slate-600")}>{icon}</span>
      <FileText className="h-3 w-3 shrink-0 text-slate-400" />
      <span className="truncate" title={name}>
        {name}
      </span>
      <button type="button" aria-label={`${name} 빼기`} disabled={disabled} className="shrink-0 rounded p-0.5 text-slate-400 hover:text-red-600 disabled:opacity-40" onClick={onRemove}>
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
