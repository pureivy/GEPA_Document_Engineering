/**
 * POST multipart: `file` (.hwpx/.hwp/.docx/.md/.txt — 기존 사업계획서), `changes` (text),
 * `autoRun` ("1" → start the pipeline: research with autoChain).
 * Stores the file under projects/<id>/reference/, writes reference/base-plan.md (extracted text)
 * and records the file name / changes on the project.
 */
import { eq } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { serializeProject } from "@/lib/db/serialize";
import { jsonError } from "@/lib/agents/http";
import { RunConflictError } from "@/lib/agents/runManager";
import { startStageRun } from "@/lib/stages/runIntegration";
import { KIND_LABEL, isProjectKind, stagesOf } from "@/lib/kinds";
import { projectDir } from "@/lib/storage/paths";
import { extractReferenceText, referenceMarkdown, referenceExtension, REFERENCE_EXTENSIONS } from "@/lib/reference/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "multipart/form-data 요청이 필요합니다");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "file 필드(기존 사업계획서)가 없습니다");
  if (file.size > MAX_BYTES) return jsonError(413, "파일이 너무 큽니다 (30MB 이하)");
  const safeName = basename(file.name).replace(/[\\/:*?"<>|]/g, "_");
  if (!referenceExtension(safeName)) return jsonError(400, `지원하지 않는 파일 형식입니다 (${REFERENCE_EXTENSIONS.join(", ")})`);
  const changes = String(form.get("changes") ?? "").trim().slice(0, 20_000);
  const autoRun = String(form.get("autoRun") ?? "") === "1";
  const supplementalResearch = String(form.get("supplementalResearch") ?? "") === "1";

  // run route(app/api/projects/[id]/stages/[stage]/run/route.ts:39)와 같은 kind 게이트 — 이 라우트를
  // 직접 POST 하면(autoRun=1) 공문 프로젝트 안에도 research 실행이 생길 수 있었다.
  if (autoRun) {
    const kind = isProjectKind(row.kind) ? row.kind : "program";
    if (!stagesOf(kind).includes("research")) {
      return jsonError(404, `${KIND_LABEL[kind]} 프로젝트에는 research 단계가 없습니다`);
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let extracted: { text: string; truncated: boolean };
  try {
    extracted = extractReferenceText(safeName, bytes);
  } catch (e) {
    return jsonError(422, (e as Error).message);
  }
  const dir = join(projectDir(id), "reference");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, safeName), bytes);
  // 공문에 붙인 문서는 용도대로 자기를 소개해야 한다 — 에이전트가 여는 파일이 "기존 사업계획서"라고
  // 적혀 있으면 프롬프트를 공문용으로 갈라 놓아도 소용이 없다. 용도는 프로젝트를 만들 때 이미
  // contact 에 실려 저장되고(화면이 createProject → uploadReference 순으로 부른다) 여기서 읽기만 한다.
  const role = row.kind === "official" ? serializeProject(row).contact.참고문서용도 : undefined;
  writeFileSync(join(dir, "base-plan.md"), referenceMarkdown(safeName, changes, extracted.text, role), "utf8");
  const now = new Date().toISOString();
  db.update(projects).set({ referenceName: safeName, referenceChanges: changes, updatedAt: now }).where(eq(projects.id, id)).run();
  const updated = db.select().from(projects).where(eq(projects.id, id)).get()!;
  const project = serializeProject(updated);
  writeFileSync(join(projectDir(id), "project.json"), JSON.stringify(project, null, 2), "utf8");

  let run: { runId: string; sessionId: string } | null = null;
  if (autoRun) {
    try {
      run = startStageRun({ project, stage: "research", autoChain: true, supplementalResearch });
    } catch (err) {
      if (err instanceof RunConflictError) return jsonError(409, err.message, { activeRunId: err.activeRunId, project });
      return jsonError(500, err instanceof Error ? err.message : String(err));
    }
  }
  return Response.json({ project, chars: extracted.text.length, truncated: extracted.truncated, run }, { status: 201 });
}
