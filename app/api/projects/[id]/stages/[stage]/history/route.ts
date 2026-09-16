import { listVersions } from "@/lib/stages/service";
import type { Stage } from "@/lib/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  return Response.json({ versions: listVersions(id, stage as Stage) });
}
