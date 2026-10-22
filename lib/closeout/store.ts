/**
 * 정산 원장의 디스크 자리 — `projects/<id>/ledger/{ledger.json, summary.md}`.
 *
 * ledger.json 은 정산자료 단계 에이전트가 쓰고, summary.md 는 그 단계가 끝날 때 플랫폼이 쓴다
 * (lib/stages/runIntegration.ts). 문서 단계의 `{{정산:…}}` 는 저장할 때 ledger.json 으로 펼친다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, projectDir } from "../storage/paths";
import { computeLedger, LedgerSchema, type Ledger, type LedgerResult } from "./ledger";
import { ledgerSummaryMarkdown } from "./summary";

export const LEDGER_STAGE_DIR = "ledger";

export function ledgerPaths(projectId: string): { dir: string; json: string; summary: string } {
  const dir = join(projectDir(projectId), LEDGER_STAGE_DIR);
  return { dir, json: join(dir, "ledger.json"), summary: join(dir, "summary.md") };
}

export type LedgerRead = { ok: true; ledger: Ledger } | { ok: false; missing: boolean; error: string };

export function readLedger(projectId: string): LedgerRead {
  const { json } = ledgerPaths(projectId);
  if (!existsSync(json)) return { ok: false, missing: true, error: "ledger/ledger.json 이 없습니다 — 정산자료 단계를 먼저 실행하세요" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(json, "utf8"));
  } catch (e) {
    return { ok: false, missing: false, error: `ledger.json 이 올바른 JSON 이 아닙니다: ${(e as Error).message}` };
  }
  const parsed = LedgerSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(최상위)"}: ${i.message}`);
    return { ok: false, missing: false, error: `ledger.json 형식 오류 — ${issues.join(" / ")}` };
  }
  return { ok: true, ledger: parsed.data };
}

/** 원장을 계산해 summary.md 를 쓴다. 원장이 없거나 형식이 틀리면 그 사유를 summary.md 에 쓴다. */
export function writeLedgerSummary(projectId: string): { ok: boolean; result?: LedgerResult; error?: string } {
  const { dir, summary } = ledgerPaths(projectId);
  ensureDir(dir);
  const r = readLedger(projectId);
  if (!r.ok) {
    writeFileSync(summary, `# 정산 요약\n\n- ❌ ${r.error}\n`, "utf8");
    return { ok: false, error: r.error };
  }
  const result = computeLedger(r.ledger);
  writeFileSync(summary, ledgerSummaryMarkdown(result), "utf8");
  return { ok: true, result };
}

export function readLedgerSummary(projectId: string): string | null {
  const { summary } = ledgerPaths(projectId);
  return existsSync(summary) ? readFileSync(summary, "utf8") : null;
}
