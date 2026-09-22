import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { serializeProject } from "@/lib/db/serialize";
import { ProjectOverview } from "@/components/pipeline/ProjectOverview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get();
  if (!row) notFound();
  // 종류를 서버에서 실어 보낸다 — 첫 페인트부터 단계 수가 맞아 진행 막대가 흔들리지 않는다
  return <ProjectOverview projectId={id} kind={serializeProject(row).kind} />;
}
