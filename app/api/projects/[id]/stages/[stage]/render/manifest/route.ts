import { renderManifest } from "@/lib/stages/service";
import type { Stage } from "@/lib/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  const m = await renderManifest(id, stage as Stage);
  return m ? Response.json(m) : Response.json({ pages: 0, hash: null }, { status: 404 });
}
