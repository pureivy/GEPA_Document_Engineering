"use client";
/**
 * useRunStream — EventSource wrapper for `GET /api/runs/:runId/events`.
 *
 * Frames are dispatched by their SSE event name (`agent` | `doc` | `run`), never by the
 * payload's `type` (both AgentActivityEvent and DocEvent have a `text.delta`). The browser
 * resends `Last-Event-ID` on reconnect; a terminal `run` frame closes the source so a
 * finished run does not reconnect forever.
 */
import { useEffect, useEffectEvent, useState } from "react";
import type { AgentActivityEvent, DocEvent, RunStatus } from "@/lib/contracts";
import { api } from "./api";

export type StreamState = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";

export interface RunStreamHandlers {
  onAgent?: (ev: AgentActivityEvent, seq: number) => void;
  onDoc?: (ev: DocEvent, seq: number) => void;
  onRun?: (data: { status: RunStatus; error?: string }, seq: number) => void;
  /** called once per (re)connection before any frame */
  onOpen?: () => void;
}

export interface RunStreamInfo {
  state: StreamState;
  lastSeq: number;
  runStatus: RunStatus | null;
  error: string | null;
}

const TERMINAL: RunStatus[] = ["succeeded", "failed", "cancelled"];
const IDLE: RunStreamInfo = { state: "idle", lastSeq: 0, runStatus: null, error: null };
const CONNECTING: RunStreamInfo = { state: "connecting", lastSeq: 0, runStatus: null, error: null };

type Tracked = RunStreamInfo & { forRunId: string };

export function useRunStream(runId: string | null, handlers: RunStreamHandlers): RunStreamInfo {
  // state is tagged with the run it belongs to, so switching runs needs no reset in an effect
  const [tracked, setTracked] = useState<Tracked | null>(null);

  const onAgent = useEffectEvent((ev: AgentActivityEvent, seq: number) => handlers.onAgent?.(ev, seq));
  const onDoc = useEffectEvent((ev: DocEvent, seq: number) => handlers.onDoc?.(ev, seq));
  const onRun = useEffectEvent((data: { status: RunStatus; error?: string }, seq: number) => handlers.onRun?.(data, seq));
  const onOpen = useEffectEvent(() => handlers.onOpen?.());

  useEffect(() => {
    if (!runId) return;
    const id = runId;
    const update = (patch: Partial<RunStreamInfo> | ((s: RunStreamInfo) => RunStreamInfo)) =>
      setTracked((prev) => {
        const base: RunStreamInfo = prev && prev.forRunId === id ? prev : CONNECTING;
        const next = typeof patch === "function" ? patch(base) : { ...base, ...patch };
        return { ...next, forRunId: id };
      });

    if (typeof EventSource === "undefined") {
      queueMicrotask(() => update({ state: "error", error: "이 브라우저는 EventSource를 지원하지 않습니다" }));
      return;
    }
    let seq = 0;
    let closed = false;
    let seqTimer: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource(api.eventsUrl(id));

    const noteSeq = (e: MessageEvent) => {
      const n = Number(e.lastEventId);
      if (Number.isFinite(n) && n > seq) seq = n;
      // throttle the React update: seq changes on every frame
      if (!seqTimer) {
        seqTimer = setTimeout(() => {
          seqTimer = null;
          if (!closed) update((s) => (s.lastSeq === seq ? s : { ...s, lastSeq: seq }));
        }, 250);
      }
      return seq;
    };
    const parse = <T>(e: MessageEvent): T | null => {
      try {
        return JSON.parse(e.data) as T;
      } catch {
        return null;
      }
    };

    es.onopen = () => {
      if (closed) return;
      update({ state: "open", error: null });
      onOpen();
    };
    es.onerror = () => {
      if (closed) return;
      if (es.readyState === EventSource.CLOSED) update({ state: "error", error: "이벤트 스트림 연결이 끊어졌습니다" });
      else update({ state: "reconnecting" });
    };
    es.addEventListener("agent", (e) => {
      const s = noteSeq(e as MessageEvent);
      const data = parse<AgentActivityEvent>(e as MessageEvent);
      if (data) onAgent(data, s);
    });
    es.addEventListener("doc", (e) => {
      const s = noteSeq(e as MessageEvent);
      const data = parse<DocEvent>(e as MessageEvent);
      if (data) onDoc(data, s);
    });
    es.addEventListener("run", (e) => {
      const s = noteSeq(e as MessageEvent);
      const data = parse<{ status: RunStatus; error?: string }>(e as MessageEvent);
      if (!data) return;
      onRun(data, s);
      if (TERMINAL.includes(data.status)) {
        closed = true;
        es.close();
        update({ state: "closed", lastSeq: seq, runStatus: data.status, error: data.error ?? null });
      } else {
        update({ runStatus: data.status });
      }
    });

    return () => {
      closed = true;
      if (seqTimer) clearTimeout(seqTimer);
      es.close();
    };
  }, [runId]);

  if (!runId) return IDLE;
  if (!tracked || tracked.forRunId !== runId) return CONNECTING;
  return tracked;
}
