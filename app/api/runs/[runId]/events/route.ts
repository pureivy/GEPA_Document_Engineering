import { jsonError } from "@/lib/agents/http";
import { getRunManager } from "@/lib/agents/runManager";
import { createRunEventStream, parseAfterSeq, SSE_HEADERS } from "@/lib/agents/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runs/:runId/events → text/event-stream
 * Replays persisted events after `Last-Event-ID` (or `?afterSeq=`), then streams live events.
 * Sends a `: ping` comment every 15 s and closes after the final `run` frame (the client must
 * call `EventSource.close()` on it). Returns 204 when a finished run has nothing new to send.
 */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const rm = getRunManager();
  if (!rm.getRun(runId)) return jsonError(404, "Run not found");
  const afterSeq = parseAfterSeq(req);
  // Finished run and the client already has everything (reconnect after the `run` frame):
  // 204 makes EventSource stop reconnecting instead of looping forever.
  if (!rm.isActive(runId) && afterSeq > 0 && rm.countEventsAfter(runId, afterSeq) === 0) {
    return new Response(null, { status: 204 });
  }
  const stream = createRunEventStream(runId, { afterSeq, signal: req.signal, manager: rm });
  return new Response(stream, { headers: SSE_HEADERS });
}
