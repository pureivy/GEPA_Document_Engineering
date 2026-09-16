import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { jsonError, readJsonBody } from "@/lib/agents/http";
import { getRunManager, RunConflictError } from "@/lib/agents/runManager";
import { isStage } from "@/lib/agents/runner";
import { MODEL_ALIASES } from "@/lib/agents/limits";
import { startStageRun } from "@/lib/stages/runIntegration";
import { serializeProject } from "@/lib/db/serialize";
import type { Stage } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** follow-up instruction for a resumed run ("이어서 수정 요청") */
  instruction: z.string().trim().max(20_000).optional(),
  resume: z.boolean().optional(),
  /** for stage=review: which stage's document to review */
  reviewTarget: z.enum(["plan", "notice", "press"]).optional(),
  /** model alias for this run; defaults to the stage's configured model */
  model: z.enum(MODEL_ALIASES).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  if (!isStage(stage)) return jsonError(400, `Unknown stage: ${stage}`);
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  const body = await readJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  const rm = getRunManager();

  let resumeSessionId: string | undefined;
  if (body.data.resume) {
    const last = rm.latestRun(id, stage);
    if (!last?.sessionId) return jsonError(409, "이어서 진행할 이전 실행이 없습니다");
    resumeSessionId = last.sessionId;
  }
  const project = serializeProject(row);
  try {
    const { runId, sessionId } = startStageRun({
      project,
      stage: stage as Stage | "review",
      instruction: body.data.instruction,
      reviewTarget: body.data.reviewTarget,
      resumeSessionId,
      model: body.data.model,
    });
    return Response.json({ runId, sessionId, stage, projectId: id, resumed: !!resumeSessionId }, { status: 202 });
  } catch (err) {
    if (err instanceof RunConflictError) return jsonError(409, err.message, { activeRunId: err.activeRunId });
    return jsonError(500, err instanceof Error ? err.message : String(err));
  }
}
