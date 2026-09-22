/**
 * YAML front-matter handling for the GEPA document DSL.
 *
 * A DSL document starts with `---` … `---`; the block in between is YAML whose `family:` key
 * selects the meta schema (META_SCHEMAS). Everything after the closing `---` is the body.
 *
 * The functions here never throw: YAML syntax errors and schema violations are returned as
 * `errors`, softer problems (unknown keys, coerced numbers) as `warnings`.
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { FamilySchema, NoticeMetaSchema, OfficialMetaSchema, PlanMetaSchema, PressMetaSchema, ReportMetaSchema, type DocModel, type Family } from "../schema";

export interface FrontMatterIssue {
  /** 1-based line number in the original DSL text (best effort; 1 when unknown) */
  line: number;
  message: string;
  path?: string;
}

export interface FrontMatterValidation {
  family: Family | undefined;
  meta: DocModel["meta"] | undefined;
  /** raw YAML object as parsed (numbers already stringified), undefined on YAML syntax error */
  raw: Record<string, unknown> | undefined;
  errors: FrontMatterIssue[];
  warnings: FrontMatterIssue[];
}

export interface FrontMatterResult extends FrontMatterValidation {
  /** body text (everything after the closing `---`), '' when absent */
  body: string;
  /** 1-based line number of the first body line in the original text */
  bodyStartLine: number;
  /** true when a `---` … `---` block was found at the top of the text */
  hasFrontMatter: boolean;
}

export const META_SCHEMAS = {
  notice: NoticeMetaSchema,
  plan: PlanMetaSchema,
  press: PressMetaSchema,
  official: OfficialMetaSchema,
  report: ReportMetaSchema,
} as const;

/** `plan | notice | press | official | report` — 오류 메시지에 쓰는 family 목록 (스키마가 곧 출처다) */
const FAMILY_LIST = FamilySchema.options.join(" | ");

/** keys whose values are numeric in the meta schemas (everything else numeric is coerced to string) */
const NUMERIC_KEYS = new Set(["lineSpacing"]);

const FENCE = /^---\s*$/;
const FENCE_END = /^(---|\.\.\.)\s*$/;

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Split `---` … `---` front-matter from the body. Leading blank lines and a BOM before the
 * opening fence are tolerated. When no front-matter is present the whole text is the body.
 */
export function splitFrontMatter(text: string): { fmText: string | null; fmStartLine: number; body: string; bodyStartLine: number } {
  const src = normalizeNewlines(text.replace(/^﻿/, ""));
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || !FENCE.test(lines[i])) {
    return { fmText: null, fmStartLine: 0, body: src, bodyStartLine: 1 };
  }
  const open = i;
  let close = -1;
  for (let j = open + 1; j < lines.length; j++) {
    if (FENCE_END.test(lines[j])) {
      close = j;
      break;
    }
  }
  if (close < 0) {
    // unterminated front-matter: treat everything after the opening fence as YAML, no body
    return { fmText: lines.slice(open + 1).join("\n"), fmStartLine: open + 2, body: "", bodyStartLine: lines.length + 1 };
  }
  return {
    fmText: lines.slice(open + 1, close).join("\n"),
    fmStartLine: open + 2,
    body: lines.slice(close + 1).join("\n"),
    bodyStartLine: close + 2,
  };
}

/** Deep-convert numbers / Dates to strings except for known numeric keys. */
export function coerceScalars(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "bigint") {
    if (key && NUMERIC_KEYS.has(key)) return typeof value === "bigint" ? Number(value) : value;
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map((v) => coerceScalars(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = coerceScalars(v, k);
    return out;
  }
  return value;
}

/** Find the 1-based line (relative to fmText, offset applied) where a top-level key is declared. */
function lineOfKey(fmText: string, key: string | undefined, offset: number): number {
  if (!key) return offset;
  const lines = fmText.split("\n");
  const re = new RegExp("^\\s*" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:");
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return offset + i;
  return offset;
}

type AnyZod = z.ZodType;

function unwrapSchema(schema: AnyZod): AnyZod {
  let s: AnyZod = schema;
  // ZodOptional / ZodDefault / ZodNullable all expose unwrap()
  for (let guard = 0; guard < 8; guard++) {
    if (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable) s = s.unwrap() as AnyZod;
    else break;
  }
  return s;
}

/** Walk the schema alongside the value and report keys the schema does not know about. */
function collectUnknownKeys(schema: AnyZod, value: unknown, path: string, out: string[]): void {
  const s = unwrapSchema(schema);
  if (s instanceof z.ZodObject) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const shape = s.shape as Record<string, AnyZod>;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!(k in shape)) out.push(path ? `${path}.${k}` : k);
      else collectUnknownKeys(shape[k], v, path ? `${path}.${k}` : k, out);
    }
    return;
  }
  if (s instanceof z.ZodArray) {
    if (!Array.isArray(value)) return;
    value.forEach((v, i) => collectUnknownKeys(s.element as AnyZod, v, `${path}[${i}]`, out));
    return;
  }
  if (s instanceof z.ZodUnion) {
    if (!value || typeof value !== "object") return;
    const objectOptions = (s.options as AnyZod[]).map(unwrapSchema).filter((o) => o instanceof z.ZodObject);
    if (objectOptions.length === 1) collectUnknownKeys(objectOptions[0], value, path, out);
  }
}

/**
 * Parse and validate the YAML text between the fences. `lineOffset` is the 1-based line number
 * of the first YAML line in the original document (used for issue locations).
 */
export function validateFrontMatter(fmText: string, lineOffset = 2): FrontMatterValidation {
  const errors: FrontMatterIssue[] = [];
  const warnings: FrontMatterIssue[] = [];
  let parsed: unknown;
  try {
    parsed = parseYaml(fmText, { schema: "core" });
  } catch (e) {
    const err = e as { message?: string; linePos?: Array<{ line: number }> };
    const line = err.linePos?.[0]?.line ? lineOffset + err.linePos[0].line - 1 : lineOffset;
    errors.push({ line, message: `front-matter YAML 오류: ${err.message ?? String(e)}` });
    return { family: undefined, meta: undefined, raw: undefined, errors, warnings };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push({ line: lineOffset, message: "front-matter는 YAML 매핑(키: 값)이어야 합니다" });
    return { family: undefined, meta: undefined, raw: undefined, errors, warnings };
  }
  const raw = coerceScalars(parsed) as Record<string, unknown>;

  const familyParse = FamilySchema.safeParse(raw.family);
  if (!familyParse.success) {
    errors.push({
      line: lineOfKey(fmText, "family", lineOffset),
      message: raw.family === undefined ? `front-matter에 family 키가 없습니다 (${FAMILY_LIST})` : `family 값이 올바르지 않습니다: ${String(raw.family)} (${FAMILY_LIST})`,
      path: "family",
    });
    return { family: undefined, meta: undefined, raw, errors, warnings };
  }
  const family = familyParse.data;
  const { family: _omit, ...metaRaw } = raw;
  void _omit;

  const unknown: string[] = [];
  collectUnknownKeys(META_SCHEMAS[family], metaRaw, "", unknown);
  for (const k of unknown) {
    const top = k.split(/[.[]/)[0];
    warnings.push({
      line: lineOfKey(fmText, top, lineOffset),
      message: `front-matter에 알 수 없는 키: ${k}` + (k.includes("[") ? " (값에 쉼표가 있으면 따옴표로 감싸세요)" : ""),
      path: k,
    });
  }

  const result = META_SCHEMAS[family].safeParse(metaRaw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.map(String).join(".");
      errors.push({ line: lineOfKey(fmText, issue.path[0] !== undefined ? String(issue.path[0]) : undefined, lineOffset), message: `front-matter ${path || "(root)"}: ${issue.message}`, path });
    }
    return { family, meta: undefined, raw, errors, warnings };
  }
  return { family, meta: result.data as DocModel["meta"], raw, errors, warnings };
}

/** One-shot: split + validate. */
export function parseFrontMatter(text: string): FrontMatterResult {
  const split = splitFrontMatter(text);
  if (split.fmText === null) {
    return {
      family: undefined,
      meta: undefined,
      raw: undefined,
      errors: [{ line: 1, message: "문서 맨 앞에 --- 로 감싼 YAML front-matter가 필요합니다" }],
      warnings: [],
      body: split.body,
      bodyStartLine: split.bodyStartLine,
      hasFrontMatter: false,
    };
  }
  const v = validateFrontMatter(split.fmText, split.fmStartLine);
  return { ...v, body: split.body, bodyStartLine: split.bodyStartLine, hasFrontMatter: true };
}

/**
 * A schema-valid placeholder meta for a family, used so that a document with broken
 * front-matter still yields a well-formed DocModel (with errors attached).
 */
export function fallbackMeta(family: Family, raw?: Record<string, unknown>): DocModel["meta"] {
  const base: Record<Family, Record<string, unknown>> = {
    notice: {
      공고번호: "",
      사업명: "",
      주관기관: "",
      지역: "",
      공고연월: "",
      접수: { 이메일: "", 우편주소: "", 부서명: "", 전화: "" },
      모집개요: [],
      절차도: [],
    },
    plan: { 제목: "" },
    press: { 배포일: "", 담당부서: "", 담당자: "", 연락처: "", 제목: "" },
    // OfficialMetaSchema 의 제목·처리과는 .min(1) 이다. 빈 문자열을 두면 아래 마지막 줄의
    // `META_SCHEMAS[family].parse(base[family])` 가 던져서, front-matter 가 깨진 공문서는
    // 자리표시 DocModel 로 내려앉는 대신 파서 전체를 멈춘다.
    official: { 수신유형: "내부결재", 제목: "(제목 없음)", 처리과: "(처리과 없음)" },
    // ReportMetaSchema 는 여섯 칸이 모두 .default() 라 빈 객체가 그대로 파싱된다(.min(1) 이 없다).
    report: {},
  };
  const merged: Record<string, unknown> = { ...base[family] };
  if (raw) {
    for (const [k, v] of Object.entries(raw)) {
      if (k === "family") continue;
      const probe = { ...merged, [k]: v };
      if (META_SCHEMAS[family].safeParse(probe).success) merged[k] = v;
    }
  }
  const parsed = META_SCHEMAS[family].safeParse(merged);
  return (parsed.success ? parsed.data : META_SCHEMAS[family].parse(base[family])) as DocModel["meta"];
}
