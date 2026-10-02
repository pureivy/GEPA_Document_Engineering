/**
 * 정산·결과보고 자료함.
 *   GET                       → { materials }
 *   POST multipart `files`(여러 개) → 저장·텍스트 변환, { materials, errors }
 *   DELETE ?name=<파일명>     → 한 파일 삭제
 * 변환에 실패한 파일은 저장하지 않고 errors 로 돌려준다 — 나머지 파일은 그대로 받는다.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { jsonError } from "@/lib/agents/http";
import { deleteMaterial, isZipName, listMaterials, saveMaterial, saveZipMaterials } from "@/lib/closeout/materials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function exists(id: string): boolean {
  return !!getDb().select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!exists(id)) return jsonError(404, "Project not found");
  return Response.json({ materials: listMaterials(id) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!exists(id)) return jsonError(404, "Project not found");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "multipart/form-data 요청이 필요합니다");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return jsonError(400, "files 필드가 없습니다");
  const errors: { name: string; message: string }[] = [];
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      // 압축 파일은 풀어서 안의 자료를 하나씩 저장한다(zip 자체는 남기지 않는다)
      if (isZipName(f.name)) errors.push(...saveZipMaterials(id, f.name, bytes).errors);
      else saveMaterial(id, f.name, bytes);
    } catch (e) {
      errors.push({ name: f.name, message: (e as Error).message });
    }
  }
  return Response.json({ materials: listMaterials(id), errors }, { status: errors.length === files.length ? 422 : 201 });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!exists(id)) return jsonError(404, "Project not found");
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return jsonError(400, "name 이 필요합니다");
  if (!deleteMaterial(id, name)) return jsonError(404, "그 자료가 없습니다");
  return Response.json({ materials: listMaterials(id) });
}
