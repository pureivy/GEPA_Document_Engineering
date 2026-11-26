/**
 * 양식 맞춰 쓰기 프로젝트의 파일 — data/projects/<id>/template/ 아래.
 *
 *   base.hwpx        양식 원본(.hwp 로 올렸으면 hwpx 로 바꾼 것). 모든 판의 기준이다
 *   paragraphs.md    AI가 읽는 문단 목록(engine.listParagraphs)
 *   edits.json       AI가 쓰는 고칠 목록 — 언제나 base.hwpx 기준의 **누적** 목록
 *   out.hwpx         base + edits 로 만든 결과(미리보기·내려받기는 다른 단계와 같은 이름을 쓴다)
 *   changes.md       바뀐 곳 표(원본 / 바뀐 글)
 *   export-report.json  다른 단계와 같은 꼴(쪽수·경고·오류)
 *   versions/v<N>.hwpx · v<N>.edits.json  실행마다 남기는 판
 *
 * 양식은 reference/ 에 올린 첫 파일이다(나머지는 참고 문서). 원본은 손대지 않는다.
 */
import { dropPageNumber } from "../hwpx/pageNumber";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { projects } from "../db/schema";
import type { ExportReportDTO, ProjectDTO, TemplateMode } from "../contracts";
import { hwpToHwpx } from "../reference/extract";
import { validateHwpx } from "../hwpx/validate";
import { sha1 } from "../hwpx/export";
import { hangulLayout } from "../hwpx/hangul";
import { applyEdits, changesMarkdown, listParagraphs, readTemplate, type TemplateEdits } from "./engine";
import { fitTemplateLayout } from "./fit";
import { applyRowOps } from "./rows";
import { tidyNewWriting } from "./tidy";
import { clearStaleRuns, moveOutOfScript, leftoverByChapter, leftoverMarkdown, leftoverWarnings } from "./leftover";

/** 양식 쓰임 — contact 의 진짜는 DB 다(lib/closeout/store.ts ledgerOptsOf 와 같다). 작업 폴더 이름이 프로젝트 id */
export function templateModeOf(workspaceDir: string): TemplateMode {
  try {
    const row = getDb().select({ contact: projects.contact }).from(projects).where(eq(projects.id, basename(workspaceDir))).get();
    const contact = row ? (JSON.parse(row.contact) as { 양식쓰임?: string }) : {};
    return contact.양식쓰임 === "새로 쓰기" ? "새로 쓰기" : "고쳐 쓰기";
  } catch {
    return "고쳐 쓰기";
  }
}

export const TEMPLATE_EXTENSIONS = [".hwpx", ".hwp"] as const;

export function templateDir(workspaceDir: string): string {
  const d = join(workspaceDir, "template");
  mkdirSync(d, { recursive: true });
  return d;
}

/** 양식 파일 이름 — 올린 첫 파일 */
export function templateFileName(project: ProjectDTO): string | null {
  const names = project.reference?.fileNames?.length ? project.reference.fileNames : project.reference?.fileName ? [project.reference.fileName] : [];
  return names[0] ?? null;
}

/**
 * 실행 전 준비: base.hwpx 와 paragraphs.md 를 만든다(양식이 바뀌었으면 다시). 양식이 없거나 한글 파일이 아니면 던진다 —
 * 실행 버튼이 그 말을 그대로 보여 준다.
 */
export function prepareTemplate(project: ProjectDTO, workspaceDir: string): { paragraphs: number } {
  const name = templateFileName(project);
  if (!name) throw new Error("양식 파일이 없습니다 — 고쳐 쓸 한글 파일(hwpx·hwp)을 첫 파일로 올려 주세요");
  const lower = name.toLowerCase();
  if (!TEMPLATE_EXTENSIONS.some((e) => lower.endsWith(e))) throw new Error(`양식은 한글 파일(hwpx·hwp)이어야 합니다 — 첫 파일이 ${name} 입니다. PDF·워드는 글자만 읽을 수 있어 참고 문서로만 씁니다`);
  const src = join(workspaceDir, "reference", name);
  if (!existsSync(src)) throw new Error(`양식 파일을 찾지 못했습니다: ${name}`);
  const dir = templateDir(workspaceDir);
  const raw = new Uint8Array(readFileSync(src));
  const bytes = lower.endsWith(".hwp") ? hwpToHwpx(raw) : raw;
  const stamp = sha1(raw);
  const stampFile = join(dir, "base.source");
  const fresh = !existsSync(join(dir, "base.hwpx")) || !existsSync(stampFile) || readFileSync(stampFile, "utf8") !== `${name}\n${stamp}`;
  const doc = readTemplate(bytes);
  if (fresh) {
    writeFileSync(join(dir, "base.hwpx"), bytes);
    writeFileSync(stampFile, `${name}\n${stamp}`, "utf8");
    // 양식이 바뀌면 문단 번호가 달라진다 — 옛 고칠 목록은 판으로만 남기고 비운다
    if (existsSync(join(dir, "edits.json"))) copyFileSync(join(dir, "edits.json"), join(dir, `edits.before-${Date.now()}.json`));
    writeFileSync(join(dir, "edits.json"), JSON.stringify({ edits: [] }, null, 2), "utf8");
    try {
      writeFileSync(join(dir, "base-pages.json"), "{}");
    } catch {
      /* 쪽수는 다음 결과 만들 때 잰다 */
    }
  }
  writeFileSync(join(dir, "paragraphs.md"), listParagraphs(doc, name.replace(/\.(hwpx|hwp)$/i, "")), "utf8");
  return { paragraphs: doc.paragraphs.length };
}

async function basePages(dir: string): Promise<number | null> {
  const f = join(dir, "base-pages.json");
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as { pages?: number };
    if (typeof j.pages === "number") return j.pages;
  } catch {
    /* 없으면 잰다 */
  }
  const h = await hangulLayout(new Uint8Array(readFileSync(join(dir, "base.hwpx")))).catch(() => undefined);
  const n = h?.texts?.length ?? h?.pngs.length ?? null;
  if (n) writeFileSync(f, JSON.stringify({ pages: n }));
  return n;
}

export interface TemplateResult {
  report: ExportReportDTO;
  changes: number;
  errors: string[];
  version: number;
}

/**
 * 실행이 끝난 뒤: base.hwpx + edits.json → out.hwpx, changes.md, export-report.json, 판 저장.
 * 미리보기 그림은 호출한 쪽이 ensureRendered 로 만든다(한글 배치).
 */
export async function buildTemplateResult(workspaceDir: string): Promise<TemplateResult> {
  const dir = templateDir(workspaceDir);
  const editsFile = join(dir, "edits.json");
  if (!existsSync(join(dir, "base.hwpx"))) throw new Error("양식 원본(template/base.hwpx)이 없습니다");
  let edits: TemplateEdits;
  try {
    edits = JSON.parse(readFileSync(editsFile, "utf8")) as TemplateEdits;
  } catch (e) {
    throw new Error(`template/edits.json 을 읽지 못했습니다: ${(e as Error).message}`);
  }
  const doc = readTemplate(new Uint8Array(readFileSync(join(dir, "base.hwpx"))));
  // 새로 쓰기는 모양만 빌린다 — 원본 내용이 남으면 틀린 문서다(담당자 2026-11-24). 고친 문단의 안 적은 칸에 남은 원본 글은 비운다
  const newWriting = templateModeOf(workspaceDir) === "새로 쓰기";
  const stale = newWriting ? clearStaleRuns(doc, edits) : { edits, cleared: [] };
  // 첨자 칸에 들어간 본문 글은 보통 칸으로 — 두 쓰임 모두(leftover.ts moveOutOfScript)
  const script = moveOutOfScript(doc, stale.edits);
  const r = applyEdits(doc, script.edits);
  // 표 행 넣기·빼기(rows.ts) — 문단 고침 뒤에. 문단을 지우며 통째로 빠진 표는 번호를 되돌려 찾는다
  const deletedTables = new Set(
    r.changes
      .filter((c) => c.kind === "지움")
      .flatMap((c) => {
        const d = doc.paragraphs.find((p) => p.id === c.p)!;
        return doc.paragraphs.filter((q) => q.section === d.section && q.start >= d.start && q.end <= d.end).flatMap((q) => q.tables);
      }),
  );
  const rowOps = (Array.isArray(edits.edits) ? edits.edits : []).filter((e): e is Extract<TemplateEdits["edits"][number], { table: number }> => !!e && typeof e === "object" && "table" in e);
  const rows = applyRowOps(r.bytes, rowOps, deletedTables);
  r.bytes = rows.bytes;
  r.errors.push(...rows.errors);
  // 새로 쓰기 뒷정리 — 지운 원본 사이에 남은 빈 줄·쪽 나눔, 원본 줄 수에 맞춘 표 높이(tidy.ts)
  const tidy = newWriting ? tidyNewWriting(r.bytes) : { bytes: r.bytes, notes: [] as string[] };
  r.bytes = tidy.bytes;
  // 배치 다듬기 — 끝 몇 글자만 내려간 바꾼 문단은 자간을 좁히고, 통째로 넘어가 앞 쪽을 비운 표는 높이를 줄여 본다(fit.ts)
  const fit = r.changes.length || rows.changes.length ? await fitTemplateLayout(r.bytes, new Set(r.changes.filter((c) => c.kind !== "지움").map((c) => c.after))).catch((e: Error) => ({ bytes: r.bytes, notes: [`배치 다듬기 실패: ${e.message}`] })) : { bytes: r.bytes, notes: [] };
  r.bytes = fit.bytes;
  const v = await validateHwpx(r.bytes);
  // 새로 쓰기는 길이·쪽수를 맞출 대상이 아니다
  const leftover = leftoverByChapter(doc, r.changes);
  const warnings = [...(newWriting ? leftoverWarnings(leftover) : []), ...r.warnings.filter((w) => !(newWriting && w.startsWith("[길이]"))), ...r.errors.map((e) => `[적용 못 함] ${e}`), ...fit.notes.filter((n) => /못 함|실패/.test(n)).map((n) => `[배치] ${n}`)];
  // 쪽수 대조 — 원본과 다르면 글이 늘거나 줄어 쪽 넘김이 바뀐 것이다(한글이 없으면 건너뛴다)
  let pageCount = v.pageCount;
  const h = await hangulLayout(r.bytes).catch(() => undefined);
  const outPages = h?.texts?.length ?? h?.pngs.length;
  if (outPages) {
    pageCount = outPages;
    const before = await basePages(dir);
    if (before && before !== outPages && !newWriting) warnings.unshift(`[쪽수] 원본 ${before}쪽 → ${outPages}쪽 — 글 길이가 달라져 쪽 넘김이 바뀌었습니다. 늘어난 문단을 줄이거나 한글에서 확인하세요`);
  }
  // 한 장짜리 결과에는 쪽번호를 찍지 않는다(담당자 2026-11-18: "1장짜리인데 1이라고 표시할 필요가 없다")
  if (pageCount === 1) r.bytes = dropPageNumber(r.bytes).bytes;
  writeFileSync(join(workspaceDir, "template", "out.hwpx"), r.bytes);
  const fitNotes = [...script.moved.map((m) => `첨자 칸 글을 보통 칸으로 옮김: 문단 ${m.p} 「${m.text}」`), ...tidy.notes, ...fit.notes];
  const fitSection = fitNotes.length ? ["", "## 배치 다듬기", ...fitNotes.map((n) => `- ${n}`), ""].join("\n") : "";
  const esc = (s: string) => s.replace(/\|/g, "／");
  const staleSection = stale.cleared.length ? ["", `## 남은 원본 칸 비움 ${stale.cleared.length}곳`, "", ...stale.cleared.map((c) => `- 문단 ${c.p}: ${esc(c.text)}`), ""].join("\n") : "";
  const rowSection = rows.changes.length ? ["", `## 표 행 ${rows.changes.length}개`, "", "| 표 | 행 | 구분 | 칸 |", "|---|---|---|---|", ...rows.changes.map((c) => `| 표${c.table} | ${c.row} | ${c.kind} | ${esc(c.text)} |`), ""].join("\n") : "";
  writeFileSync(join(dir, "changes.md"), changesMarkdown(r) + rowSection + staleSection + leftoverMarkdown(leftover) + fitSection, "utf8");
  const versions = join(dir, "versions");
  mkdirSync(versions, { recursive: true });
  const version = readdirSync(versions).filter((n) => /^v\d+\.hwpx$/.test(n)).length + 1;
  writeFileSync(join(versions, `v${version}.hwpx`), r.bytes);
  writeFileSync(join(versions, `v${version}.edits.json`), JSON.stringify(edits, null, 2), "utf8");
  const report: ExportReportDTO = {
    ok: v.ok && r.changes.length + rows.changes.length > 0,
    pageCount,
    contentLossCount: v.contentLoss?.count ?? null,
    appendedStyles: 0,
    warnings: r.changes.length + rows.changes.length ? warnings : ["바뀐 곳이 없습니다 — 고칠 목록(edits.json)이 비어 있습니다", ...warnings],
    errors: v.errors,
    builtAt: new Date().toISOString(),
    hash: sha1(r.bytes),
  };
  writeFileSync(join(dir, "export-report.json"), JSON.stringify(report, null, 2));
  return { report, changes: r.changes.length, errors: r.errors, version };
}

export function readChangesMarkdown(workspaceDir: string): string | null {
  const f = join(workspaceDir, "template", "changes.md");
  return existsSync(f) ? readFileSync(f, "utf8") : null;
}

const building = new Map<string, Promise<TemplateResult | null>>();

function mtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 결과가 최신이면 있는 보고서를, 아니면 새로 만든다. 실행 끝(runIntegration)과 미리보기(내보내기 요청)가 같은 때 불러도
 * 한 번만 돈다 — 한글 배치 확인이 수십 초 걸린다. 고칠 목록이 없으면 null.
 */
export function ensureTemplateResult(workspaceDir: string): Promise<TemplateResult | null> {
  const dir = templateDir(workspaceDir);
  const pending = building.get(dir);
  if (pending) return pending;
  if (!existsSync(join(dir, "base.hwpx")) || !existsSync(join(dir, "edits.json"))) return Promise.resolve(null);
  const out = join(dir, "out.hwpx");
  const reportFile = join(dir, "export-report.json");
  if (existsSync(out) && existsSync(reportFile) && mtime(out) >= mtime(join(dir, "edits.json")) && mtime(out) >= mtime(join(dir, "base.hwpx"))) {
    const report = JSON.parse(readFileSync(reportFile, "utf8")) as ExportReportDTO;
    return Promise.resolve({ report, changes: -1, errors: [], version: 0 });
  }
  const p = buildTemplateResult(workspaceDir).finally(() => building.delete(dir));
  building.set(dir, p);
  return p;
}

/**
 * 내려받을 파일 이름 바탕 — 프로젝트 제목(담당자가 요청한 작업 이름). 제목이 없을 때만 양식 이름 + (수정).
 * 담당자 2026-11-18: 언론브리핑 양식으로 「2027년 주요사업 안내책자 제작 현황」을 썼더니 내려받은 파일 이름이
 * 「…언론브리핑(한장)_변경(수정)」이었다 — 양식은 모양만 빌린 것이라 이름은 이번 작업을 따라야 한다.
 */
export function templateDownloadBase(workspaceDir: string): string | null {
  try {
    const title = (JSON.parse(readFileSync(join(workspaceDir, "project.json"), "utf8")) as { title?: string }).title?.trim();
    if (title) return title;
  } catch {
    // project.json 이 없거나 깨졌으면 양식 이름으로
  }
  const f = join(workspaceDir, "template", "base.source");
  if (!existsSync(f)) return null;
  const name = readFileSync(f, "utf8").split("\n")[0] ?? "";
  return name ? `${name.replace(/\.(hwpx|hwp)$/i, "")}(수정)` : null;
}

export interface DialogEntry {
  at: string;
  role: "user" | "assistant";
  text: string;
}

/** 지시와 AI 답을 차례로 남긴다(template/dialog.jsonl) — 화면이 대화처럼 보여 준다 */
export function appendDialog(workspaceDir: string, role: DialogEntry["role"], text: string): void {
  const line: DialogEntry = { at: new Date().toISOString(), role, text };
  appendFileSync(join(templateDir(workspaceDir), "dialog.jsonl"), JSON.stringify(line) + "\n", "utf8");
}

export function readDialog(workspaceDir: string): DialogEntry[] {
  const f = join(workspaceDir, "template", "dialog.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as DialogEntry];
      } catch {
        return [];
      }
    });
}
