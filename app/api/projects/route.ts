import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { projects, type ProjectRow } from "@/lib/db/schema";
import { serializeProject } from "@/lib/db/serialize";
import { jsonError, readJsonBody } from "@/lib/agents/http";
import { ensureProjectDir } from "@/lib/storage/paths";
import { isProjectKind } from "@/lib/kinds";
import { OfficialMetaSchema } from "@/lib/docmodel/schema";
import { writeFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Matches `ProjectDTO.contact` in lib/contracts.ts; extra string keys are kept.
 * 수신유형·수신·수신자는 공문(official) 전용 — `projects` 를 넓히지 않고 이 looseObject 에 얹는다
 * (스펙 §5.4 가 연락처와 같은 근거로 허용). program 프로젝트는 이 키들을 쓰지 않는다.
 */
const contactSchema = z
  .looseObject({
    부서명: z.string().trim().default(""),
    담당자: z.string().trim().optional(),
    전화: z.string().trim().default(""),
    이메일: z.string().trim().default(""),
    우편주소: z.string().trim().optional(),
    /** OfficialMetaSchema 의 수신유형과 같은 값 — 값 하나 두는 곳을 이 스키마로 통일해 둘이 갈라지지 않게 한다 */
    수신유형: OfficialMetaSchema.shape.수신유형.optional(),
    /** 수신유형=수신자 일 때의 수신 대상 */
    수신: z.string().trim().optional(),
    /** 수신유형=수신자참조 일 때의 수신자 목록 — 화면 입력 그대로(쉼표 구분 문자열); 배열로 바꾸는 것은 에이전트의 몫 */
    수신자: z.string().trim().optional(),
  })
  .default({ 부서명: "", 전화: "", 이메일: "" });

const createSchema = z.object({
  /** ProjectKind — 모르는 값은 거절하지 않고 "program" 으로 떨어뜨린다(아래 isProjectKind) */
  kind: z.string().trim().max(40).optional(),
  title: z.string().trim().min(1).max(200),
  topic: z.string().trim().min(1).max(2000),
  region: z.string().trim().max(200).default(""),
  organizer: z.string().trim().max(200).default(""),
  contact: contactSchema,
});

export async function GET() {
  const rows = getDb().select().from(projects).orderBy(desc(projects.createdAt)).all();
  return Response.json({ projects: rows.map(serializeProject) });
}

export async function POST(req: Request) {
  const body = await readJsonBody(req, createSchema);
  if (!body.ok) return body.response;
  const now = new Date().toISOString();
  const id = randomUUID();
  const row: ProjectRow = {
    id,
    kind: isProjectKind(body.data.kind) ? body.data.kind : "program",
    title: body.data.title,
    topic: body.data.topic,
    region: body.data.region,
    organizer: body.data.organizer,
    contact: JSON.stringify(body.data.contact),
    referenceName: null,
    referenceChanges: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    getDb().insert(projects).values(row).run();
    const dir = ensureProjectDir(id);
    writeFileSync(path.join(dir, "project.json"), JSON.stringify(serializeProject(row), null, 2), "utf8");
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : String(err));
  }
  return Response.json({ project: serializeProject(row) }, { status: 201 });
}
