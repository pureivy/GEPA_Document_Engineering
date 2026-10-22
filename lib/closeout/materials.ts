/**
 * 정산·결과보고 자료함 — `projects/<id>/materials/`.
 *
 * 사업계획서 갱신(reference)은 파일이 하나지만, 정산·결과보고에는 여러 파일이 함께 온다:
 * 사업계획서·교부결정서(hwp/pdf), 예산집행 집계표·통장거래내역·ERP 지출결의(xlsx/xls/csv), 행사 사진·결과 메모.
 * 원본은 `materials/<이름>` 에, 에이전트가 읽을 텍스트는 `materials/text/<이름>.md` 에 둔다.
 * `materials/index.md` 가 목록이다 — 에이전트는 이것부터 읽는다.
 *
 * 전년도 참고자료(전년 결과보고서·정산보고서·계획서)는 `prior/` 라는 **다른 자료함**에 둔다(담당자 2026-10-22).
 * 같은 곳에 두면 작년 지급 공문이 올해 원장에 잡히고 작년 실적·총평이 올해 것으로 옮겨진다 — 정산 원장·금액 대조·
 * 사진 목록은 `materials/` 만 읽으므로 폴더를 나누면 코드에서도 섞이지 않는다. `prior/` 는 성과 분석 단계만 읽는다.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { removeSync } from "../fsSafe";
import { basename, join } from "node:path";
import { projectDir } from "../storage/paths";
import { extractReferenceText, referenceExtension } from "../reference/extract";
import { extractHwpxPhotos, imageInfo } from "./photos";
import { readPhotoTaken, takenLabel, type PhotoTaken } from "./exif";
import { readCsv, readXlsx, sheetsToMarkdown } from "./sheet";
import { readXls } from "./xls";
import { unzipSync } from "fflate";
import { GEPA_BOARDS, readSavedGepaPosts } from "./gepaSite";

export const MATERIAL_EXTENSIONS = [".xlsx", ".xls", ".csv", ".hwp", ".hwpx", ".pdf", ".docx", ".md", ".txt", ".png", ".jpg", ".jpeg"] as const;
/** 파일 한 개의 최대 크기 — 쪽수가 많은 스캔 PDF(지급 공문 한 건 20MB 남짓)도 넉넉히 받는다 */
export const MATERIAL_MAX_BYTES = 100 * 1024 * 1024;

export interface MaterialInfo {
  name: string;
  bytes: number;
  /** 에이전트가 읽을 파일(작업 폴더 기준 상대 경로) */
  readPath: string;
  /** 텍스트로 옮겼는가, 원본을 직접 읽어야 하는가 */
  mode: "text" | "direct";
  note?: string;
}

/** 자료함 — 올해 사업 자료(materials) / 전년도 참고자료(prior) */
export type MaterialBox = "materials" | "prior";

export function isMaterialBox(v: unknown): v is MaterialBox {
  return v === "materials" || v === "prior";
}

export function materialsDir(projectId: string, box: MaterialBox = "materials"): string {
  return join(projectDir(projectId), box);
}

export function safeMaterialName(name: string): string {
  return basename(name).replace(/[\\/:*?"<>|]/g, "_").trim();
}

export function materialExtension(name: string): (typeof MATERIAL_EXTENSIONS)[number] | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
  const e = ext ? `.${ext}` : "";
  return (MATERIAL_EXTENSIONS as readonly string[]).includes(e) ? (e as (typeof MATERIAL_EXTENSIONS)[number]) : null;
}

/** 은행 내려받기 CSV 는 CP949 가 흔하다 — UTF-8 로 읽히지 않으면 EUC-KR 로 다시 읽는다 */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

/** 원본을 텍스트로. 실패하거나 텍스트가 없는 형식이면 원본을 직접 읽으라는 안내를 돌려준다. */
export function materialText(name: string, bytes: Uint8Array): { text: string } | { direct: string } {
  const ext = materialExtension(name);
  if (ext === ".xlsx") return { text: sheetsToMarkdown(name, readXlsx(bytes)) };
  if (ext === ".xls") return { text: sheetsToMarkdown(name, readXls(bytes)) };
  if (ext === ".csv") return { text: sheetsToMarkdown(name, [readCsv(decodeText(bytes))]) };
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") return { direct: "이미지 — Read 로 직접 본다(통장 화면 캡처 등)" };
  if (ext && referenceExtension(name)) {
    try {
      return { text: `# 자료 — ${name}\n\n${extractReferenceText(name, bytes).text}\n` };
    } catch (e) {
      // pdftotext 가 없는 PC 에서도 막히지 않게 — 에이전트의 Read 는 PDF 를 직접 읽는다
      if (ext === ".pdf") return { direct: "PDF — 텍스트 추출 도구가 없어 Read 로 원본을 직접 읽는다" };
      throw e;
    }
  }
  throw new Error(`지원하지 않는 파일 형식입니다: ${name} (${MATERIAL_EXTENSIONS.join(", ")})`);
}

export function saveMaterial(projectId: string, rawName: string, bytes: Uint8Array, box: MaterialBox = "materials"): MaterialInfo {
  const name = safeMaterialName(rawName);
  if (!name || !materialExtension(name)) throw new Error(`지원하지 않는 파일 형식입니다: ${rawName} (${MATERIAL_EXTENSIONS.join(", ")})`);
  if (bytes.byteLength > MATERIAL_MAX_BYTES) throw new Error(`파일이 너무 큽니다(100MB 이하): ${name}`);
  const t = materialText(name, bytes); // 먼저 변환해 보고 실패하면 저장하지 않는다
  const dir = materialsDir(projectId, box);
  mkdirSync(join(dir, "text"), { recursive: true });
  writeFileSync(join(dir, name), bytes);
  if ("text" in t) writeFileSync(join(dir, "text", `${name}.md`), t.text, "utf8");
  else removeSync(join(dir, "text", `${name}.md`));
  // 다시 올린 스캔 PDF 는 글자 인식을 처음부터(scanPdf.ts — 쪽 그림·실패 표시를 지운다)
  removeSync(join(dir, "text", `${name}.scanfail`));
  if (/\.pdf$/i.test(name)) removeSync(join(dir, "pages", name.replace(/\.pdf$/i, "")));
  writeFileSync(join(dir, "text", `${name}.note`), "direct" in t ? t.direct : "", "utf8");
  // 전년도 자료의 사진은 올해 결과보고서 사진 대지에 쓰지 않는다
  if (box === "materials") savePhotosOf(projectId, name, bytes);
  writeIndex(projectId, box);
  return listMaterials(projectId, box).find((m) => m.name === name)!;
}

/**
 * 사진: 올린 jpg·png 는 그대로 사진이고, 공문 hwpx 안의 사진은 `materials/images/<자료이름>_<n>.<ext>` 로 꺼낸다
 * (결과보고서 사진 대지 ```photos 의 재료 — lib/closeout/photos.ts).
 */
function savePhotosOf(projectId: string, name: string, bytes: Uint8Array): void {
  const dir = join(materialsDir(projectId), "images");
  const base = name.replace(/\.[^.]+$/, "");
  removePhotosOf(projectId, name);
  if (!/\.hwpx$/i.test(name)) return;
  const photos = extractHwpxPhotos(bytes);
  if (!photos.length) return;
  mkdirSync(dir, { recursive: true });
  photos.forEach((p, i) => writeFileSync(join(dir, `${base}_${String(i + 1).padStart(2, "0")}${p.name.slice(p.name.lastIndexOf(".")).toLowerCase()}`), p.bytes));
}

function removePhotosOf(projectId: string, name: string): void {
  const dir = join(materialsDir(projectId), "images");
  if (!existsSync(dir)) return;
  const base = name.replace(/\.[^.]+$/, "");
  for (const f of readdirSync(dir)) if (f.startsWith(`${base}_`) && /_\d{2}\.(jpe?g|png|bmp)$/i.test(f)) removeSync(join(dir, f));
}

/** 이미 올린 자료에서 사진을 다시 꺼내고 목록을 고친다 — 사진 기능 이전에 올린 프로젝트용(scripts/extract-photos.ts) */
export function refreshMaterialPhotos(projectId: string): number {
  const dir = materialsDir(projectId);
  if (!existsSync(dir)) return 0;
  for (const m of listMaterials(projectId)) if (/\.hwpx$/i.test(m.name)) savePhotosOf(projectId, m.name, new Uint8Array(readFileSync(join(dir, m.name))));
  writeMaterialsIndex(projectId);
  return listPhotos(projectId).length;
}

/** 사진 목록(작업 폴더 기준 경로·픽셀 크기·출처 자료) — 올린 jpg·png 와 hwpx 에서 꺼낸 사진 */
export function listPhotos(projectId: string): { path: string; width: number; height: number; from: string; taken?: PhotoTaken }[] {
  const dir = materialsDir(projectId);
  const out: { path: string; width: number; height: number; from: string; taken?: PhotoTaken }[] = [];
  const add = (abs: string, rel: string, from: string) => {
    const bytes = new Uint8Array(readFileSync(abs));
    const info = imageInfo(bytes);
    // 카드뉴스·현수막처럼 길쭉한 그림(가로세로 2.5배 넘음)은 사진 후보에서 뺀다
    if (info && Math.max(info.width, info.height) / Math.min(info.width, info.height) <= 2.5) out.push({ path: rel, width: info.width, height: info.height, from, taken: readPhotoTaken(bytes) });
  };
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir).sort((a, b) => a.localeCompare(b, "ko"))) if (/\.(jpe?g|png|bmp)$/i.test(n) && statSync(join(dir, n)).isFile()) add(join(dir, n), `materials/${n}`, n);
  const img = join(dir, "images");
  if (existsSync(img)) for (const n of readdirSync(img).sort((a, b) => a.localeCompare(b, "ko"))) add(join(img, n), `materials/images/${n}`, n.replace(/_\d{2}\.(jpe?g|png|bmp)$/i, ".hwpx"));
  // 홈페이지(gepa.kr)에서 받은 사진 — 출처는 게시글 제목·게시일(lib/closeout/gepaSite.ts)
  for (const post of readSavedGepaPosts(dir))
    for (const rel of post.photos) {
      const abs = join(projectDir(projectId), rel);
      if (existsSync(abs)) add(abs, rel, `gepa.kr ${GEPA_BOARDS[post.board].label} 「${post.title}」(게시 ${post.date})`);
    }
  return out;
}

/** 압축 파일 한 개의 최대 크기 — 지급 공문 PDF 수십 건을 묶으면 200MB 안팎이 된다(실사용 2026-10-02) */
export const ZIP_MAX_BYTES = 400 * 1024 * 1024;

export function isZipName(name: string): boolean {
  return /\.zip$/i.test(name);
}

/**
 * zip 안의 파일 이름. UTF-8 표시(general purpose flag 11번 비트)가 없으면 fflate 는 바이트를 latin1 로
 * 읽는다 — Windows 탐색기·반디집이 만든 zip 의 한글 이름은 대개 CP949 이므로 바이트로 되돌려 다시 읽는다.
 */
export function zipEntryName(raw: string): string {
  if ([...raw].some((c) => c.charCodeAt(0) > 0xff)) return raw; // 이미 UTF-8 로 풀린 이름
  if (!/[\x80-\xff]/.test(raw)) return raw; // ASCII
  const bytes = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

/**
 * zip 을 풀어 안의 자료를 하나씩 저장한다. 폴더 구조는 버리고 파일 이름만 쓴다(이름이 겹치면 폴더 이름을
 * 앞에 붙인다). 받지 않는 형식·zip 속 zip·macOS 부산물은 건너뛰고 errors 로 알린다.
 */
export function saveZipMaterials(projectId: string, zipName: string, bytes: Uint8Array, box: MaterialBox = "materials"): { saved: string[]; errors: { name: string; message: string }[] } {
  if (bytes.byteLength > ZIP_MAX_BYTES) throw new Error(`압축 파일이 너무 큽니다(400MB 이하): ${zipName}`);
  const entries = unzipSync(bytes);
  const saved: string[] = [];
  const errors: { name: string; message: string }[] = [];
  const used = new Set<string>();
  for (const [rawPath, data] of Object.entries(entries)) {
    const path = zipEntryName(rawPath).replace(/\\/g, "/");
    if (path.endsWith("/") || path.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(path) || /(^|\/)Thumbs\.db$/i.test(path)) continue;
    const parts = path.split("/").filter(Boolean);
    let name = safeMaterialName(parts[parts.length - 1] ?? "");
    if (!name) continue;
    if (used.has(name) && parts.length > 1) name = safeMaterialName(`${parts[parts.length - 2]}_${name}`);
    used.add(name);
    if (isZipName(name)) {
      errors.push({ name: `${zipName}/${path}`, message: "압축 파일 안의 압축 파일은 풀지 않습니다 — 따로 올려 주세요" });
      continue;
    }
    try {
      saveMaterial(projectId, name, data, box);
      saved.push(name);
    } catch (e) {
      errors.push({ name: `${zipName}/${path}`, message: (e as Error).message });
    }
  }
  if (!saved.length && !errors.length) errors.push({ name: zipName, message: "압축 파일 안에 자료가 없습니다" });
  return { saved, errors };
}

export function deleteMaterial(projectId: string, rawName: string, box: MaterialBox = "materials"): boolean {
  const name = safeMaterialName(rawName);
  const dir = materialsDir(projectId, box);
  if (!existsSync(join(dir, name))) return false;
  for (const p of [join(dir, name), join(dir, "text", `${name}.md`), join(dir, "text", `${name}.note`), join(dir, "text", `${name}.scanfail`), join(dir, "pages", name.replace(/\.pdf$/i, ""))]) removeSync(p);
  if (box === "materials") removePhotosOf(projectId, name);
  writeIndex(projectId, box);
  return true;
}

export function listMaterials(projectId: string, box: MaterialBox = "materials"): MaterialInfo[] {
  const dir = materialsDir(projectId, box);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n !== "index.md" && n !== "text" && n !== "images" && statSync(join(dir, n)).isFile())
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => {
      const text = existsSync(join(dir, "text", `${name}.md`));
      const notePath = join(dir, "text", `${name}.note`);
      const note = existsSync(notePath) ? readFileSync(notePath, "utf8") || undefined : undefined;
      return { name, bytes: statSync(join(dir, name)).size, readPath: text ? `${box}/text/${name}.md` : `${box}/${name}`, mode: text ? "text" : "direct", note };
    });
}

function writeIndex(projectId: string, box: MaterialBox): void {
  if (box === "materials") writeMaterialsIndex(projectId);
  else writePriorIndex(projectId);
}

/** `prior/index.md` — 전년도 참고자료 목록과 쓰는 법(성과 분석 단계가 읽는다) */
export function writePriorIndex(projectId: string): void {
  const items = listMaterials(projectId, "prior");
  const lines = [
    "# 전년도 참고자료",
    "",
    "같은 사업의 **지난해** 결과보고서·정산보고서·계획서다. 올해 사업에 있었던 일이 아니다 — 올해 원장·실적·사진의 근거로 쓰지 않는다.",
    "쓰는 곳은 세 가지뿐이다: ① 전년 대비 수치(지원 규모·신청 수·성과), ② 지난해 「차년도 반영사항」을 올해 실제로 했는지, ③ 세부사업 이름·구성·표 모양.",
    "지난해 문장(특히 총평·성과)을 옮겨 쓰지 않는다 — 결과보고서에 같은 문장이 있으면 내보낼 때 경고가 뜬다.",
    "",
    ...(items.length ? items.map((m) => `- ${m.name} (${Math.max(1, Math.round(m.bytes / 1024))}KB) → \`${m.readPath}\` [${m.mode}]${m.note ? ` — ${m.note}` : ""}`) : ["(올린 전년도 자료가 없습니다)"]),
    "",
  ];
  writeFileSync(join(materialsDir(projectId, "prior"), "index.md"), lines.join("\n"), "utf8");
}

export function writeMaterialsIndex(projectId: string): void {
  const items = listMaterials(projectId);
  const lines = [
    "# 올린 자료",
    "",
    items.length ? "작업 폴더 기준 경로다. `text` 는 플랫폼이 옮긴 텍스트, `direct` 는 원본을 Read 로 직접 읽는다." : "(올린 자료가 없습니다)",
    "",
    ...items.map((m) => `- ${m.name} (${Math.max(1, Math.round(m.bytes / 1024))}KB) → \`${m.readPath}\` [${m.mode}]${m.note ? ` — ${m.note}` : ""}`),
    "",
  ];
  const photos = listPhotos(projectId);
  if (photos.length) {
    lines.push(
      "## 사진",
      "",
      "결과보고서 사진 대지(```photos)에 쓸 수 있는 사진이다. 넣기 전에 Read 로 열어 무엇을 찍은 사진인지 확인한다.",
      "촬영일은 사진 파일(EXIF)에 남은 날짜다 — 세부사업 일정과 맞춰 어느 행사·회차 사진인지 정하고 설명의 날짜로 쓴다. 「촬영일 없음」은 메신저로 주고받아 정보가 지워진 사진이니 그림과 파일 이름으로 판단한다.",
      "",
      ...photos.map((p) => `- \`${p.path}\` (${p.width}×${p.height}px) — 출처: ${p.from} — ${p.taken ? `촬영 ${takenLabel(p.taken)}` : "촬영일 없음"}`),
      "",
    );
  }
  const posts = readSavedGepaPosts(materialsDir(projectId));
  if (posts.length) {
    lines.push(
      "## 홈페이지 자료(gepa.kr)",
      "",
      "진흥원 홈페이지 보도자료·행사사진 게시판에서 사업명·세부사업 이름으로 찾은 글이다 — **이 사업의 행사가 아닐 수 있다.**",
      "글을 Read 해 사업명·행사 이름·일시가 이 사업의 계획·실적과 맞는지 먼저 확인하고, 맞는 글만 쓴다. 작성일은 게시일이다(행사일은 본문에서).",
      "사진은 올린 자료에 그 행사 사진이 없을 때만 사진 대지에 쓴다. 보도자료 본문은 행사 일시·참석 규모·내용을 확인하는 근거로 쓴다.",
      "",
      ...posts.map((p) => `- [${GEPA_BOARDS[p.board].label}] ${p.title} (게시 ${p.date}) → \`${p.textPath}\`${p.photos.length ? ` — 사진 ${p.photos.length}장` : ""}`),
      "",
    );
  }
  writeFileSync(join(materialsDir(projectId), "index.md"), lines.join("\n"), "utf8");
}
