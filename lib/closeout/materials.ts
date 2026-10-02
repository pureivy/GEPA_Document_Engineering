/**
 * 정산·결과보고 자료함 — `projects/<id>/materials/`.
 *
 * 사업계획서 갱신(reference)은 파일이 하나지만, 정산·결과보고에는 여러 파일이 함께 온다:
 * 사업계획서·교부결정서(hwp/pdf), 예산집행 집계표·통장거래내역·ERP 지출결의(xlsx/csv), 행사 사진·결과 메모.
 * 원본은 `materials/<이름>` 에, 에이전트가 읽을 텍스트는 `materials/text/<이름>.md` 에 둔다.
 * `materials/index.md` 가 목록이다 — 에이전트는 이것부터 읽는다.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { projectDir } from "../storage/paths";
import { extractReferenceText, referenceExtension } from "../reference/extract";
import { readCsv, readXlsx, sheetsToMarkdown } from "./sheet";

export const MATERIAL_EXTENSIONS = [".xlsx", ".csv", ".hwp", ".hwpx", ".pdf", ".docx", ".md", ".txt", ".png", ".jpg", ".jpeg"] as const;
export const MATERIAL_MAX_BYTES = 30 * 1024 * 1024;

export interface MaterialInfo {
  name: string;
  bytes: number;
  /** 에이전트가 읽을 파일(작업 폴더 기준 상대 경로) */
  readPath: string;
  /** 텍스트로 옮겼는가, 원본을 직접 읽어야 하는가 */
  mode: "text" | "direct";
  note?: string;
}

export function materialsDir(projectId: string): string {
  return join(projectDir(projectId), "materials");
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
  throw new Error(`지원하지 않는 파일 형식입니다: ${name} (${MATERIAL_EXTENSIONS.join(", ")}). .xls 는 .xlsx 로 다시 저장해 올려 주세요`);
}

export function saveMaterial(projectId: string, rawName: string, bytes: Uint8Array): MaterialInfo {
  const name = safeMaterialName(rawName);
  if (!name || !materialExtension(name)) throw new Error(`지원하지 않는 파일 형식입니다: ${rawName} (${MATERIAL_EXTENSIONS.join(", ")}). .xls 는 .xlsx 로 다시 저장해 올려 주세요`);
  if (bytes.byteLength > MATERIAL_MAX_BYTES) throw new Error(`파일이 너무 큽니다(30MB 이하): ${name}`);
  const t = materialText(name, bytes); // 먼저 변환해 보고 실패하면 저장하지 않는다
  const dir = materialsDir(projectId);
  mkdirSync(join(dir, "text"), { recursive: true });
  writeFileSync(join(dir, name), bytes);
  if ("text" in t) writeFileSync(join(dir, "text", `${name}.md`), t.text, "utf8");
  else rmSync(join(dir, "text", `${name}.md`), { force: true });
  writeFileSync(join(dir, "text", `${name}.note`), "direct" in t ? t.direct : "", "utf8");
  writeMaterialsIndex(projectId);
  return listMaterials(projectId).find((m) => m.name === name)!;
}

export function deleteMaterial(projectId: string, rawName: string): boolean {
  const name = safeMaterialName(rawName);
  const dir = materialsDir(projectId);
  if (!existsSync(join(dir, name))) return false;
  for (const p of [join(dir, name), join(dir, "text", `${name}.md`), join(dir, "text", `${name}.note`)]) rmSync(p, { force: true });
  writeMaterialsIndex(projectId);
  return true;
}

export function listMaterials(projectId: string): MaterialInfo[] {
  const dir = materialsDir(projectId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n !== "index.md" && n !== "text" && statSync(join(dir, n)).isFile())
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => {
      const text = existsSync(join(dir, "text", `${name}.md`));
      const notePath = join(dir, "text", `${name}.note`);
      const note = existsSync(notePath) ? readFileSync(notePath, "utf8") || undefined : undefined;
      return { name, bytes: statSync(join(dir, name)).size, readPath: text ? `materials/text/${name}.md` : `materials/${name}`, mode: text ? "text" : "direct", note };
    });
}

function writeMaterialsIndex(projectId: string): void {
  const items = listMaterials(projectId);
  const lines = [
    "# 올린 자료",
    "",
    items.length ? "작업 폴더 기준 경로다. `text` 는 플랫폼이 옮긴 텍스트, `direct` 는 원본을 Read 로 직접 읽는다." : "(올린 자료가 없습니다)",
    "",
    ...items.map((m) => `- ${m.name} (${Math.max(1, Math.round(m.bytes / 1024))}KB) → \`${m.readPath}\` [${m.mode}]${m.note ? ` — ${m.note}` : ""}`),
    "",
  ];
  writeFileSync(join(materialsDir(projectId), "index.md"), lines.join("\n"), "utf8");
}
