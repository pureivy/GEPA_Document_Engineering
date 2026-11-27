/**
 * 양식 맞춰 쓰기 — 담당자가 준 한글 파일(양식)을 **버리지 않고** 그 안의 글자만 바꾼다.
 *
 * 다른 종류(계획서·업무보고·공문·결과보고)는 AI 원고(DSL)를 우리 작성기가 새로 그린다. 그래서 담당자가
 * "이 양식대로 내용만 바꿔 줘"라고 해도 원본 모양을 따를 길이 없었다(2026-11-16 경영목표: 원본과 전혀 다른
 * 간략 보고가 나왔다). 같은 날 VS(Claude Code)에서는 원본 hwpx 의 글자만 바꿔 서식(header.xml)이 바이트까지
 * 같은 파일이 나왔다 — 이 모듈은 그 방식을 시스템으로 옮긴 것이다.
 *
 * 흐름: 양식 → `listParagraphs` → 번호 붙은 문단 목록(AI가 읽는다) → AI가 쓴 고칠 목록(TemplateEdits)
 *       → `applyEdits` → 새 hwpx. 목록에 없는 문단은 원본 XML 그대로라 **바뀔 수가 없다**(범위 잠금).
 *
 * 문단 번호는 section 순서대로 모든 <hp:p>(표 칸 안 포함)에 0부터 매긴다 — 원본이 같으면 번호도 같다.
 * 고칠 목록은 늘 **원본 기준**이다: 이어서 고칠 때도 원본 + 누적 목록으로 다시 만든다.
 */
import { unzipSync, zipSync, type Zippable } from "fflate";
import { escapeText } from "../hwpx/xml";

export interface TRun {
  /** 문단 안에서의 순서(0부터) — AI가 고칠 칸을 가리키는 번호 */
  k: number;
  /** <hp:t …> 여는 태그 시작 ~ </hp:t> 끝(자기닫힘이면 그 태그) — 원본 섹션 문자열 기준 */
  start: number;
  end: number;
  text: string;
  charPr?: string;
  /** 원본 hp:t 안에 있던 탭 태그(다시 쓸 때 \t 자리에 쓴다) */
  tabTag?: string;
}

export interface TParagraph {
  /** 문서 전체 번호 */
  id: number;
  section: number;
  start: number;
  end: number;
  runs: TRun[];
  /** 이 문단 자신의 <hp:linesegarray> 범위 — 글자를 바꾸면 지워 한글이 다시 줄을 나누게 한다 */
  lineseg?: [number, number];
  /** 표 칸 안이면 그 칸 */
  cell?: { table: number; row: number; col: number };
  /** 이 문단이 품은 표 번호(문단을 지우면 표가 통째로 지워진다) */
  tables: number[];
  /** 그림·글상자 등 다른 개체를 품었는가 */
  hasObject: boolean;
  /** 구역 정의(<hp:secPr>)를 품은 첫 문단 — 지우면 안 된다 */
  hasSecPr: boolean;
  /** 표 칸 안 문단의 바깥 문단 번호(바로 위) */
  parent?: number;
  /** 문단을 담은 상자(<hp:subList> — 표 칸·글상자) 번호. 상자에 문단이 하나도 없으면 한글이 열다 죽는다 */
  box?: number;
}

export interface TemplateDoc {
  /** zip 안의 이름 → 바이트(원본 그대로) */
  entries: Record<string, Uint8Array>;
  sectionNames: string[];
  sections: string[];
  paragraphs: TParagraph[];
  /** charPr id → 짧은 설명(굵게·크기 등) */
  charHints: Record<string, string>;
  /** 표 번호 → 행·열 수(hp:tbl 의 rowCnt·colCnt) */
  tableDims: Record<number, { rows: number; cols: number }>;
}

/** 고칠 목록 — AI가 template/edits.json 에 쓴다 */
export interface TemplateEdits {
  edits: TemplateEdit[];
}
export type TemplateEdit =
  /** 문단 p 의 칸(run) 글자를 바꾼다. runs 의 키는 칸 번호, 값은 새 글자("" 이면 그 칸을 비운다) */
  | { p: number; runs: Record<string, string> }
  /** 문단 p 를 지운다(표를 품은 문단이면 표가 통째로 지워진다) */
  | { p: number; delete: true }
  /** 문단 like 를 본떠 새 문단을 after 뒤에 넣는다. runs 로 칸 글자를 바꾼다(안 적은 칸은 본뜬 글자 그대로) */
  | { insertAfter: number; like: number; runs: Record<string, string> }
  /** 표 table 의 row 행(1부터) 뒤에 like 행(없으면 row 행)을 본뜬 새 행을 넣는다. cells[i] 는 i+1 열 칸의 글(null 이면 본뜬 글 그대로) — rows.ts */
  | { table: number; insertRowAfter: number; like?: number; cells: (string | null)[] }
  /** 표 table 의 row 행(1부터)을 뺀다 — rows.ts */
  | { table: number; deleteRow: number };

const SECTION_RE = /^Contents\/section(\d+)\.xml$/;

export function decodeXmlText(s: string): string {
  return s
    .replace(/<hp:tab\b[^>]*\/>/g, "\t")
    .replace(/<hp:lineBreak\b[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** 글자 → hp:t 안쪽 XML. 탭·줄바꿈은 원본의 태그 모양을 쓴다 */
function encodeRunText(text: string, tabTag = "<hp:tab/>"): string {
  return text
    .split("\n")
    .map((line) => line.split("\t").map(escapeText).join(tabTag))
    .join("<hp:lineBreak/>");
}

function charHintsOf(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<hh:charPr\b([^>]*)>([\s\S]*?)<\/hh:charPr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header))) {
    const id = /\bid="(\d+)"/.exec(m[1])?.[1];
    if (!id) continue;
    const hints: string[] = [];
    if (/<hh:bold\b/.test(m[2])) hints.push("굵게");
    // 각주 표시용 첨자 칸 — 본문 글을 넣으면 아주 작게 찍힌다(2026-11-26 「'모두의 성장' 추진」)
    if (/<hh:supscript\b/.test(m[2])) hints.push("윗첨자");
    if (/<hh:subscript\b/.test(m[2])) hints.push("아랫첨자");
    const color = /\btextColor="#([0-9A-Fa-f]{6})"/.exec(m[1])?.[1];
    if (color && color.toUpperCase() !== "000000") hints.push(`색#${color.toUpperCase()}`);
    const h = /\bheight="(\d+)"/.exec(m[1])?.[1];
    if (h) hints.push(`${Number(h) / 100}pt`);
    out[id] = hints.join(" ");
  }
  return out;
}

const TOKEN_RE = /<(\/?)(hp:p|hp:t|hp:run|hp:linesegarray|hp:tbl|hp:tc|hp:cellAddr|hp:subList|hp:secPr|hp:pic|hp:rect|hp:ellipse|hp:container|hp:equation|hp:ole)\b([^>]*?)(\/?)>/g;

function parseSection(xml: string, section: number, firstId: number, tableBase: number): { paragraphs: TParagraph[]; tables: number } {
  const paragraphs: TParagraph[] = [];
  const pStack: TParagraph[] = [];
  const cellStack: { table: number; row: number; col: number; paras: TParagraph[] }[] = [];
  const tblStack: number[] = [];
  const boxStack: number[] = [];
  let boxes = 0;
  let tables = 0;
  let charPr: string | undefined;
  let id = firstId;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(xml))) {
    const [whole, close, name, attrs, selfClose] = m;
    const at = m.index;
    const top = pStack[pStack.length - 1];
    if (name === "hp:p") {
      if (!close) {
        const cell = cellStack[cellStack.length - 1];
        const box = boxStack[boxStack.length - 1];
        const p: TParagraph = { id: id++, section, start: at, end: -1, runs: [], tables: [], hasObject: false, hasSecPr: false, ...(top ? { parent: top.id } : {}), ...(box !== undefined ? { box } : {}) };
        if (cell) cell.paras.push(p);
        paragraphs.push(p);
        pStack.push(p);
      } else {
        const p = pStack.pop();
        if (p) p.end = at + whole.length;
      }
    } else if (name === "hp:run" && !close) {
      charPr = /charPrIDRef="(\d+)"/.exec(attrs)?.[1];
    } else if (name === "hp:t" && !close && top) {
      if (selfClose) {
        top.runs.push({ k: top.runs.length, start: at, end: at + whole.length, text: "", charPr });
      } else {
        const endTag = xml.indexOf("</hp:t>", at);
        if (endTag < 0) continue;
        const inner = xml.slice(at + whole.length, endTag);
        const tabTag = /<hp:tab\b[^>]*\/>/.exec(inner)?.[0];
        top.runs.push({ k: top.runs.length, start: at, end: endTag + "</hp:t>".length, text: decodeXmlText(inner), charPr, ...(tabTag ? { tabTag } : {}) });
        TOKEN_RE.lastIndex = endTag + "</hp:t>".length;
      }
    } else if (name === "hp:linesegarray" && !close && top) {
      if (selfClose) top.lineseg = [at, at + whole.length];
      else {
        const endTag = xml.indexOf("</hp:linesegarray>", at);
        if (endTag >= 0) {
          top.lineseg = [at, endTag + "</hp:linesegarray>".length];
          TOKEN_RE.lastIndex = endTag + "</hp:linesegarray>".length;
        }
      }
    } else if (name === "hp:tbl") {
      if (!close && !selfClose) {
        const n = tableBase + ++tables;
        tblStack.push(n);
        if (top) top.tables.push(n);
      } else if (close) tblStack.pop();
    } else if (name === "hp:tc") {
      if (!close) cellStack.push({ table: tblStack[tblStack.length - 1] ?? 0, row: -1, col: -1, paras: [] });
      else {
        const c = cellStack.pop();
        if (c) for (const p of c.paras) p.cell = { table: c.table, row: c.row, col: c.col };
      }
    } else if (name === "hp:cellAddr" && !close) {
      const c = cellStack[cellStack.length - 1];
      if (c) {
        c.col = Number(/colAddr="(\d+)"/.exec(attrs)?.[1] ?? -1);
        c.row = Number(/rowAddr="(\d+)"/.exec(attrs)?.[1] ?? -1);
      }
    } else if (name === "hp:subList") {
      // 번호는 섹션마다 따로 매기므로 섹션 번호를 앞에 붙여 겹치지 않게 한다
      if (!close && !selfClose) boxStack.push(section * 1_000_000 + ++boxes);
      else if (close) boxStack.pop();
    } else if (name === "hp:secPr" && !close && top) {
      top.hasSecPr = true;
    } else if (!close && top) {
      // 그림·도형 등 — 본뜨기(insert like)에 쓰지 않는다
      top.hasObject = true;
    }
  }
  return { paragraphs, tables };
}

export function readTemplate(bytes: Uint8Array): TemplateDoc {
  const entries = unzipSync(bytes);
  const sectionNames = Object.keys(entries)
    .filter((n) => SECTION_RE.test(n))
    .sort((a, b) => Number(SECTION_RE.exec(a)![1]) - Number(SECTION_RE.exec(b)![1]));
  if (!sectionNames.length) throw new Error("한글(hwpx) 문서의 본문(section)을 찾지 못했습니다");
  const dec = new TextDecoder();
  const sections = sectionNames.map((n) => dec.decode(entries[n]));
  const paragraphs: TParagraph[] = [];
  let tableBase = 0;
  sections.forEach((xml, i) => {
    const r = parseSection(xml, i, paragraphs.length, tableBase);
    paragraphs.push(...r.paragraphs);
    tableBase += r.tables;
  });
  const header = entries["Contents/header.xml"] ? dec.decode(entries["Contents/header.xml"]) : "";
  // 표 번호는 여는 태그 순서다(parseSection 과 같은 순서) — 행·열 수를 함께 둔다
  const tableDims: TemplateDoc["tableDims"] = {};
  let tn = 0;
  for (const xml of sections)
    for (const m of xml.matchAll(/<hp:tbl\b([^>]*)>/g)) tableDims[++tn] = { rows: Number(/rowCnt="(\d+)"/.exec(m[1])?.[1] ?? 0), cols: Number(/colCnt="(\d+)"/.exec(m[1])?.[1] ?? 0) };
  return { entries, sectionNames, sections, paragraphs, charHints: charHintsOf(header), tableDims };
}

export function paragraphText(p: TParagraph): string {
  return p.runs.map((r) => r.text).join("");
}

/**
 * AI가 읽는 문단 목록. 한 줄에 문단 하나:
 *   `12 [표3 2행1열] ⟦0⟧❖ ⟦1 굵게⟧(도정 연계) ⟦2⟧민선9기 …`
 * 빈 문단은 빼되(번호는 그대로 건너뛴다), 표 칸 안의 빈 문단은 채울 수 있게 `(빈 칸)` 으로 보인다.
 */
export function listParagraphs(doc: TemplateDoc, title = "양식"): string {
  const lines: string[] = [
    `# ${title} — 문단 목록`,
    "",
    "한 줄이 문단 하나다. 맨 앞 숫자가 문단 번호, `⟦칸⟧` 뒤가 그 칸(같은 글자 모양이 이어진 조각)의 글자다.",
    "`[표N r행c열]` 은 표 칸 안의 문단, `[표N]` 은 그 표를 품은 문단, `[그림]` 은 그림·도형을 품은 문단이다.",
    "",
  ];
  for (const p of doc.paragraphs) {
    const text = paragraphText(p);
    const tags: string[] = [];
    if (p.cell) tags.push(`[표${p.cell.table} ${p.cell.row + 1}행${p.cell.col + 1}열]`);
    for (const t of p.tables) tags.push(doc.tableDims[t] ? `[표${t} ${doc.tableDims[t].rows}행×${doc.tableDims[t].cols}열]` : `[표${t}]`);
    if (p.hasObject) tags.push("[그림]");
    if (!text.trim()) {
      if (p.cell && p.runs.length && !p.tables.length) lines.push(`${p.id} ${tags.join(" ")} ⟦0⟧(빈 칸)`);
      else if (tags.length) lines.push(`${p.id} ${tags.join(" ")}`);
      continue;
    }
    const body = p.runs
      .filter((r) => r.text !== "")
      .map((r) => {
        const hint = r.charPr ? doc.charHints[r.charPr] : "";
        const bold = hint && /굵게|색#|첨자/.test(hint) ? ` ${hint.split(" ").filter((h) => !h.endsWith("pt")).join(" ")}` : "";
        return `⟦${r.k}${bold}⟧${r.text.replace(/\n/g, "↵").replace(/\t/g, "⇥")}`;
      })
      .join("");
    lines.push(`${p.id} ${tags.length ? tags.join(" ") + " " : ""}${body}`);
  }
  return lines.join("\n") + "\n";
}

export interface ApplyResult {
  bytes: Uint8Array;
  /** 고친 문단: 번호·전·후 */
  changes: { p: number; kind: "고침" | "지움" | "넣음"; before: string; after: string; cell?: TParagraph["cell"] }[];
  /** 적용하지 못한 지시(번호가 없음 등) */
  errors: string[];
  /** 글자가 크게 늘어 쪽이 밀릴 수 있는 문단 */
  warnings: string[];
}

function runsMapValid(p: TParagraph, runs: Record<string, string>, errors: string[], label: string): [TRun, string][] {
  const out: [TRun, string][] = [];
  for (const [k, v] of Object.entries(runs ?? {})) {
    const r = p.runs[Number(k)];
    if (!r || !/^\d+$/.test(k)) {
      errors.push(`${label}: 문단 ${p.id} 에 칸 ${k} 이 없습니다(칸은 0~${p.runs.length - 1})`);
      continue;
    }
    if (typeof v !== "string") {
      errors.push(`${label}: 문단 ${p.id} 칸 ${k} 의 값이 글자가 아닙니다`);
      continue;
    }
    out.push([r, v]);
  }
  return out;
}

/** 문단 문자열(원본 섹션의 [p.start,p.end)) 안에서 칸 글자를 바꾸고 줄 나눔 정보를 지운 새 문자열 */
function rewriteParagraph(xml: string, p: TParagraph, sets: [TRun, string][]): string {
  const reps: { s: number; e: number; str: string }[] = sets.map(([r, v]) => ({ s: r.start, e: r.end, str: v === "" ? "<hp:t/>" : `<hp:t>${encodeRunText(v, r.tabTag)}</hp:t>` }));
  if (p.lineseg) reps.push({ s: p.lineseg[0], e: p.lineseg[1], str: "" });
  reps.sort((a, b) => b.s - a.s);
  let out = xml.slice(p.start, p.end);
  for (const r of reps) out = out.slice(0, r.s - p.start) + r.str + out.slice(r.e - p.start);
  return out;
}

/**
 * p 바로 뒤에 붙은 빈 문단(띄움 줄) — 글자·표·그림이 없고 같은 칸(또는 본문)에 있다.
 *
 * 담당자 2026-11-18: 언론브리핑 양식은 줄마다 빈 문단을 하나씩 끼워 띄웠다. 새로 넣은 줄에는 띄움 줄이 없고,
 * 지운 줄의 띄움 줄은 남아 「계약금액과 계약기간 사이에 한 줄 더」처럼 간격이 들쭉날쭉했다. 띄움 줄은 문단 목록에
 * 나오지 않아 AI 가 고칠 수 없으므로 엔진이 줄과 함께 다룬다.
 */
function spacerAfter(doc: TemplateDoc, p: TParagraph): TParagraph | null {
  if (p.tables.length || p.hasSecPr) return null;
  const i = doc.paragraphs.indexOf(p);
  // 뒤에 오는 첫 문단 가운데 같은 자리(같은 바깥 문단·같은 칸)에 있는 것 — 표를 품은 문단이면 그 안 문단을 건너뛴다
  const q = doc.paragraphs.slice(i + 1).find((x) => x.section === p.section && x.parent === p.parent && x.start >= p.end);
  if (!q || !isSpacer(doc, q) || doc.sections[p.section].slice(p.end, q.start).trim() !== "") return null;
  return q;
}

function isSpacer(doc: TemplateDoc, q: TParagraph): boolean {
  return !q.tables.length && !q.hasObject && !q.hasSecPr && paragraphText(q).trim() === "" && !doc.paragraphs.some((x) => x.parent === q.id);
}

/** p 바로 앞의 띄움 줄 — 넣는 줄은 본뜬 문단의 앞 간격을 따른다(무리 끝 줄 뒤의 띄움 줄은 다음 □ 앞이라 더 넓다) */
function spacerBefore(doc: TemplateDoc, p: TParagraph): TParagraph | null {
  const i = doc.paragraphs.indexOf(p);
  const q = doc.paragraphs.slice(0, i).reverse().find((x) => x.section === p.section && x.parent === p.parent && x.end <= p.start);
  if (!q || !isSpacer(doc, q) || doc.sections[p.section].slice(q.end, p.start).trim() !== "") return null;
  return q;
}

export function applyEdits(doc: TemplateDoc, input: TemplateEdits): ApplyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const changes: ApplyResult["changes"] = [];
  const byId = new Map(doc.paragraphs.map((p) => [p.id, p]));
  const edits = Array.isArray(input?.edits) ? input.edits : [];
  // 섹션별 바꿀 자리: [start,end) → 새 문자열. 지운 문단 안의 고침은 버린다
  const reps: { section: number; s: number; e: number; str: string }[][] = doc.sections.map(() => []);
  const deleted = new Set<number>();
  const runSets = new Map<number, [TRun, string][]>();
  const inserts: { after: TParagraph; str: string; like: TParagraph; text: string }[] = [];

  for (const [i, e] of edits.entries()) {
    const label = `${i + 1}번째 지시`;
    // 표 행 넣기·빼기는 문단 고침이 끝난 뒤 rows.ts 가 한다
    if ("table" in e) continue;
    if ("insertAfter" in e) {
      const after = byId.get(Number(e.insertAfter));
      const like = byId.get(Number(e.like));
      if (!after || !like) {
        errors.push(`${label}: 문단 ${!after ? e.insertAfter : e.like} 이 없습니다`);
        continue;
      }
      if (like.tables.length || like.hasObject || like.hasSecPr || doc.paragraphs.some((q) => q.parent === like.id)) {
        errors.push(`${label}: 문단 ${like.id} 은 표·그림을 품고 있어 본뜰 수 없습니다 — 글자만 있는 문단을 본뜹니다`);
        continue;
      }
      const sets = runsMapValid(like, e.runs, errors, label);
      const str = rewriteParagraph(doc.sections[like.section], like, sets);
      const text = like.runs.map((r) => sets.find(([x]) => x === r)?.[1] ?? r.text).join("");
      // 뒤 문단에 띄움 줄이 있으면 새 줄 앞에도 같은 띄움 줄을 둔다: 뒤 문단 · (띄움) · 새 줄 · 원래 띄움 · 다음 줄
      // 띄움 줄 모양은 본뜬 문단 앞의 것을 먼저 쓴다 — 없으면 뒤 문단의 띄움 줄
      const sp = spacerAfter(doc, after) ? (spacerBefore(doc, like) ?? spacerAfter(doc, after)) : null;
      const spacerXml = sp ? doc.sections[sp.section].slice(sp.start, sp.end) : "";
      inserts.push({ after, str: spacerXml + str, like, text });
      continue;
    }
    const p = byId.get(Number(e.p));
    if (!p) {
      errors.push(`${label}: 문단 ${e.p} 이 없습니다`);
      continue;
    }
    if ("delete" in e && e.delete) {
      if (p.hasSecPr) {
        errors.push(`${label}: 문단 ${p.id} 은 문서 첫 문단(쪽 설정)이라 지울 수 없습니다 — 글자만 비웁니다`);
        continue;
      }
      if (p.cell && doc.paragraphs.filter((q) => q.cell && q.parent === p.parent && q.cell.table === p.cell!.table && q.cell.row === p.cell!.row && q.cell.col === p.cell!.col).length <= 1) {
        errors.push(`${label}: 문단 ${p.id} 은 표 칸의 하나뿐인 문단이라 지울 수 없습니다 — 칸을 비우려면 글자를 "" 로 바꿉니다`);
        continue;
      }
      deleted.add(p.id);
      // 글이 있는 줄을 지우면 그 줄의 띄움 줄도 함께 — 남기면 그 자리만 간격이 벌어진다
      if (paragraphText(p).trim()) {
        const sp = spacerAfter(doc, p);
        if (sp) deleted.add(sp.id);
      }
      continue;
    }
    if ("runs" in e) {
      const prev = runSets.get(p.id) ?? [];
      for (const s of runsMapValid(p, e.runs, errors, label)) {
        const j = prev.findIndex(([r]) => r === s[0]);
        if (j >= 0) prev[j] = s;
        else prev.push(s);
      }
      runSets.set(p.id, prev);
      continue;
    }
    errors.push(`${label}: 알 수 없는 지시입니다(p+runs, p+delete, insertAfter+like+runs 중 하나)`);
  }

  // 상자(표 칸·글상자)의 문단을 모두 지우면 빈 상자가 남고 한글이 파일을 열다 죽는다(2026-11-27 「중소기업 AX 대전환
  // 지원 계획」: 표지 글상자 4개의 문단을 지워 열리지 않음). 상자를 품은 문단째 지우는 게 아니면 첫 문단은 남기고 글자만 비운다
  const boxParas = new Map<number, TParagraph[]>();
  for (const q of doc.paragraphs) if (q.box !== undefined) boxParas.set(q.box, [...(boxParas.get(q.box) ?? []), q]);
  for (const paras of boxParas.values()) {
    if (!paras.every((q) => deleted.has(q.id))) continue;
    const holder = paras[0].parent !== undefined ? byId.get(paras[0].parent) : undefined;
    const holderGone = (q?: TParagraph): boolean => !!q && (deleted.has(q.id) || holderGone(q.parent !== undefined ? byId.get(q.parent) : undefined));
    if (holderGone(holder)) continue;
    const keep = paras[0];
    deleted.delete(keep.id);
    runSets.set(keep.id, keep.runs.map((r) => [r, ""] as [TRun, string]));
    warnings.push(`[빈 상자] 문단 ${keep.id} 은 ${keep.cell ? "표 칸" : "글상자"}의 마지막 문단이라 지우지 않고 글자만 비웠습니다 — 상자째 없애려면 상자를 품은 문단 ${holder?.id ?? "?"} 을 지웁니다`);
  }

  // 지운 문단(과 그 안의 문단)
  const isInside = (q: TParagraph, outer: TParagraph) => q.section === outer.section && q.start > outer.start && q.end <= outer.end;
  const deletedOuter = doc.paragraphs.filter((p) => deleted.has(p.id));
  const coveredByDelete = (q: TParagraph) => deletedOuter.some((d) => d === q || isInside(q, d));
  for (const d of deletedOuter) {
    if (deletedOuter.some((o) => o !== d && isInside(d, o))) continue;
    reps[d.section].push({ section: d.section, s: d.start, e: d.end, str: "" });
    changes.push({ p: d.id, kind: "지움", before: paragraphText(d) || (d.tables.length ? `[표${d.tables.join(",")}]` : ""), after: "", ...(d.cell ? { cell: d.cell } : {}) });
  }
  for (const [pid, sets] of runSets) {
    const p = byId.get(pid)!;
    if (coveredByDelete(p)) continue;
    const real = sets.filter(([r, v]) => r.text !== v);
    if (!real.length) continue;
    const before = paragraphText(p);
    const after = p.runs.map((r) => real.find(([x]) => x === r)?.[1] ?? r.text).join("");
    const xml = doc.sections[p.section];
    // 표를 품은 문단은 칸 자리만 바꾼다(문단 통째로 갈면 안쪽 표의 고침과 겹친다)
    for (const [r, v] of real) reps[p.section].push({ section: p.section, s: r.start, e: r.end, str: v === "" ? "<hp:t/>" : `<hp:t>${encodeRunText(v, r.tabTag)}</hp:t>` });
    if (p.lineseg) reps[p.section].push({ section: p.section, s: p.lineseg[0], e: p.lineseg[1], str: "" });
    void xml;
    changes.push({ p: p.id, kind: "고침", before, after, ...(p.cell ? { cell: p.cell } : {}) });
    const grow = after.length - before.length;
    if (before.length >= 15 && grow > Math.max(8, before.length * 0.15)) warnings.push(`[길이] 문단 ${p.id}: ${before.length}자 → ${after.length}자 — 줄이 늘어 쪽이 밀릴 수 있습니다`);
  }
  // 넣기: 같은 문단 뒤에 여럿이면 적은 순서대로
  for (const ins of inserts) {
    if (coveredByDelete(ins.after)) {
      errors.push(`문단 ${ins.after.id} 을 지웠으므로 그 뒤에 넣을 수 없습니다`);
      continue;
    }
    reps[ins.after.section].push({ section: ins.after.section, s: ins.after.end, e: ins.after.end, str: ins.str });
    changes.push({ p: ins.after.id, kind: "넣음", before: "", after: ins.text, ...(ins.after.cell ? { cell: ins.after.cell } : {}) });
  }

  const enc = new TextEncoder();
  const out: Zippable = {};
  for (const [name, data] of Object.entries(doc.entries)) {
    const si = doc.sectionNames.indexOf(name);
    let bytes = data;
    if (si >= 0 && reps[si].length) {
      // 뒤에서부터 바꾼다. 같은 자리에서는 범위 바꾸기(지우기 등)를 먼저 하고 넣기를 나중에 한다 — 거꾸로 하면
      // "문단 1 뒤에 넣기 + 문단 2 지우기"에서 넣은 문단이 지워진다(1.end = 2.start). 같은 자리 넣기 여럿은
      // 나중에 적은 것부터 붙여야 적은 순서대로 남는다
      const list = reps[si].map((r, i) => ({ ...r, i })).sort((a, b) => b.s - a.s || Number(b.e > b.s) - Number(a.e > a.s) || b.i - a.i);
      let xml = doc.sections[si];
      for (const r of list) xml = xml.slice(0, r.s) + r.str + xml.slice(r.e);
      bytes = enc.encode(xml);
    }
    out[name] = name === "mimetype" ? [bytes, { level: 0 }] : [bytes, { level: 6 }];
  }
  return { bytes: zipSync(out, { mtime: new Date("1980-01-01T00:00:00Z") }), changes, errors, warnings };
}

/**
 * 마지막 안전망: 문단이 하나도 없는 상자(<hp:subList>)에 빈 문단을 하나 넣는다. 고침·행 빼기·뒷정리·배치 다듬기
 * 어느 단계가 상자를 비워도 한글이 열다 죽지 않게 — 내보내기 직전에 한 번 거른다.
 */
export function fillEmptyBoxes(bytes: Uint8Array): { bytes: Uint8Array; filled: number } {
  const entries = unzipSync(bytes);
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let filled = 0;
  const EMPTY_P = `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>`;
  const out: Zippable = {};
  for (const [name, data] of Object.entries(entries)) {
    let bytesOut = data;
    if (SECTION_RE.test(name)) {
      const xml = dec.decode(data);
      const next = xml.replace(/<hp:subList\b([^>]*?)(?:\/>|>\s*<\/hp:subList>)/g, (_, a: string) => {
        filled++;
        return `<hp:subList${a}>${EMPTY_P}</hp:subList>`;
      });
      if (next !== xml) bytesOut = enc.encode(next);
    }
    out[name] = name === "mimetype" ? [bytesOut, { level: 0 }] : [bytesOut, { level: 6 }];
  }
  return filled ? { bytes: zipSync(out, { mtime: new Date("1980-01-01T00:00:00Z") }), filled } : { bytes, filled };
}

/** 바뀐 문단을 사람이 읽는 표로 */
export function changesMarkdown(r: ApplyResult): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const where = (c: ApplyResult["changes"][number]) => (c.cell ? `표${c.cell.table} ${c.cell.row + 1}행${c.cell.col + 1}열` : "본문");
  const lines = [`# 바뀐 곳 ${r.changes.length}군데`, "", "| 문단 | 자리 | 구분 | 원본 | 바뀐 글 |", "|---|---|---|---|---|"];
  for (const c of r.changes) lines.push(`| ${c.p} | ${where(c)} | ${c.kind} | ${esc(c.before)} | ${esc(c.after)} |`);
  if (r.errors.length) lines.push("", "## 적용하지 못한 지시", ...r.errors.map((e) => `- ${e}`));
  if (r.warnings.length) lines.push("", "## 확인할 것", ...r.warnings.map((w) => `- ${w}`));
  return lines.join("\n") + "\n";
}
