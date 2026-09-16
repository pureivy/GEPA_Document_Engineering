import { jsonError } from "@/lib/agents/http";
import { getRunManager } from "@/lib/agents/runManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const rm = getRunManager();
  const run = rm.getRun(runId);
  if (!run) return jsonError(404, "Run not found");
  const cancelled = rm.cancelRun(runId);
  if (!cancelled) return jsonError(409, "Run is not active", { status: run.status });
  return Response.json({ cancelled: true, runId });
}
