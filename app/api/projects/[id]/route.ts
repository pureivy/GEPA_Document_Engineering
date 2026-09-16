import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { jsonError } from "@/lib/agents/http";
import { getRunManager } from "@/lib/agents/runManager";
import { STAGES, type Stage } from "@/lib/agents/runner";
import { serializeProject } from "@/lib/db/serialize";
import { projectDir } from "@/lib/storage/paths";
import { existsSync, rmSync } from "node:fs";

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

/** Delete a project: its runs/versions (DB cascade) and its files under DATA_DIR/projects/<id>. Refused while a run is active. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  const rm = getRunManager();
  const active = [...STAGES, "review" as const].map((s) => rm.activeRunFor(id, s as Stage)).find(Boolean);
  if (active) return jsonError(409, "실행 중인 단계가 있어 삭제할 수 없습니다. 먼저 중지하세요.", { activeRunId: active });
  db.delete(projects).where(eq(projects.id, id)).run();
  const dir = projectDir(id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  return Response.json({ ok: true, id });
}
