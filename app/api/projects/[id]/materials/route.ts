/**
 * 정산·결과보고 자료함.
 *   GET                       → { materials }
 *   POST multipart `files`(여러 개) → 저장·텍스트 변환, { materials, errors }
 *   DELETE ?name=<파일명>     → 한 파일 삭제
 * `?box=prior` 를 붙이면 전년도 참고자료함(`prior/`)을 다룬다 — 원장·금액 대조·사진에 섞이지 않는 따로 된 자료함.
 * 변환에 실패한 파일은 저장하지 않고 errors 로 돌려준다 — 나머지 파일은 그대로 받는다.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { jsonError } from "@/lib/agents/http";
import { deleteMaterial, isMaterialBox, isZipName, listMaterials, saveMaterial, saveZipMaterials, type MaterialBox } from "@/lib/closeout/materials";
import { startScanPending } from "@/lib/closeout/scanPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boxOf(req: Request): MaterialBox | null {
  const v = new URL(req.url).searchParams.get("box") ?? "materials";
  return isMaterialBox(v) ? v : null;
}

function exists(id: string): boolean {
  return !!getDb().select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!exists(id)) return jsonError(404, "Project not found");
  const box = boxOf(req);
  if (!box) return jsonError(400, "box 는 materials 또는 prior 입니다");
  return Response.json({ materials: listMaterials(id, box) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!exists(id)) return jsonError(404, "Project not found");
  const box = boxOf(req);
  if (!box) return jsonError(400, "box 는 materials 또는 prior 입니다");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "multipart/form-data 요청이 필요합니다");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return jsonError(400, "files 필드가 없습니다");
  const errors: { name: string; message: string }[] = [];
  let saved = 0;
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      // 압축 파일은 풀어서 안의 자료를 하나씩 저장한다(zip 자체는 남기지 않는다)
      if (isZipName(f.name)) {
        const z = saveZipMaterials(id, f.name, bytes, box);
        errors.push(...z.errors);
        saved += z.saved.length;
      } else {
        saveMaterial(id, f.name, bytes, box);
        saved += 1;
      }
    } catch (e) {
      errors.push({ name: f.name, message: (e as Error).message });
    }
  }
  // 스캔 PDF 는 뒤에서 글자 인식한다(한 쪽 1초 남짓 — 업로드 응답을 붙잡지 않는다)
  if (saved > 0 && box === "materials") void startScanPending(id).catch((e) => console.error("[materials] 글자 인식 실패:", e));
  // 하나라도 저장했으면 성공이다 — zip 안의 카드뉴스(html) 하나 때문에 51개를 받은 요청이 실패로 보이면 안 된다
  return Response.json({ materials: listMaterials(id, box), errors, saved }, { status: saved > 0 ? 201 : 422 });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!exists(id)) return jsonError(404, "Project not found");
  const box = boxOf(req);
  if (!box) return jsonError(400, "box 는 materials 또는 prior 입니다");
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return jsonError(400, "name 이 필요합니다");
  if (!deleteMaterial(id, name, box)) return jsonError(404, "그 자료가 없습니다");
  return Response.json({ materials: listMaterials(id, box) });
}
