/**
 * Stage document service: persistence of DocModel/DSL per stage, export to HWPX, rendering,
 * version history. Used by the stage API routes and by the run manager's doc extractor.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { rhwpBin, spawnCommandSync as spawnSync } from "../platform";
import { DocModelSchema, type DocModel } from "../docmodel/schema";
import { parseDsl } from "../docmodel/dsl";
import { normalizeDocMeta, normalizeDslText, type NormalizeChange } from "../docmodel/govNormalize";
import { toDsl } from "../docmodel/serialize/toDsl";
import { exportStageDoc, ensureRendered, readExportReport, readPageSvg } from "../hwpx/export";
import type { ExportReportDTO, Stage } from "../contracts";
import { db, schema } from "../db/client";
import { desc, and, eq } from "drizzle-orm";

export function dataDir(): string {
  return process.env.DATA_DIR ? (isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : join(process.cwd(), process.env.DATA_DIR)) : join(process.cwd(), "data");
}
export function projectDir(projectId: string): string {
  const d = join(dataDir(), "projects", projectId);
  mkdirSync(d, { recursive: true });
  return d;
}
export function stageDir(projectId: string, stage: string): string {
  const d = join(projectDir(projectId), stage);
  mkdirSync(d, { recursive: true });
  return d;
}

export function readStageDoc(projectId: string, stage: Stage): DocModel | null {
  const p = join(stageDir(projectId, stage), "doc.json");
  if (!existsSync(p)) return null;
  const parsed = DocModelSchema.safeParse(JSON.parse(readFileSync(p, "utf8")));
  return parsed.success ? parsed.data : null;
}
export function readStageDsl(projectId: string, stage: Stage): string | null {
  const p = join(stageDir(projectId, stage), "draft.dsl.md");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}
export function readResearchNotes(projectId: string): string | null {
  const p = join(stageDir(projectId, "research"), "notes.md");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** Save a DocModel (and its DSL rendering) as a new version. Returns the version seq. */
export function saveStageDoc(projectId: string, stage: Stage, doc: DocModel, source: "agent" | "user" | "restore", dsl?: string): number {
  const dir = stageDir(projectId, stage);
  const text = dsl ?? toDsl(doc);
  writeFileSync(join(dir, "doc.json"), JSON.stringify(doc, null, 2));
  writeFileSync(join(dir, "draft.dsl.md"), text);
  const d = db();
  const last = d.select({ seq: schema.docVersions.seq }).from(schema.docVersions).where(and(eq(schema.docVersions.projectId, projectId), eq(schema.docVersions.stage, stage))).orderBy(desc(schema.docVersions.seq)).limit(1).get();
  const seq = (last?.seq ?? 0) + 1;
  d.insert(schema.docVersions).values({ projectId, stage, seq, source, doc: JSON.stringify(doc), dsl: text, createdAt: new Date().toISOString() }).run();
  return seq;
}

/** Parse DSL text produced by an agent, save it, and return the doc + warnings. */
export function saveStageDsl(projectId: string, stage: Stage, dslText: string, source: "agent" | "user" = "agent"): { doc: DocModel; warnings: { line: number; message: string }[]; version: number; normalized?: NormalizeChange[] } {
  // agent output is normalised to the 편람/house conventions before it becomes a version;
  // user edits are saved verbatim (the editor shows lint warnings instead)
  let text = dslText;
  const normalized: NormalizeChange[] = [];
  if (source === "agent") {
    const r = normalizeDslText(dslText);
    text = r.text;
    normalized.push(...r.changes);
  }
  const parsed = parseDsl(text);
  let doc = parsed.doc;
  if (source === "agent") {
    const m = normalizeDocMeta(doc);
    doc = m.doc;
    normalized.push(...m.changes);
    if (normalized.length) {
      // meta fixes need re-serialisation; pure text fixes keep the agent's own layout
      if (m.changes.length) text = toDsl(doc);
      try {
        writeFileSync(join(stageDir(projectId, stage), "draft.dsl.md"), text, "utf8");
      } catch (e) {
        console.error("[service] normalized draft write failed:", (e as Error).message);
      }
      console.log(`[service] ${stage} draft normalized: ${normalized.map((c) => `${c.rule}×${c.count}`).join(", ")}`);
    }
  }
  const version = saveStageDoc(projectId, stage, doc, source, text);
  return { doc, warnings: parsed.warnings, version, normalized };
}

export function listVersions(projectId: string, stage: Stage): { seq: number; source: string; createdAt: string }[] {
  return db()
    .select({ seq: schema.docVersions.seq, source: schema.docVersions.source, createdAt: schema.docVersions.createdAt })
    .from(schema.docVersions)
    .where(and(eq(schema.docVersions.projectId, projectId), eq(schema.docVersions.stage, stage)))
    .orderBy(desc(schema.docVersions.seq))
    .all();
}

export function restoreVersion(projectId: string, stage: Stage, seq: number): DocModel | null {
  const row = db().select().from(schema.docVersions).where(and(eq(schema.docVersions.projectId, projectId), eq(schema.docVersions.stage, stage), eq(schema.docVersions.seq, seq))).get();
  if (!row) return null;
  const doc = DocModelSchema.parse(JSON.parse(row.doc));
  saveStageDoc(projectId, stage, doc, "restore", row.dsl ?? undefined);
  return doc;
}

export async function exportStage(projectId: string, stage: Stage): Promise<ExportReportDTO | null> {
  const doc = readStageDoc(projectId, stage);
  if (!doc) return null;
  const { report } = await exportStageDoc(stageDir(projectId, stage), doc);
  await ensureRendered(stageDir(projectId, stage));
  return report;
}

export function currentReport(projectId: string, stage: Stage): ExportReportDTO | null {
  return readExportReport(stageDir(projectId, stage));
}

export async function renderManifest(projectId: string, stage: Stage): Promise<{ pages: number; hash: string } | null> {
  const r = await ensureRendered(stageDir(projectId, stage));
  return r ? { pages: r.pages, hash: r.hash } : null;
}

export function pageSvg(projectId: string, stage: Stage, hash: string, page: number): string | null {
  return readPageSvg(stageDir(projectId, stage), hash, page);
}

export function hwpxPath(projectId: string, stage: Stage): string | null {
  const p = join(stageDir(projectId, stage), "out.hwpx");
  return existsSync(p) ? p : null;
}

/** PDF via the rhwp CLI (bin/rhwp export-pdf), cached next to out.hwpx. */
export function pdfPath(projectId: string, stage: Stage): string | null {
  const hp = hwpxPath(projectId, stage);
  if (!hp) return null;
  const out = join(stageDir(projectId, stage), "out.pdf");
  const rhwp = rhwpBin();
  if (!existsSync(rhwp)) return null;
  const stale = !existsSync(out) || statMs(out) < statMs(hp);
  if (stale) {
    const r = spawnSync(rhwp, ["export-pdf", hp, "-o", out, "--font-path", join(process.cwd(), "public", "fonts")], { encoding: "utf8" });
    if (r.status !== 0) return null;
  }
  return existsSync(out) ? out : null;
}
function statMs(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
