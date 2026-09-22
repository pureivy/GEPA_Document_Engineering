/** Read/write helpers for the per-stage files. All writes create the directory on demand. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunStage } from "../agents/runner";
import { ensureStageDir, FILE_NAMES, runLogPath, stageDir } from "./paths";

// ---- generic path-based helpers (sync; create parent directories on write) ----

/** Returns the file's UTF-8 text, or null when it does not exist. */
export function readTextIfExists(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}

/** Writes UTF-8 text, creating the parent directory if needed. Returns the path. */
export function writeText(filePath: string, text: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, "utf8");
  return filePath;
}

/** Writes raw bytes, creating the parent directory if needed. Returns the path. */
export function writeBytes(filePath: string, bytes: Uint8Array): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes);
  return filePath;
}

/** Returns the file's bytes, or null when it does not exist. */
export function readBytesIfExists(filePath: string): Buffer | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath);
}

// ---- stage-file helpers ----

function stageFile(projectId: string, stage: RunStage, name: string): string {
  return path.join(stageDir(projectId, stage), name);
}

export function draftDslPath(projectId: string, stage: RunStage): string {
  return stageFile(projectId, stage, FILE_NAMES.draftDsl);
}
export function docJsonPath(projectId: string, stage: RunStage): string {
  return stageFile(projectId, stage, FILE_NAMES.docJson);
}
export function outHwpxPath(projectId: string, stage: RunStage): string {
  return stageFile(projectId, stage, FILE_NAMES.outHwpx);
}

export async function readDraftDsl(projectId: string, stage: RunStage): Promise<string | null> {
  const p = draftDslPath(projectId, stage);
  if (!existsSync(p)) return null;
  return readFile(p, "utf8");
}

export async function writeDraftDsl(projectId: string, stage: RunStage, dsl: string): Promise<string> {
  ensureStageDir(projectId, stage);
  const p = draftDslPath(projectId, stage);
  await writeFile(p, dsl, "utf8");
  return p;
}

export async function readDocJson<T = unknown>(projectId: string, stage: RunStage): Promise<T | null> {
  const p = docJsonPath(projectId, stage);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8")) as T;
}

export async function writeDocJson(projectId: string, stage: RunStage, doc: unknown): Promise<string> {
  ensureStageDir(projectId, stage);
  const p = docJsonPath(projectId, stage);
  await writeFile(p, JSON.stringify(doc, null, 2), "utf8");
  return p;
}

export async function readOutHwpx(projectId: string, stage: RunStage): Promise<Buffer | null> {
  const p = outHwpxPath(projectId, stage);
  if (!existsSync(p)) return null;
  return readFile(p);
}

export async function writeOutHwpx(projectId: string, stage: RunStage, bytes: Uint8Array): Promise<string> {
  ensureStageDir(projectId, stage);
  const p = outHwpxPath(projectId, stage);
  await writeFile(p, bytes);
  return p;
}

/** Append one JSON line to `run-<id>.ndjson` (synchronous: called on the event hot path). */
export function appendRunLogLine(projectId: string, stage: RunStage, runId: string, line: string): string {
  const p = runLogPath(projectId, stage, runId);
  mkdirSync(path.dirname(p), { recursive: true });
  appendFileSync(p, line.endsWith("\n") ? line : `${line}\n`, "utf8");
  return p;
}

export function readRunLogLines(projectId: string, stage: RunStage, runId: string): string[] {
  const p = runLogPath(projectId, stage, runId);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0);
}

export function writeStageTextFile(projectId: string, stage: RunStage, name: string, text: string): string {
  ensureStageDir(projectId, stage);
  const p = stageFile(projectId, stage, name);
  writeFileSync(p, text, "utf8");
  return p;
}

export function readStageTextFile(projectId: string, stage: RunStage, name: string): string | null {
  const p = stageFile(projectId, stage, name);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}
