import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { serializeProject } from "@/lib/db/serialize";
import { ProjectOverview } from "@/components/pipeline/ProjectOverview";
import { stagesOf } from "@/lib/kinds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get();
  if (!row) notFound();
  // 종류를 서버에서 실어 보낸다 — 첫 페인트부터 단계 수가 맞아 진행 막대가 흔들리지 않는다
  // 단계 목록도 서버에서 정한다 — 결과·정산은 사업 구분(수탁|자체)에 따라 단계가 다르다
  const p = serializeProject(row);
  return <ProjectOverview projectId={id} kind={p.kind} stages={stagesOf(p.kind, p.contact.사업구분)} />;
}
