/**
 * Dev-only: start a stage run driven by a synthetic stream-json fixture (no `claude` process).
 * Enabled only when GEPA_DEV_REPLAY=1 and not in production — the Playwright e2e suite uses it
 * to exercise SSE → typing → save → export → render without spending any agent quota.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { serializeProject } from "@/lib/db/serialize";
import { jsonError, readJsonBody } from "@/lib/agents/http";
import { ReplayRunner } from "@/lib/agents/replayRunner";
import { replayFixture, writerRunLines } from "@/lib/agents/replayFixtures";
import { existsSync, readFileSync } from "node:fs";
import { RunConflictError } from "@/lib/agents/runManager";
import { startStageRun } from "@/lib/stages/runIntegration";
import { stageDir } from "@/lib/stages/service";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  projectId: z.string().min(1),
  stage: z.enum(["plan", "notice", "press"]).default("notice"),
  /** "draft" replays the stage's existing draft.dsl.md as a synthetic writer run (교육 영상·데모용) */
  fixture: z.enum(["notice-golden", "notice-double", "draft"]).default("notice-golden"),
  /** ms between replayed lines (default 4: fast but still incremental over SSE) */
  delayMs: z.number().int().min(0).max(200).default(4),
});

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.GEPA_DEV_REPLAY !== "1") return jsonError(404, "Not found");
  const body = await readJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  const row = getDb().select().from(projects).where(eq(projects.id, body.data.projectId)).get();
  if (!row) return jsonError(404, "Project not found");
  const filePath = join(stageDir(body.data.projectId, body.data.stage), "draft.dsl.md");
  let lines: string[];
  if (body.data.fixture === "draft") {
    if (!existsSync(filePath)) return jsonError(404, `${body.data.stage}/draft.dsl.md not found`);
    lines = writerRunLines(filePath, [readFileSync(filePath, "utf8")], `replay-${body.data.stage}`);
  } else lines = replayFixture(body.data.fixture, filePath);
  try {
    const res = startStageRun({ project: serializeProject(row), stage: body.data.stage, runner: new ReplayRunner(lines, { delayMs: body.data.delayMs }) });
    return Response.json({ ...res, lines: lines.length }, { status: 202 });
  } catch (err) {
    if (err instanceof RunConflictError) return jsonError(409, err.message, { activeRunId: err.activeRunId });
    return jsonError(500, err instanceof Error ? err.message : String(err));
  }
}
