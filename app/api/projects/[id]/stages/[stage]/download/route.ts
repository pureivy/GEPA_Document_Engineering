import type { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { hwpxPath, pdfPath, readStageDoc, readStageDsl } from "@/lib/stages/service";
import { toText } from "@/lib/docmodel/serialize/toText";
import { toMarkdown } from "@/lib/docmodel/serialize/toMarkdown";
import type { Stage } from "@/lib/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fileName(base: string, ext: string): string {
  const safe = base.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return encodeURIComponent(`${safe}_${date}.${ext}`);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await ctx.params;
  const s = stage as Stage;
  const format = req.nextUrl.searchParams.get("format") ?? "hwpx";
  const doc = readStageDoc(id, s);
  const title = doc ? (doc.family === "notice" ? doc.meta.사업명 + "_공고문" : doc.family === "plan" ? doc.meta.제목 : doc.meta.제목 + "_보도자료") : `${id}_${s}`;
  if (format === "hwpx") {
    const p = hwpxPath(id, s);
    if (!p) return new Response("not exported", { status: 404 });
    return new Response(readFileSync(p), { headers: { "content-type": "application/hwp+zip", "content-disposition": `attachment; filename*=UTF-8''${fileName(title, "hwpx")}` } });
  }
  if (format === "pdf") {
    const p = pdfPath(id, s);
    if (!p) return new Response("pdf unavailable", { status: 404 });
    return new Response(readFileSync(p), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename*=UTF-8''${fileName(title, "pdf")}` } });
  }
  if (format === "dsl") {
    const t = readStageDsl(id, s) ?? "";
    return new Response(t, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${fileName(title, "dsl.md")}` } });
  }
  if (!doc) return new Response("no document", { status: 404 });
  if (format === "md") return new Response(toMarkdown(doc), { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${fileName(title, "md")}` } });
  if (format === "txt") return new Response(toText(doc), { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${fileName(title, "txt")}` } });
  return new Response("unknown format", { status: 400 });
}
