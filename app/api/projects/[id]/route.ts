import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { jsonError, readJsonBody } from "@/lib/agents/http";
import { getRunManager } from "@/lib/agents/runManager";
import { RUN_STAGES, type RunStage } from "@/lib/agents/runner";
import { serializeProject } from "@/lib/db/serialize";
import { projectDir } from "@/lib/storage/paths";
import { existsSync, writeFileSync } from "node:fs";
import path, { dirname } from "node:path";
import { z } from "zod";
import { removeSync } from "@/lib/fsSafe";
import { FUNDING_TYPES, TEMPLATE_MODES } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  const rm = getRunManager();
  const runs = rm.listRunsForProject(id);
  const stages: Record<RunStage, { latestRun: (typeof runs)[number] | null; activeRunId: string | null }> = {} as never;
  for (const stage of RUN_STAGES) {
    stages[stage] = {
      latestRun: runs.find((r) => r.stage === stage) ?? null,
      activeRunId: rm.activeRunFor(id, stage) ?? null,
    };
  }
  return Response.json({ project: serializeProject(row), stages, runs });
}

const patchSchema = z
  .object({
    /** 결과·정산 사업 구분(수탁|자체) — 만든 뒤 잘못 골랐을 때 바꾼다. 단계 목록이 따라 바뀐다(lib/kinds.ts stagesOf) */
    사업구분: z.enum(FUNDING_TYPES).optional(),
    /** 양식 맞춰 쓰기의 쓰임(고쳐 쓰기|새로 쓰기) — 다음 실행부터 지시가 바뀐다 */
    양식쓰임: z.enum(TEMPLATE_MODES).optional(),
  })
  .refine((b) => !!b.사업구분 !== !!b.양식쓰임, { message: "사업구분과 양식쓰임 중 하나만 보냅니다" });

/**
 * 프로젝트 설정 바꾸기 — 결과·정산의 사업 구분, 양식 맞춰 쓰기의 쓰임.
 * contact 의 진짜는 DB 다(lib/closeout/store.ts) — project.json 도 같이 고쳐 둘이 갈라지지 않게 한다.
 * 이미 만든 문서(정산보고서·공문 등)는 지우지 않는다: 자체로 바꾸면 그 단계가 안 보일 뿐이고, 되돌리면 다시 보인다.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readJsonBody(req, patchSchema);
  if (!body.ok) return body.response;
  const db = getDb();
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  if (body.data.사업구분 && row.kind !== "closeout") return jsonError(400, "사업 구분은 결과·정산 프로젝트에만 있습니다.");
  if (body.data.양식쓰임 && row.kind !== "template") return jsonError(400, "양식 쓰임은 양식 맞춰 쓰기 프로젝트에만 있습니다.");
  const rm = getRunManager();
  const active = RUN_STAGES.map((s) => rm.activeRunFor(id, s)).find(Boolean);
  if (active) return jsonError(409, "실행 중인 단계가 있어 바꿀 수 없습니다. 끝난 뒤 바꾸세요.", { activeRunId: active });

  let contact: Record<string, unknown> = {};
  try {
    contact = JSON.parse(row.contact) as Record<string, unknown>;
  } catch {
    contact = {};
  }
  if (body.data.사업구분) contact.사업구분 = body.data.사업구분;
  if (body.data.양식쓰임) contact.양식쓰임 = body.data.양식쓰임;
  const now = new Date().toISOString();
  db.update(projects).set({ contact: JSON.stringify(contact), updatedAt: now }).where(eq(projects.id, id)).run();
  const updated = db.select().from(projects).where(eq(projects.id, id)).get()!;
  const file = path.join(projectDir(id), "project.json");
  if (existsSync(dirname(file))) writeFileSync(file, JSON.stringify(serializeProject(updated), null, 2), "utf8");
  return Response.json({ project: serializeProject(updated) });
}

/** Delete a project: its runs/versions (DB cascade) and its files under DATA_DIR/projects/<id>. Refused while a run is active. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  const rm = getRunManager();
  const active = RUN_STAGES.map((s) => rm.activeRunFor(id, s)).find(Boolean);
  if (active) return jsonError(409, "실행 중인 단계가 있어 삭제할 수 없습니다. 먼저 중지하세요.", { activeRunId: active });
  db.delete(projects).where(eq(projects.id, id)).run();
  const dir = projectDir(id);
  if (existsSync(dir)) removeSync(dir);
  return Response.json({ ok: true, id });
}
