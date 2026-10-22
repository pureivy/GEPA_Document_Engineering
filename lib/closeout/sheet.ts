/**
 * 엑셀(.xlsx)·CSV → 에이전트가 읽는 텍스트. 엑셀 97-2003(.xls)은 xls.ts 가 같은 Sheet[] 로 읽는다.
 *
 * 담당자가 올리는 자료(예산집행 집계표, 통장거래내역, ERP 지출결의 내려받기)는 양식이 제각각이다.
 * 여기서는 해석하지 않고 **시트를 있는 그대로 옮긴다** — 열 이름을 보고 원장 칸에 대응시키는 일은
 * 정산자료 단계 에이전트가 한다. 셀 주소(A1)를 행 머리에 남겨 원장의 `출처`로 되짚을 수 있게 한다.
 *
 * 외부 의존 없이 fflate(zip) + 정규식으로 읽는다. 날짜 서식 셀은 YYYY-MM-DD 로 바꾼다
 * (엑셀 일련번호 45754 를 그대로 주면 에이전트가 날짜로 읽지 못한다).
 */
import { unzipSync } from "fflate";

export const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** 사용자 정의 서식 코드가 날짜인가 — 따옴표 글자·[색]·[$-412] 를 빼고 y·m·d 가 남는가 */
export function isDateFormatCode(code: string): boolean {
  const c = code.replace(/"[^"]*"|\[[^\]]*\]/g, "");
  return /[ymd]/i.test(c) && !/^[#0.,%\s]*$/.test(c);
}
/** 시트 하나에 싣는 최대 행 — 통장내역 수천 행이 프롬프트를 잡아먹지 않게 */
export const SHEET_MAX_ROWS = 3000;

export function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** <si> / <is> 안의 모든 <t> 를 잇는다(서식이 섞인 rich text 도) */
function richText(xml: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += decode(m[1] ?? "");
  return out;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** 엑셀 일련번호 → YYYY-MM-DD (1900 체계, 1900-02-29 버그 보정). 1904 체계 파일은 호출 측이 1462 를 더한다 */
export function excelSerialDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const iso = d.toISOString();
  const hasTime = serial % 1 !== 0 && Math.abs((serial % 1) * 86400) >= 1;
  return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

/** 숫자 셀 → 글자. 날짜 서식이면 YYYY-MM-DD, 아니면 부동소수 찌꺼기(0.1+0.2)를 15자리로 자른다 */
export function cellNumber(n: number, isDate: boolean): string {
  return isDate && n > 0 && n < 2958466 ? excelSerialDate(n) : String(+n.toPrecision(15));
}

export interface Sheet {
  name: string;
  rows: string[][];
  /** 1-based 원래 행 번호 */
  rowNumbers: number[];
  truncated: boolean;
}

export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = unzipSync(bytes);
  const text = (p: string) => (files[p] ? new TextDecoder().decode(files[p]) : "");
  const shared: string[] = [];
  const sst = text("xl/sharedStrings.xml");
  for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(richText(m[1]));

  // 셀 서식(s=) → 날짜 서식인가
  const styles = text("xl/styles.xml");
  const customDate = new Set<number>();
  for (const m of styles.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)) {
    if (isDateFormatCode(decode(m[2]))) customDate.add(Number(m[1]));
  }
  const xfDate: boolean[] = [];
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  for (const m of cellXfs.matchAll(/<xf\s[^>]*?numFmtId="(\d+)"/g)) {
    const id = Number(m[1]);
    xfDate.push(BUILTIN_DATE_FORMATS.has(id) || customDate.has(id));
  }

  // 시트 이름과 파일 경로
  const wb = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) target.set(m[1], m[2]);
  for (const m of rels.matchAll(/<Relationship\s[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)) target.set(m[2], m[1]);
  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\s[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) {
    const t = target.get(m[2]);
    if (!t) continue;
    const path = t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`;
    sheets.push(readSheet(decode(m[1]), text(path), shared, xfDate));
  }
  return sheets;
}

function readSheet(name: string, xml: string, shared: string[], xfDate: boolean[]): Sheet {
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  let truncated = false;
  for (const rm of xml.matchAll(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1);
    const cells: string[] = [];
    for (const cm of (rm[2] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : cells.length;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = richText(body);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (type === "str" || type === "e") value = decode(v ?? "");
      else if (v !== undefined) {
        const n = Number(v);
        value = Number.isFinite(n) ? cellNumber(n, style >= 0 && xfDate[style]) : v;
      }
      cells[idx] = value.replace(/\s+/g, " ").trim();
    }
    if (!cells.some((c) => c)) continue;
    if (rows.length >= SHEET_MAX_ROWS) {
      truncated = true;
      break;
    }
    rows.push(Array.from({ length: cells.length }, (_, i) => cells[i] ?? ""));
    rowNumbers.push(rowNo);
  }
  return { name, rows, rowNumbers, truncated };
}

/** RFC 4180 CSV (UTF-8, BOM 허용). 한국 은행 내려받기의 CP949 는 받지 않는다 — 호출 측이 판별한다. */
export function readCsv(text: string): Sheet {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const kept = rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
  const truncated = kept.length > SHEET_MAX_ROWS;
  const out = kept.slice(0, SHEET_MAX_ROWS);
  return { name: "CSV", rows: out, rowNumbers: out.map((_, i) => i + 1), truncated };
}

/** 시트들을 마크다운으로 — 행 머리에 원래 행 번호, 머리에 열 문자(A, B, …) */
export function sheetsToMarkdown(fileName: string, sheets: Sheet[]): string {
  const out = [`# 자료 — ${fileName}`, "", "> 엑셀을 그대로 옮긴 것입니다. 첫 열 `행` 은 원래 엑셀의 행 번호, 머리의 A·B·C 는 열 문자입니다.", ""];
  for (const sh of sheets) {
    out.push(`## 시트: ${sh.name} (${sh.rows.length}행${sh.truncated ? `, ${SHEET_MAX_ROWS}행 이후 생략` : ""})`, "");
    if (!sh.rows.length) {
      out.push("(빈 시트)", "");
      continue;
    }
    const width = Math.max(...sh.rows.map((r) => r.length));
    const esc = (c: string) => c.replace(/\|/g, "\\|");
    out.push(`| 행 | ${Array.from({ length: width }, (_, i) => colName(i)).join(" | ")} |`);
    out.push(`|---|${"---|".repeat(width)}`);
    sh.rows.forEach((r, i) => out.push(`| ${sh.rowNumbers[i]} | ${Array.from({ length: width }, (_, j) => esc(r[j] ?? "")).join(" | ")} |`));
    out.push("");
  }
  return out.join("\n");
}
