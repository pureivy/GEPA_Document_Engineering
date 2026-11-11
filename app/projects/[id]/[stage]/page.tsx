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
  const p = serializeProject(row);
  const kind = p.kind;
  // 결과·정산 자체사업에는 정산보고서·제출 공문이 없다(lib/kinds.ts stagesOf)
  const stages = stagesOf(kind, p.contact.사업구분);
  if (!stages.includes(stage as Stage)) notFound();
  return (
    <div className="h-[calc(100vh-44px)] min-h-0">
      <StageRunner projectId={id} stage={stage as Stage} kind={kind} stages={stages} defaultModel={modelFor(stage as Stage)} />
    </div>
  );
}
