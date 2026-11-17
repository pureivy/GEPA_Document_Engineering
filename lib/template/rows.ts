/**
 * 양식 맞춰 쓰기 — 표 행 넣기·빼기. 문단 고침(engine.applyEdits)이 끝난 결과에 적용한다.
 *
 * 월별 사업 추진 현황처럼 사업 수가 달마다 바뀌는 보고는 표의 행 수가 달라진다. 문단만 다룰 때는 모자란 행을 한 칸에 두 줄로
 * 끼워 넣고 남는 행은 비워 둘 수밖에 없었다(2026-11-17 10월 현황: 표9 한 행 모자람, 표12 열한 행 남음).
 *
 * HWPX 의 표는 <hp:tr> 마다 칸(<hp:tc>)이 있고, 칸의 <hp:cellAddr rowAddr> 가 행 번호다. 위아래로 합친 칸(rowSpan>1)이
 * 걸린 자리에서 행을 넣거나 빼면 표가 깨지므로 그런 자리는 하지 않고 까닭을 남긴다. 안에 표가 든 표도 하지 않는다.
 */
import { zipSync, type Zippable } from "fflate";
import { escapeText } from "../hwpx/xml";
import { readTemplate, type TemplateEdit } from "./engine";

type RowOp = Extract<TemplateEdit, { table: number }>;

export interface RowResult {
  bytes: Uint8Array;
  changes: { table: number; kind: "행 넣음" | "행 지움"; row: number; text: string }[];
  errors: string[];
}

interface TableSpan {
  num: number;
  section: number;
  start: number;
  end: number;
}

/** 문서 순서대로 표(여는 태그 순서 = engine 의 표 번호)와 그 범위 */
function tablesOf(sections: string[]): TableSpan[] {
  const out: TableSpan[] = [];
  let num = 0;
  sections.forEach((xml, section) => {
    const stack: TableSpan[] = [];
    for (const m of xml.matchAll(/<hp:tbl\b[^>]*>|<\/hp:tbl>/g)) {
      if (m[0].startsWith("</")) {
        const t = stack.pop();
        if (t) t.end = m.index + m[0].length;
      } else {
        const t: TableSpan = { num: ++num, section, start: m.index, end: -1 };
        out.push(t);
        stack.push(t);
      }
    }
  });
  return out;
}

/** 표 문자열에서 바로 아래 행들의 [시작, 끝) — 안에 표가 있으면 null */
function rowsOf(tbl: string): [number, number][] | null {
  if ((tbl.match(/<hp:tbl\b/g) ?? []).length > 1) return null;
  const out: [number, number][] = [];
  for (const m of tbl.matchAll(/<hp:tr>[\s\S]*?<\/hp:tr>/g)) out.push([m.index, m.index + m[0].length]);
  return out;
}

const rowSpans = (row: string) => [...row.matchAll(/<hp:cellSpan\b[^>]*rowSpan="(\d+)"/g)].map((m) => Number(m[1]));

/** 칸마다 글을 바꾼 행 — 칸의 첫 글자 자리에 글을 넣고 나머지 글자 자리는 비운다. null·undefined 칸은 그대로 */
function fillRow(row: string, cells: (string | null)[]): string {
  let c = -1;
  return row
    .replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
      c++;
      const v = cells[c];
      if (v === null || v === undefined) return tc;
      let first = true;
      return tc.replace(/<hp:t>[\s\S]*?<\/hp:t>|<hp:t\/>/g, () => {
        if (!first) return "<hp:t/>";
        first = false;
        return v === "" ? "<hp:t/>" : `<hp:t>${escapeText(v)}</hp:t>`;
      });
    })
    .replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, "");
}

const rowText = (row: string) =>
  [...row.matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)].map((tc) => [...tc[0].matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((t) => t[1].replace(/<[^>]+>/g, "")).join("")).join(" | ");

/**
 * deletedTables: 문단 고침에서 통째로 지운 표의 원본 번호 — 그 뒤 표들의 번호가 당겨진 것을 되돌려 원본 번호로 찾는다.
 */
export function applyRowOps(bytes: Uint8Array, ops: RowOp[], deletedTables: Set<number> = new Set()): RowResult {
  const changes: RowResult["changes"] = [];
  const errors: string[] = [];
  if (!ops.length) return { bytes, changes, errors };
  const doc = readTemplate(bytes);
  const sections = [...doc.sections];
  // 원본 표 번호 → 지금 파일의 표 번호
  const now = (orig: number) => (deletedTables.has(orig) ? -1 : orig - [...deletedTables].filter((d) => d < orig).length);
  const byTable = new Map<number, RowOp[]>();
  for (const op of ops) {
    if (!byTable.has(op.table)) byTable.set(op.table, []);
    byTable.get(op.table)!.push(op);
  }
  // 뒤 표부터 바꿔 앞 표의 위치가 흔들리지 않게
  const order = [...byTable.keys()].sort((a, b) => now(b) - now(a));
  for (const orig of order) {
    const list = byTable.get(orig)!;
    const cur = now(orig);
    const t = tablesOf(sections).find((x) => x.num === cur);
    if (cur < 0 || !t) {
      errors.push(`표${orig}: 없거나 지운 표라 행을 바꿀 수 없습니다`);
      continue;
    }
    const xml = sections[t.section];
    const tbl = xml.slice(t.start, t.end);
    const spans = rowsOf(tbl);
    if (!spans || !spans.length) {
      errors.push(`표${orig}: 안에 표가 든 표라 행을 넣거나 빼지 않습니다`);
      continue;
    }
    const rows = spans.map(([a, b]) => tbl.slice(a, b));
    // 행 i 의 칸이 아래로 몇 행을 덮는지 — 덮인 구간 [i, i+span-1]
    const covers = rows.flatMap((r, i) => rowSpans(r).filter((s) => s > 1).map((s) => [i, i + s - 1] as [number, number]));
    const crossesBoundary = (after: number) => covers.some(([a, b]) => a <= after - 1 && b >= after); // after(1부터) 행과 다음 행 사이를 가로지르는가
    const touches = (row: number) => covers.some(([a, b]) => a <= row - 1 && b >= row - 1);
    const next = [...rows];
    // 뒤 행부터(같은 행이면 넣기 먼저) — 앞 행 번호가 흔들리지 않게
    const sorted = [...list].sort((a, b) => ("deleteRow" in b ? b.deleteRow : b.insertRowAfter) - ("deleteRow" in a ? a.deleteRow : a.insertRowAfter));
    for (const op of sorted) {
      if ("deleteRow" in op) {
        const r = op.deleteRow;
        if (!(r >= 1 && r <= rows.length)) errors.push(`표${orig}: ${r}행이 없습니다(1~${rows.length}행)`);
        else if (rows.length <= 1) errors.push(`표${orig}: 하나뿐인 행은 뺄 수 없습니다`);
        else if (touches(r)) errors.push(`표${orig}: ${r}행은 위아래로 합친 칸에 걸려 있어 빼지 않았습니다 — 한글에서 빼 주세요`);
        else {
          changes.push({ table: orig, kind: "행 지움", row: r, text: rowText(rows[r - 1]) });
          next.splice(r - 1, 1);
        }
        continue;
      }
      const after = op.insertRowAfter;
      const like = op.like ?? after;
      if (!(after >= 0 && after <= rows.length) || !(like >= 1 && like <= rows.length)) {
        errors.push(`표${orig}: 행 번호가 맞지 않습니다(넣을 자리 ${after}, 본뜰 행 ${like} — 표는 1~${rows.length}행)`);
        continue;
      }
      if (after > 0 && after < rows.length && crossesBoundary(after)) {
        errors.push(`표${orig}: ${after}행과 ${after + 1}행 사이는 위아래로 합친 칸이 가로질러 행을 넣지 않았습니다 — 한글에서 넣어 주세요`);
        continue;
      }
      if (rowSpans(rows[like - 1]).some((s) => s > 1)) {
        errors.push(`표${orig}: ${like}행은 위아래로 합친 칸이 있어 본뜰 수 없습니다 — 합친 칸이 없는 행을 본뜹니다`);
        continue;
      }
      const row = fillRow(rows[like - 1], Array.isArray(op.cells) ? op.cells : []);
      // 같은 자리에 여러 행을 넣으면 적은 순서대로 남게 — 이미 넣은 행 뒤에 붙인다
      const idx = next.slice(after).findIndex((r) => !r.startsWith("<!--new-->"));
      next.splice(idx < 0 ? next.length : after + idx, 0, `<!--new-->${row}`);
      changes.push({ table: orig, kind: "행 넣음", row: after + 1, text: rowText(row) });
    }
    // 행 번호(rowAddr)를 다시 매기고 표의 행 수를 고친다. 표를 품은 문단의 줄 정보는 지워 한글이 다시 잰다
    const body = next.map((r, i) => r.replace("<!--new-->", "").replace(/(<hp:cellAddr\b[^>]*rowAddr=")\d+/g, `$1${i}`)).join("");
    const head = tbl.slice(0, spans[0][0]).replace(/(\browCnt=")\d+/, `$1${next.length}`);
    const tail = tbl.slice(spans[spans.length - 1][1]);
    // 위아래로 합친 칸이 있는 표는 rowAddr 가 행 순서와 같다(덮인 자리의 칸은 tr 에 없다) — 행 순서로 다시 매기면 맞다
    sections[t.section] = xml.slice(0, t.start) + head + body + tail + xml.slice(t.end);
  }
  const enc = new TextEncoder();
  const out: Zippable = {};
  for (const [name, data] of Object.entries(doc.entries)) {
    const si = doc.sectionNames.indexOf(name);
    const b = si >= 0 ? enc.encode(sections[si]) : data;
    out[name] = name === "mimetype" ? [b, { level: 0 }] : [b, { level: 6 }];
  }
  return { bytes: zipSync(out, { mtime: new Date("1980-01-01T00:00:00Z") }), changes, errors };
}
