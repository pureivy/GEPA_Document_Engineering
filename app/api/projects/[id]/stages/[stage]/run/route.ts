import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { jsonError, readJsonBody } from "@/lib/agents/http";
import { getRunManager, RunConflictError } from "@/lib/agents/runManager";
import { isRunStage } from "@/lib/agents/runner";
import { MODEL_ALIASES } from "@/lib/agents/limits";
import { startStageRun } from "@/lib/stages/runIntegration";
import { KIND_LABEL, stagesOf } from "@/lib/kinds";
import { serializeProject } from "@/lib/db/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** follow-up instruction for a resumed run ("이어서 수정 요청") */
  instruction: z.string().trim().max(20_000).optional(),
  resume: z.boolean().optional(),
  /** for stage=review: which stage's document to review */
  reviewTarget: z.enum(["plan", "notice", "press", "official"]).optional(),
  /** model alias for this run; defaults to the stage's configured model */
  model: z.enum(MODEL_ALIASES).optional(),
  /** start the following stages automatically when this one succeeds (research → plan → notice → press) */
  autoChain: z.boolean().optional(),
  /** plan: allow 보충 조사 (Task/WebSearch/WebFetch, max 2) */
  supplementalResearch: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  if (!isRunStage(stage)) return jsonError(400, `Unknown stage: ${stage}`);
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  const project = serializeProject(row);
  // 단계는 프로젝트 종류에 속해야 한다. 화면은 stagesOf 로 404 를 내지만 이 라우트를 직접 POST 하면
  // 사업 프로젝트 안에 공문이 생길 수 있었다. `review` 는 어느 kind 의 목록에도 없고 문서 단계에 덧붙는
  // 별도 실행이므로 통과시킨다(검토 대상은 body.reviewTarget 이 정한다).
  if (stage !== "review" && !stagesOf(project.kind).includes(stage)) {
    return jsonError(404, `${KIND_LABEL[project.kind]} 프로젝트에는 ${stage} 단계가 없습니다`);
  }
  const body = await readJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  const rm = getRunManager();

  let resumeSessionId: string | undefined;
  if (body.data.resume) {
    const last = rm.latestRun(id, stage);
    if (!last?.sessionId) return jsonError(409, "이어서 진행할 이전 실행이 없습니다");
    resumeSessionId = last.sessionId;
  }
  try {
    const { runId, sessionId } = startStageRun({
      project,
      stage,
      instruction: body.data.instruction,
      reviewTarget: body.data.reviewTarget,
      resumeSessionId,
      model: body.data.model,
      autoChain: body.data.autoChain,
      supplementalResearch: body.data.supplementalResearch,
    });
    return Response.json({ runId, sessionId, stage, projectId: id, resumed: !!resumeSessionId }, { status: 202 });
  } catch (err) {
    if (err instanceof RunConflictError) return jsonError(409, err.message, { activeRunId: err.activeRunId });
    return jsonError(500, err instanceof Error ? err.message : String(err));
  }
}
