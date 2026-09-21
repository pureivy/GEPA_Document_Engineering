import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { projects, type ProjectRow } from "@/lib/db/schema";
import { serializeProject } from "@/lib/db/serialize";
import { jsonError, readJsonBody } from "@/lib/agents/http";
import { ensureProjectDir } from "@/lib/storage/paths";
import { writeFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches `ProjectDTO.contact` in lib/contracts.ts; extra string keys are kept. */
const contactSchema = z
  .looseObject({
    부서명: z.string().trim().default(""),
    담당자: z.string().trim().optional(),
    전화: z.string().trim().default(""),
    이메일: z.string().trim().default(""),
    우편주소: z.string().trim().optional(),
  })
  .default({ 부서명: "", 전화: "", 이메일: "" });

const createSchema = z.object({
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
    kind: "program",
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
