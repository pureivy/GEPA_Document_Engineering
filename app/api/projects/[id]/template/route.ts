/**
 * GET — 양식 맞춰 쓰기 화면이 읽는 것: 바뀐 곳 표(changes.md), 지시·답 기록, 양식·참고 파일 이름.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { serializeProject } from "@/lib/db/serialize";
import { jsonError } from "@/lib/agents/http";
import { projectDir } from "@/lib/storage/paths";
import { readChangesMarkdown, readDialog, templateFileName } from "@/lib/template/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  const project = serializeProject(row);
  const dir = projectDir(id);
  const names = project.reference?.fileNames?.length ? project.reference.fileNames : project.reference?.fileName ? [project.reference.fileName] : [];
  return Response.json({ template: templateFileName(project), references: names.slice(1), changes: readChangesMarkdown(dir), dialog: readDialog(dir) });
}
