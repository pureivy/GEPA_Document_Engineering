import { jsonError } from "@/lib/agents/http";
import { getRunManager } from "@/lib/agents/runManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const rm = getRunManager();
  const run = rm.getRun(runId);
  if (!run) return jsonError(404, "Run not found");
  let summary: unknown = null;
  if (run.summary) {
    try {
      summary = JSON.parse(run.summary);
    } catch {
      summary = run.summary;
    }
  }
  return Response.json({ run: { ...run, summary }, active: rm.isActive(runId) });
}
