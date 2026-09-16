import type { NextRequest } from "next/server";
import { pageSvg, renderManifest } from "@/lib/stages/service";
import type { Stage } from "@/lib/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  const page = Number(req.nextUrl.searchParams.get("page") ?? "0");
  let hash = req.nextUrl.searchParams.get("h") ?? req.nextUrl.searchParams.get("hash");
  if (!hash) {
    const m = await renderManifest(id, stage as Stage);
    if (!m) return new Response("not rendered", { status: 404 });
    hash = m.hash;
  }
  const svg = pageSvg(id, stage as Stage, hash, page);
  if (!svg) return new Response("page not found", { status: 404 });
  return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" } });
}
