import type { NextRequest } from "next/server";
import { DocModelSchema } from "@/lib/docmodel/schema";
import { readStageDoc, readStageDsl, readResearchNotes, saveStageDoc, saveStageDsl, listVersions } from "@/lib/stages/service";
import { toDsl } from "@/lib/docmodel/serialize/toDsl";
import type { Stage } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  const s = stage as Stage;
  if (s === "research") return Response.json({ markdown: readResearchNotes(id) });
  const format = req.nextUrl.searchParams.get("format");
  const doc = readStageDoc(id, s);
  const version = listVersions(id, s)[0]?.seq ?? 0;
  if (format === "dsl") return new Response(readStageDsl(id, s) ?? (doc ? toDsl(doc) : ""), { headers: { "content-type": "text/markdown; charset=utf-8" } });
  return Response.json({ doc, version });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  const s = stage as Stage;
  const body = (await req.json()) as { doc?: unknown; dsl?: string };
  if (typeof body.dsl === "string") {
    const r = saveStageDsl(id, s, body.dsl, "user");
    return Response.json({ version: r.version, warnings: r.warnings, doc: r.doc });
  }
  const parsed = DocModelSchema.safeParse(body.doc);
  if (!parsed.success) return Response.json({ error: "invalid DocModel", issues: parsed.error.issues.slice(0, 20) }, { status: 400 });
  const version = saveStageDoc(id, s, parsed.data, "user");
  return Response.json({ version });
}
