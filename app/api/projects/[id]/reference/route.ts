/**
 * POST multipart: `file` (one or more — .hwpx/.hwp/.docx/.pdf/.md/.txt), `changes` (text; kept as is when
 * the field is absent), `autoRun` ("1" → start the pipeline: research with autoChain), `supplementalResearch`.
 *
 * Every call **adds** to the project's reference documents (the same file name replaces that file in
 * place, order is kept): originals under projects/<id>/reference/, the extracted text cached in
 * reference/.extracted/<name>.txt, and reference/base-plan.md — the one file the agents read — rebuilt
 * from all of them (referenceMarkdownMulti; one file → exactly the old single-file text). The row keeps the
 * first name in reference_name (the frozen prompts read it) and every name in reference_names (JSON).
 */
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { referenceFileNames, serializeProject } from "@/lib/db/serialize";
import { jsonError } from "@/lib/agents/http";
import { RunConflictError } from "@/lib/agents/runManager";
import { startStageRun } from "@/lib/stages/runIntegration";
import { KIND_LABEL, isProjectKind, stagesOf } from "@/lib/kinds";
import { projectDir } from "@/lib/storage/paths";
import { extractReferenceText, referenceMarkdownMulti, referenceExtension, REFERENCE_EXTENSIONS, type ReferenceDoc } from "@/lib/reference/extract";
import { referenceRoleFor } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 100 * 1024 * 1024;
/** per request — the screen sends one file per request; this only bounds direct API use */
const MAX_FILES = 10;
/** base-plan.md is what the agents read; an upload with that name would be overwritten by the rebuild */
const RESERVED = new Set(["base-plan.md"]);

function safeNameOf(name: string): string {
  return basename(name).replace(/[\\/:*?"<>|]/g, "_");
}

function cacheDir(id: string): string {
  return join(projectDir(id), "reference", ".extracted");
}

/** extracted text of an already-uploaded file: the cache, or re-extracted from the original (projects from before the cache existed) */
function cachedText(id: string, name: string): string | null {
  const cached = join(cacheDir(id), `${name}.txt`);
  if (existsSync(cached)) return readFileSync(cached, "utf8");
  const original = join(projectDir(id), "reference", name);
  if (!existsSync(original)) return null;
  try {
    const text = extractReferenceText(name, new Uint8Array(readFileSync(original))).text;
    mkdirSync(cacheDir(id), { recursive: true });
    writeFileSync(cached, text, "utf8");
    return text;
  } catch {
    return null;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return jsonError(404, "Project not found");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "multipart/form-data 요청이 필요합니다");
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return jsonError(400, "file 필드(참고 문서)가 없습니다");
  if (files.length > MAX_FILES) return jsonError(400, `한 번에 ${MAX_FILES}개까지 올릴 수 있습니다`);
  for (const file of files) {
    if (file.size > MAX_BYTES) return jsonError(413, `파일이 너무 큽니다 (100MB 이하): ${file.name}`);
    const name = safeNameOf(file.name);
    if (!referenceExtension(name)) return jsonError(400, `지원하지 않는 파일 형식입니다 (${REFERENCE_EXTENSIONS.join(", ")}): ${file.name}`);
    if (RESERVED.has(name) || name.startsWith(".")) return jsonError(400, `쓸 수 없는 파일 이름입니다: ${file.name}`);
  }
  const changesField = form.get("changes");
  const autoRun = String(form.get("autoRun") ?? "") === "1";
  const supplementalResearch = String(form.get("supplementalResearch") ?? "") === "1";

  // run route(app/api/projects/[id]/stages/[stage]/run/route.ts:39)와 같은 kind 게이트 — 이 라우트를
  // 직접 POST 하면(autoRun=1) 공문 프로젝트 안에도 research 실행이 생길 수 있었다.
  if (autoRun) {
    const kind = isProjectKind(row.kind) ? row.kind : "program";
    if (!stagesOf(kind).includes("research")) {
      return jsonError(404, `${KIND_LABEL[kind]} 프로젝트에는 research 단계가 없습니다`);
    }
  }

  // 먼저 전부 읽어 본다 — 하나라도 못 읽으면 아무 것도 쓰지 않는다(반쯤 올라간 상태를 남기지 않는다)
  const incoming: { name: string; bytes: Uint8Array; text: string; truncated: boolean }[] = [];
  for (const file of files) {
    const name = safeNameOf(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const e = extractReferenceText(name, bytes);
      incoming.push({ name, bytes, text: e.text, truncated: e.truncated });
    } catch (e) {
      return jsonError(422, `${file.name}: ${(e as Error).message}`);
    }
  }
  const dir = join(projectDir(id), "reference");
  mkdirSync(cacheDir(id), { recursive: true });
  for (const f of incoming) {
    writeFileSync(join(dir, f.name), f.bytes);
    writeFileSync(join(cacheDir(id), `${f.name}.txt`), f.text, "utf8");
  }
  // 누적: 이미 있던 이름은 제자리에서 바뀌고, 새 이름은 올린 순서대로 뒤에 붙는다
  const names = referenceFileNames(row);
  for (const f of incoming) if (!names.includes(f.name)) names.push(f.name);
  const changes = typeof changesField === "string" ? changesField.trim().slice(0, 20_000) : (row.referenceChanges ?? "");
  // 사업계획서 갱신이 아닌 문서는 용도대로 자기를 소개해야 한다 — 에이전트가 여는 파일이
  // "기존 사업계획서"라고 적혀 있으면 프롬프트를 갈라 놓아도 소용이 없다. 용도는 프로젝트를 만들 때
  // 이미 contact 에 실려 저장되고(화면이 createProject → uploadReference 순으로 부른다) 여기서
  // 읽기만 한다. 판정은 프롬프트와 한 곳(lib/contracts.ts referenceRoleFor)에서 나눈다.
  const before = serializeProject(row);
  const role = referenceRoleFor(before.kind, before.contact.참고문서용도);
  const docs = names.map((name) => ({ fileName: name, text: cachedText(id, name) })).filter((d): d is ReferenceDoc => typeof d.text === "string");
  writeFileSync(join(dir, "base-plan.md"), referenceMarkdownMulti(docs, changes, role), "utf8");
  const now = new Date().toISOString();
  db.update(projects)
    .set({ referenceName: names[0], referenceNames: JSON.stringify(names), referenceChanges: changes, updatedAt: now })
    .where(eq(projects.id, id))
    .run();
  const updated = db.select().from(projects).where(eq(projects.id, id)).get()!;
  const project = serializeProject(updated);
  writeFileSync(join(projectDir(id), "project.json"), JSON.stringify(project, null, 2), "utf8");

  let run: { runId: string; sessionId: string } | null = null;
  if (autoRun) {
    try {
      run = startStageRun({ project, stage: "research", autoChain: true, supplementalResearch });
    } catch (err) {
      if (err instanceof RunConflictError) return jsonError(409, err.message, { activeRunId: err.activeRunId, project });
      return jsonError(500, err instanceof Error ? err.message : String(err));
    }
  }
  const chars = incoming.reduce((n, f) => n + f.text.length, 0);
  return Response.json(
    {
      project,
      files: incoming.map((f) => ({ name: f.name, chars: f.text.length, truncated: f.truncated })),
      chars,
      truncated: incoming.some((f) => f.truncated),
      run,
    },
    { status: 201 },
  );
}
