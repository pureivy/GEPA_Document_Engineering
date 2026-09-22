import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { serializeProject } from "@/lib/db/serialize";
import { type Stage } from "@/lib/contracts";
import { stagesOf } from "@/lib/kinds";
import { modelFor } from "@/lib/agents/limits";
import { StageRunner } from "@/components/stage/StageRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StagePage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get();
  if (!row) notFound();
  // 단계는 프로젝트 종류에서 파생된다 — 사업 프로젝트의 /official 도, 공문 프로젝트의 /plan 도 여기서 404 다
  const kind = serializeProject(row).kind;
  if (!stagesOf(kind).includes(stage as Stage)) notFound();
  return (
    <div className="h-[calc(100vh-44px)] min-h-0">
      <StageRunner projectId={id} stage={stage as Stage} kind={kind} defaultModel={modelFor(stage as Stage)} />
    </div>
  );
}
