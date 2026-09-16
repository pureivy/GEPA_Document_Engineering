import { exportStage, currentReport } from "@/lib/stages/service";
import type { Stage } from "@/lib/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  try {
    const report = await exportStage(id, stage as Stage);
    if (!report) return Response.json({ error: "no document for this stage" }, { status: 404 });
    return Response.json(report);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  const report = currentReport(id, stage as Stage);
  return report ? Response.json(report) : Response.json({ error: "not exported yet" }, { status: 404 });
}
