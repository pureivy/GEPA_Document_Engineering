import { notFound } from "next/navigation";
import { STAGES, type Stage } from "@/lib/contracts";
import { modelFor } from "@/lib/agents/limits";
import { StageRunner } from "@/components/stage/StageRunner";

export default async function StagePage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  if (!STAGES.includes(stage as Stage)) notFound();
  return (
    <div className="h-[calc(100vh-44px)] min-h-0">
      <StageRunner projectId={id} stage={stage as Stage} defaultModel={modelFor(stage as Stage)} />
    </div>
  );
}
