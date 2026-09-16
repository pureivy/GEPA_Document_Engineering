"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Bot, Brain, ChevronDown, ChevronRight, CircleCheck, CircleX, FileText, Globe, Hammer, Search, Terminal, Users } from "lucide-react";
import type { ActivityItem, ActivityStore } from "@/lib/client/activityStore";
import { stripDocBlocks, toolSummary } from "@/lib/client/activityStore";
import { cn, formatCost, formatDuration } from "@/lib/client/format";
import type { StreamState } from "@/lib/client/runStream";
import { Badge } from "@/components/ui/badge";

const STREAM_LABEL: Record<StreamState, string> = { idle: "대기", connecting: "연결 중", open: "연결됨", reconnecting: "재연결 중", closed: "종료", error: "연결 오류" };

function ToolIcon({ name }: { name: string }) {
  const c = "h-3.5 w-3.5";
  switch (name) {
    case "WebSearch":
      return <Search className={c} />;
    case "WebFetch":
      return <Globe className={c} />;
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "Glob":
    case "Grep":
      return <FileText className={c} />;
    case "Bash":
      return <Terminal className={c} />;
    case "Task":
      return <Users className={c} />;
    default:
      return <Hammer className={c} />;
  }
}

function TextItem({ item, startInDoc = false }: { item: Extract<ActivityItem, { kind: "text" }>; startInDoc?: boolean }) {
  const { visible, inDoc } = stripDocBlocks(item.raw, startInDoc);
  if (!visible.trim() && !inDoc) return null;
  return (
    <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[12px] leading-relaxed text-slate-600">
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">생각/설명</div>
      <div className="whitespace-pre-wrap break-words">{visible.trim()}</div>
      {inDoc ? (
        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-600" /> 문서를 작성하는 중… (편집기에 표시)
        </div>
      ) : null}
    </div>
  );
}

function ToolItem({ item, depth, running }: { item: Extract<ActivityItem, { kind: "tool" }>; depth: number; running: boolean }) {
  const [open, setOpen] = useState(false);
  const [childrenOpen, setChildrenOpen] = useState(true);
  const { label, detail } = toolSummary(item.name, item.input);
  const isTask = item.name === "Task" || !!item.subagent;
  const status = !item.done ? "running" : item.isError ? "error" : "ok";
  return (
    <div className={cn("rounded-md border text-[12px]", status === "error" ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-white")}>
      <button type="button" className="flex w-full items-start gap-2 px-2 py-1.5 text-left" onClick={() => setOpen((o) => !o)}>
        <span className={cn("mt-0.5 shrink-0", status === "running" ? "text-sky-600" : status === "error" ? "text-red-600" : "text-slate-500")}>
          <ToolIcon name={item.name} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-slate-800">{isTask && item.subagent ? `하위 에이전트 · ${item.subagent.agent}` : label}</span>
            {status === "running" ? <Badge tone="running">실행 중</Badge> : status === "error" ? <CircleX className="h-3.5 w-3.5 text-red-600" /> : <CircleCheck className="h-3.5 w-3.5 text-emerald-600" />}
            {item.endedAt ? <span className="text-[10px] text-slate-400">{formatDuration(item.endedAt - item.startedAt)}</span> : null}
          </span>
          {detail || item.subagent?.description ? <span className="block truncate text-slate-500" title={detail || item.subagent?.description}>{item.subagent?.description || detail}</span> : null}
        </span>
        <span className="mt-0.5 shrink-0 text-slate-400">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 px-2 py-1.5">
          {item.input !== undefined ? (
            <div className="mb-1.5">
              <div className="text-[10px] font-medium text-slate-400">입력</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-1.5 font-mono text-[11px] text-slate-700">{JSON.stringify(item.input, null, 1)}</pre>
            </div>
          ) : null}
          {item.result !== null ? (
            <div>
              <div className="text-[10px] font-medium text-slate-400">결과</div>
              <pre className={cn("max-h-48 overflow-auto whitespace-pre-wrap break-all rounded p-1.5 font-mono text-[11px]", item.isError ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700")}>{item.result.slice(0, 4000)}{item.result.length > 4000 ? "\n…" : ""}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
      {isTask && item.children.length ? (
        <div className="border-t border-slate-100">
          <button type="button" className="flex w-full items-center gap-1 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50" onClick={() => setChildrenOpen((o) => !o)}>
            {childrenOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            하위 활동 {item.children.length}건
          </button>
          {childrenOpen ? (
            <div className="space-y-1.5 px-2 pb-2" style={{ marginLeft: Math.min(depth, 3) * 4 }}>
              {item.children.map((c) => (
                <Item key={c.id} item={c} depth={depth + 1} running={running} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Item({ item, depth, running, startInDoc = false }: { item: ActivityItem; depth: number; running: boolean; startInDoc?: boolean }) {
  switch (item.kind) {
    case "init":
      return (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Bot className="h-3.5 w-3.5" /> 세션 시작 · 모델 {item.model} · 도구 {item.tools.length}개
        </div>
      );
    case "text":
      return <TextItem item={item} startInDoc={startInDoc} />;
    case "thinking":
      return (
        <div className="flex gap-2 rounded-md bg-violet-50/60 px-2.5 py-1.5 text-[12px] text-violet-800">
          <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-pre-wrap break-words">{item.text}</span>
        </div>
      );
    case "tool":
      return <ToolItem item={item} depth={depth} running={running} />;
    case "result":
      return (
        <div className={cn("rounded-md border px-2.5 py-2 text-[12px]", item.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
          <div className="flex items-center gap-1.5 font-medium">
            {item.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
            {item.ok ? "실행 완료" : "실행 실패"}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] opacity-80">
            {item.turns !== undefined ? <span>턴 {item.turns}</span> : null}
            {item.durationMs !== undefined ? <span>소요 {formatDuration(item.durationMs)}</span> : null}
            {item.costUsd !== undefined && item.costUsd > 0 ? (
              <span title="구독(claude 로그인)으로 실행되므로 실제 청구액이 아닌 CLI의 참고 환산값입니다">참고 환산 {formatCost(item.costUsd)}</span>
            ) : null}
          </div>
          {item.error ? <div className="mt-1 whitespace-pre-wrap text-[11px]">{item.error}</div> : null}
        </div>
      );
    case "stderr":
      return <pre className="whitespace-pre-wrap break-all rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-500">{item.text}</pre>;
    case "error":
      return (
        <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <div>{item.message}</div>
            {item.hint ? <div className="text-[11px] opacity-80">{item.hint}</div> : null}
          </div>
        </div>
      );
  }
}

export interface AgentActivityLogProps {
  store: ActivityStore;
  running: boolean;
  streamState: StreamState;
}

export function AgentActivityLog({ store, running, streamState }: AgentActivityLogProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [snap.version]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div className="flex h-full flex-col bg-slate-50/60">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
        <div className="text-xs font-semibold text-slate-700">에이전트 활동</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">도구 {snap.toolCount}회</span>
          <Badge tone={streamState === "open" ? (running ? "running" : "success") : streamState === "error" ? "danger" : streamState === "reconnecting" ? "warning" : "neutral"}>{STREAM_LABEL[streamState]}</Badge>
        </div>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {snap.items.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-slate-400">{running ? "이벤트를 기다리는 중…" : "실행하면 에이전트의 검색·읽기·작성 활동이 여기에 표시됩니다."}</div>
        ) : (
          (() => {
            // the <<<DOC … DOC>>> state carries across consecutive top-level text items
            let inDoc = false;
            return snap.items.map((it) => {
              const start = inDoc;
              if (it.kind === "text") inDoc = stripDocBlocks(it.raw, start).inDoc;
              return <Item key={it.id} item={it} depth={0} running={running} startInDoc={start} />;
            });
          })()
        )}
        {running && snap.inDoc ? null : running ? (
          <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-slate-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" /> 작업 중…
          </div>
        ) : null}
      </div>
    </div>
  );
}
