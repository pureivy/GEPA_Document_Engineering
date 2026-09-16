/**
 * Per-project on-disk layout under `${DATA_DIR ?? ./data}/projects/<id>/`:
 *
 *   project.json
 *   research/  notes.md  sources.json  run-<runId>.ndjson
 *   plan/      draft.dsl.md  doc.json  out.hwpx  render/<hash>/page-N.svg  versions/<seq>.json
 *   notice/    (same)
 *   press/     (same) + press.md + press.txt
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Stage } from "../agents/runner";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function assertSafeId(id: string, what = "id"): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid ${what}: ${JSON.stringify(id)}`);
  return id;
}

export function dataDir(): string {
  const raw = process.env.DATA_DIR?.trim() || "./data";
  return path.resolve(process.cwd(), raw);
}

export function projectsDir(): string {
  return path.join(dataDir(), "projects");
}

export function projectDir(projectId: string): string {
  return path.join(projectsDir(), assertSafeId(projectId, "project id"));
}

export function stageDir(projectId: string, stage: Stage): string {
  return path.join(projectDir(projectId), stage);
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureProjectDir(projectId: string): string {
  return ensureDir(projectDir(projectId));
}

export function ensureStageDir(projectId: string, stage: Stage): string {
  return ensureDir(stageDir(projectId, stage));
}

export const FILE_NAMES = {
  projectJson: "project.json",
  draftDsl: "draft.dsl.md",
  docJson: "doc.json",
  outHwpx: "out.hwpx",
  notesMd: "notes.md",
  sourcesJson: "sources.json",
  pressMd: "press.md",
  pressTxt: "press.txt",
} as const;

/** Run logs live in a dot-directory so the agent's Glob/Read over the workspace does not see them. */
export function runLogPath(projectId: string, stage: Stage, runId: string): string {
  return path.join(projectDir(projectId), ".runs", stage, `run-${assertSafeId(runId, "run id")}.ndjson`);
}
