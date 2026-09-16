/**
 * Server-Sent Events helpers for run frame streams (format per lib/contracts.ts `SseFrame`):
 *
 *   id: <seq>
 *   event: agent | doc | run
 *   data: <json>
 *
 * Heartbeats are SSE comments (`: ping`). The stream closes after the `run` frame.
 */
import type { RunFrame } from "./runner";
import { getRunManager, type RunManager } from "./runManager";

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function encodeFrame(frame: RunFrame): string {
  return `id: ${frame.seq}\nevent: ${frame.kind}\ndata: ${JSON.stringify(frame.data)}\n\n`;
}

export function encodeComment(text = "ping"): string {
  return `: ${text}\n\n`;
}

export interface RunEventStreamOptions {
  afterSeq?: number;
  heartbeatMs?: number;
  /** Request abort signal: closes the stream when the client disconnects. */
  signal?: AbortSignal;
  manager?: RunManager;
}

/**
 * ReadableStream of SSE frames for a run: replay persisted frames after `afterSeq`, then live
 * frames, without losing frames that arrive between the DB read and the subscription.
 */
export function createRunEventStream(runId: string, options: RunEventStreamOptions = {}): ReadableStream<Uint8Array> {
  const manager = options.manager ?? getRunManager();
  const afterSeq = Math.max(0, Math.floor(options.afterSeq ?? 0));
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const encoder = new TextEncoder();

  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    if (onAbort && options.signal) options.signal.removeEventListener("abort", onAbort);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const closeController = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const write = (text: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };
      const finish = () => {
        cleanup();
        closeController();
      };

      if (options.signal) {
        if (options.signal.aborted) {
          finish();
          return;
        }
        onAbort = finish;
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      // 1) subscribe first, buffering live frames while replaying
      let lastSeq = afterSeq;
      let replaying = true;
      let sawRunFrame = false;
      const buffer: RunFrame[] = [];
      const deliver = (frame: RunFrame) => {
        if (closed || frame.seq <= lastSeq) return;
        lastSeq = frame.seq;
        if (!write(encodeFrame(frame))) return;
        if (frame.kind === "run") {
          sawRunFrame = true;
          finish();
        }
      };
      const wasActive = manager.isActive(runId);
      unsubscribe = manager.subscribe(runId, (frame) => {
        if (replaying) buffer.push(frame);
        else deliver(frame);
      });

      // 2) replay from the DB
      write(encodeComment(`replay after ${afterSeq}`));
      for (const frame of manager.listEvents(runId, afterSeq)) {
        deliver(frame);
        if (closed) return;
      }

      // 3) flush frames buffered during replay
      replaying = false;
      for (const frame of buffer.splice(0)) {
        deliver(frame);
        if (closed) return;
      }

      // Not active (finished, or died with a previous server instance): nothing more will come.
      if (!wasActive && !manager.isActive(runId)) {
        // Every stream must end with exactly one `run` frame so the client knows to close.
        // A run orphaned by a server restart never persisted one → synthesize from the row.
        if (!sawRunFrame) {
          const row = manager.getRun(runId);
          const status = row && row.status !== "running" ? row.status : "failed";
          const error = row?.error ?? (row ? undefined : "run not found");
          deliver({
            seq: lastSeq + 1,
            ts: row?.endedAt ?? new Date().toISOString(),
            kind: "run",
            data: { status, ...(error ? { error } : {}) },
          });
        }
        finish();
        return;
      }

      heartbeat = setInterval(() => write(encodeComment()), heartbeatMs);
      heartbeat.unref?.();
    },
    cancel() {
      cleanup();
    },
  });
}

/** `Last-Event-ID` header (auto-reconnect) or `?afterSeq=` query (first connect). */
export function parseAfterSeq(req: Request): number {
  const header = req.headers.get("last-event-id");
  const url = new URL(req.url);
  const query = url.searchParams.get("afterSeq") ?? url.searchParams.get("after");
  const raw = header ?? query ?? "0";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
