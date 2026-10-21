/**
 * Stage document service: persistence of DocModel/DSL per stage, export to HWPX, rendering,
 * version history. Used by the stage API routes and by the run manager's doc extractor.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { rhwpBin, spawnCommandSync as spawnSync } from "../platform";
import { DocModelSchema, type DocModel } from "../docmodel/schema";
import { parseDsl } from "../docmodel/dsl";
import { normalizeDocMeta, normalizeDslText, type NormalizeChange } from "../docmodel/govNormalize";
import { resolveAsset } from "../closeout/photos";
import { toDsl } from "../docmodel/serialize/toDsl";
import { expandLedgerMacros, hasLedgerMacro } from "../closeout/macros";
import { readLedger } from "../closeout/store";
import { computeLedger } from "../closeout/ledger";
import { sourceAmounts, unledgeredWarnings } from "../closeout/amountCheck";
import { materialsDir } from "../closeout/materials";
import { exportStageDoc, ensureRendered, readExportReport, readPageSvg } from "../hwpx/export";
import type { ExportReportDTO, Stage } from "../contracts";
import { db, schema } from "../db/client";
import { desc, and, eq } from "drizzle-orm";

const CLOSEOUT_DOC_STAGES = new Set<string>(["result", "settlement", "submit"]);

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
export function readResearchNotes(projectId: string, stage: "research" | "analysis" = "research"): string | null {
  const p = join(stageDir(projectId, stage), "notes.md");
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

/** 공문(official) 결문 연락처의 빈 칸을 project.json 의 담당 연락처로 채운다. 바꾼 칸이 있으면 변경 기록을 돌려준다. */
function fillOfficialContact(projectId: string, doc: DocModel): NormalizeChange | null {
  if (doc.family !== "official") return null;
  const file = join(dataDir(), "projects", projectId, "project.json");
  if (!existsSync(file)) return null;
  let contact: Record<string, string | undefined>;
  try {
    contact = (JSON.parse(readFileSync(file, "utf8")) as { contact?: Record<string, string | undefined> }).contact ?? {};
  } catch {
    return null;
  }
  const c = doc.meta.연락처;
  const pairs: [keyof typeof c, string | undefined][] = [
    ["주소", contact.우편주소],
    ["우편번호", contact.우편번호],
    ["전화", contact.전화],
    ["이메일", contact.이메일],
    ["전송", contact.전송],
    ["홈페이지", contact.홈페이지],
  ];
  let n = 0;
  for (const [k, v] of pairs) {
    if (v && v.trim() && !String(c[k] ?? "").trim()) {
      (c as Record<string, string>)[k] = v.trim();
      n++;
    }
  }
  return n ? { rule: "결문 연락처 채움", count: n } : null;
}

/** Parse DSL text produced by an agent, save it, and return the doc + warnings. */
export function saveStageDsl(projectId: string, stage: Stage, dslText: string, source: "agent" | "user" = "agent"): { doc: DocModel; warnings: { line: number; message: string }[]; version: number; normalized?: NormalizeChange[] } {
  // agent output is normalised to the 편람/house conventions before it becomes a version;
  // user edits are saved verbatim (the editor shows lint warnings instead)
  let text = dslText;
  const normalized: NormalizeChange[] = [];
  const macroWarnings: { line: number; message: string }[] = [];
  // 정산 표·값은 에이전트가 타이핑하지 않는다 — `{{정산:…}}` 를 원장 계산 결과로 펼친다(lib/closeout/macros.ts).
  // 원장이 없으면 매크로를 그대로 남기고 경고한다(표가 조용히 빠진 문서를 만들지 않는다).
  if (source === "agent" && hasLedgerMacro(text)) {
    const l = readLedger(projectId);
    if (l.ok) {
      const x = expandLedgerMacros(text, l.ledger);
      text = x.text;
      macroWarnings.push(...x.warnings.map((message) => ({ line: 0, message })));
      normalized.push({ rule: "정산매크로", count: 1 });
    } else {
      macroWarnings.push({ line: 0, message: `정산 매크로를 펼치지 못했습니다: ${l.error}` });
    }
  }
  if (source === "agent") {
    const r = normalizeDslText(text);
    text = r.text;
    normalized.push(...r.changes);
  }
  const parsed = parseDsl(text);
  let doc = parsed.doc;
  if (source === "agent") {
    const m = normalizeDocMeta(doc);
    doc = m.doc;
    // 공문 결문의 연락처 칸은 프로젝트에 등록된 담당 연락처로 채운다 — 에이전트가 주소를 빠뜨려 결문 주소 칸이
    // 비었다(고령군 제출 공문, 2026-10-07). 에이전트가 적은 값은 그대로 두고 빈 칸만 채운다.
    const filled = fillOfficialContact(projectId, doc);
    if (filled) m.changes.push(filled);
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
  return { doc, warnings: [...macroWarnings, ...parsed.warnings], version, normalized };
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

/**
 * 세 문서(결과·정산·공문)의 금액은 모두 원장에서 나와야 한다 — 매크로 밖에서 적은 금액(기업별 표·본문)도
 * 원장과 대조해 내보내기 보고서의 경고로 남긴다(화면의 「경고 N」). 에이전트 초안과 사람이 고친 판 모두.
 */
function ledgerAmountWarnings(projectId: string, stage: Stage, doc: DocModel): string[] {
  if (!CLOSEOUT_DOC_STAGES.has(stage)) return [];
  const l = readLedger(projectId);
  if (!l.ok) return [];
  return unledgeredWarnings(toDsl(doc), computeLedger(l.ledger), sourceAmounts(materialTexts(projectId))).map((w) => `[정산·금액 대조] ${w.message}`);
}

/** 올린 자료를 옮긴 글(materials/text/*.md) — 자료에 그대로 적힌 금액은 금액 대조에서 뺀다 */
function materialTexts(projectId: string): string[] {
  const dir = join(materialsDir(projectId), "text");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => readFileSync(join(dir, n), "utf8"));
}

export async function exportStage(projectId: string, stage: Stage): Promise<ExportReportDTO | null> {
  const doc = readStageDoc(projectId, stage);
  if (!doc) return null;
  // 사진 대지(```photos)의 그림은 프로젝트 작업 폴더에서 읽는다
  const { report } = await exportStageDoc(stageDir(projectId, stage), doc, { assets: (src) => resolveAsset(projectId, src) }, ledgerAmountWarnings(projectId, stage, doc));
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
