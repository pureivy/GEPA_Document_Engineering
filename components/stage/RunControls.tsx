"use client";
import { useEffect, useState } from "react";
import { FastForward, MessageSquarePlus, Play, Square } from "lucide-react";
import type { RunDTO, RunStatus } from "@/lib/contracts";
import { formatDuration, RUN_STATUS_LABEL } from "@/lib/client/format";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select, Textarea } from "@/components/ui/input";

const STATUS_TONE: Record<RunStatus, BadgeTone> = { running: "running", succeeded: "success", failed: "danger", cancelled: "warning" };

/** models offered in the run controls (CLI aliases); haiku is env-only */
const MODEL_OPTIONS = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
];

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
const SAVE_LABEL: Record<SaveState, string> = { idle: "", dirty: "수정됨", saving: "저장 중…", saved: "저장됨", error: "저장 오류" };
const SAVE_TONE: Record<SaveState, BadgeTone> = { idle: "neutral", dirty: "warning", saving: "info", saved: "success", error: "danger" };

export interface RunControlsProps {
  run: RunDTO | null;
  status: RunStatus | null;
  running: boolean;
  turns: number | null;
  startedAt: string | null;
  canResume: boolean;
  hasDoc: boolean;
  busy: boolean;
  typingBacklog: number;
  saveState: SaveState;
  saveError: string | null;
  /** model for the next run (per-run override) and the stage's configured default */
  model: string;
  defaultModel: string;
  onModelChange: (model: string) => void;
  onRun: () => void;
  onCancel: () => void;
  onResume: (instruction: string) => void;
  onSkipAnimation: () => void;
}

function useElapsed(startedAt: string | null, running: boolean, endedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const end = running ? now : endedAt ? new Date(endedAt).getTime() : now;
  return Math.max(0, end - start);
}

export function RunControls(p: RunControlsProps) {
  const [resumeOpen, setResumeOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const elapsed = useElapsed(p.startedAt, p.running, p.run?.endedAt ?? null);
  const knownModel = MODEL_OPTIONS.some((o) => o.value === p.model);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      {p.running ? (
        <Button variant="danger" size="sm" onClick={p.onCancel} loading={p.busy}>
          <Square className="h-3.5 w-3.5" /> 중지
        </Button>
      ) : (
        <Button variant="primary" size="sm" onClick={p.onRun} loading={p.busy} title={p.hasDoc ? "처음부터 다시 작성합니다" : "에이전트 실행"}>
          <Play className="h-3.5 w-3.5" /> {p.hasDoc ? "다시 실행" : "실행"}
        </Button>
      )}
      <Select
        aria-label="실행 모델"
        className="h-8 w-auto py-0 text-xs"
        value={knownModel ? p.model : "__custom"}
        disabled={p.running || p.busy}
        onChange={(e) => p.onModelChange(e.target.value)}
        title={`이 단계의 실행 모델 (기본: ${p.defaultModel}). Sonnet은 구독 사용량을 훨씬 적게 씁니다`}
      >
        {MODEL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {o.value === p.defaultModel ? " (기본)" : ""}
          </option>
        ))}
        {/* an env-configured model id that is not an alias: shown, not selectable */}
        {knownModel ? null : (
          <option value="__custom" disabled>
            {p.model}
          </option>
        )}
      </Select>
      <Button variant="outline" size="sm" disabled={p.running || !p.canResume || p.busy} onClick={() => setResumeOpen(true)} title={p.canResume ? "이전 세션을 이어서 수정 요청을 전달합니다" : "이어서 수정하려면 완료된 실행이 필요합니다"}>
        <MessageSquarePlus className="h-3.5 w-3.5" /> 이어서 수정 요청
      </Button>
      {p.running && p.typingBacklog > 0 ? (
        <Button variant="ghost" size="sm" onClick={p.onSkipAnimation}>
          <FastForward className="h-3.5 w-3.5" /> 애니메이션 건너뛰기
        </Button>
      ) : null}

      <div className="mx-1 h-5 w-px bg-slate-200" />

      {p.status ? <Badge tone={STATUS_TONE[p.status]}>{RUN_STATUS_LABEL[p.status]}</Badge> : <Badge tone="neutral">실행 전</Badge>}
      {p.turns !== null ? <span className="text-xs text-slate-600">턴 {p.turns}</span> : null}
      {elapsed !== null ? <span className="text-xs text-slate-600">경과 {formatDuration(elapsed)}</span> : null}
      {p.run?.model ? <span className="hidden text-[11px] text-slate-400 md:inline">{p.run.model}</span> : null}
      {p.run?.error && !p.running ? (
        <span className="max-w-md truncate text-xs text-red-600" title={p.run.error}>
          {p.run.error}
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {p.saveState !== "idle" ? (
          <Badge tone={SAVE_TONE[p.saveState]} title={p.saveError ?? undefined}>
            {SAVE_LABEL[p.saveState]}
          </Badge>
        ) : null}
      </div>

      <Dialog
        open={resumeOpen}
        onClose={() => setResumeOpen(false)}
        title="이어서 수정 요청"
        description="같은 세션을 이어서 실행합니다. 현재 문서를 기준으로 고칠 점을 적어 주세요."
        footer={
          <>
            <Button variant="outline" onClick={() => setResumeOpen(false)}>
              취소
            </Button>
            <Button
              variant="primary"
              disabled={!instruction.trim()}
              onClick={() => {
                p.onResume(instruction.trim());
                setResumeOpen(false);
                setInstruction("");
              }}
            >
              요청 보내기
            </Button>
          </>
        }
      >
        <Textarea autoFocus rows={6} placeholder="예) 5. 신청자격에 우대업체 항목을 추가하고, 지원내용 표의 금액을 500만원으로 수정" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
      </Dialog>
    </div>
  );
}
