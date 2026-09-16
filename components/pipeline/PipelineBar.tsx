"use client";
import { ChevronRight } from "lucide-react";
import type { RunDTO, Stage } from "@/lib/contracts";
import { STAGES } from "@/lib/contracts";
import { StageCard } from "./StageCard";

export interface PipelineBarProps {
  projectId: string;
  runs: RunDTO[];
  activeRunIds: Partial<Record<Stage, string | null>>;
  hasDoc: Partial<Record<Stage, boolean>>;
}

export function PipelineBar({ projectId, runs, activeRunIds, hasDoc }: PipelineBarProps) {
  const latest = (s: Stage) => runs.find((r) => r.stage === s) ?? null;
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
      {STAGES.map((s, i) => {
        const prev = i === 0 ? null : STAGES[i - 1];
        const ready = i === 0 || (prev ? hasDoc[prev] === true || latest(prev)?.status === "succeeded" : false);
        return (
          <div key={s} className="flex flex-1 items-stretch gap-2">
            <StageCard projectId={projectId} stage={s} index={i} latestRun={latest(s)} active={!!activeRunIds[s]} hasDoc={hasDoc[s] ?? null} ready={ready} />
            {i < STAGES.length - 1 ? (
              <div className="hidden items-center text-slate-300 lg:flex">
                <ChevronRight className="h-5 w-5" />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
