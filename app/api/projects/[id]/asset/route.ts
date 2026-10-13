/**
 * 프로젝트 작업 폴더의 사진 파일 — 편집기의 사진 대지(```photos) 썸네일용.
 *   GET ?src=materials/images/… → 이미지 바이트
 * 폴더 밖 경로·이미지 아닌 파일은 404 (lib/closeout/photos.ts resolveAsset).
 */
import { resolveAsset } from "@/lib/closeout/photos";
import { jsonError } from "@/lib/agents/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const src = new URL(req.url).searchParams.get("src") ?? "";
  let a;
  try {
    a = resolveAsset(id, src);
  } catch {
    a = undefined;
  }
  if (!a) return jsonError(404, "그 사진이 없습니다");
  return new Response(Buffer.from(a.bytes), { headers: { "Content-Type": a.mediaType, "Cache-Control": "private, max-age=300" } });
}
