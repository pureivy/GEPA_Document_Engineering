import { restoreVersion } from "@/lib/stages/service";
import type { Stage } from "@/lib/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  const { seq } = (await req.json()) as { seq: number };
  const doc = restoreVersion(id, stage as Stage, Number(seq));
  return doc ? Response.json({ ok: true, doc }) : Response.json({ error: "version not found" }, { status: 404 });
}
