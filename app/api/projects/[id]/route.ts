import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { jsonError } from "@/lib/agents/http";
import { getRunManager } from "@/lib/agents/runManager";
import { STAGES, type Stage } from "@/lib/agents/runner";
import { serializeProject } from "@/lib/db/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  const rm = getRunManager();
  const runs = rm.listRunsForProject(id);
  const stages: Record<Stage, { latestRun: (typeof runs)[number] | null; activeRunId: string | null }> = {} as never;
  for (const stage of STAGES) {
    stages[stage] = {
      latestRun: runs.find((r) => r.stage === stage) ?? null,
      activeRunId: rm.activeRunFor(id, stage) ?? null,
    };
  }
  return Response.json({ project: serializeProject(row), stages, runs });
}
