import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { jsonError, readJsonBody } from "@/lib/agents/http";
import { getRunManager, RunConflictError } from "@/lib/agents/runManager";
import { isRunStage } from "@/lib/agents/runner";
import { MODEL_ALIASES } from "@/lib/agents/limits";
import { prepareStage, SCAN_STAGES, startStageRun } from "@/lib/stages/runIntegration";
import { scanBacklog, startScanPending } from "@/lib/closeout/scanPdf";
import { KIND_LABEL, stagesOf } from "@/lib/kinds";
import { serializeProject } from "@/lib/db/serialize";
import { isDocStage, STAGES, type Stage } from "@/lib/contracts";

/**
 * 검토할 수 있는 단계 = 문서를 만드는 단계 전부. 손으로 나열하던 때는 업무보고(report)가 빠져
 * 업무보고의 검토 버튼이 400 을 받았다 — STAGE_FAMILY 에서 파생해 새 문서 단계가 조용히 빠지지 않게 한다.
 */
const REVIEW_TARGETS = STAGES.filter(isDocStage) as [Stage, ...Stage[]];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** follow-up instruction for a resumed run ("이어서 수정 요청") */
  instruction: z.string().trim().max(20_000).optional(),
  resume: z.boolean().optional(),
  /** for stage=review: which stage's document to review */
  reviewTarget: z.enum(REVIEW_TARGETS).optional(),
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
  // 스캔 PDF 글자 인식이 남았으면 시작하지 않는다 — 십여 분 걸릴 수 있어 이 요청을 붙잡아 둘 수 없다(인식은 뒤에서 계속)
  if (project.kind === "closeout" && SCAN_STAGES.has(stage) && !resumeSessionId) {
    const { pending, running } = scanBacklog(id);
    if (pending > 0 || running) {
      void startScanPending(id).catch((e) => console.error("[run] 글자 인식 실패:", e));
      return jsonError(409, `스캔 PDF 글자 인식 중입니다(남은 자료 ${pending}개). 끝난 뒤 다시 실행하세요 — 한 쪽에 1초 남짓 걸립니다`);
    }
  }
  try {
    if (stage !== "review") await prepareStage(project, stage, !!resumeSessionId);
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
