/**
 * 양식 맞춰 쓰기 — 배치 다듬기. 글자를 바꾼 뒤 한글이 다시 나눈 줄·쪽을 재서, 담당자가 한글에서 손으로 하던 두 가지를 한다
 * (담당자 2026-11-17: "한 글자 아래로 내려간 거 자간 줄여서 한 줄로", "표가 다음 장으로 넘어가 하단 여백이 너무 많이 남는 걸
 * 표 높이를 살짝만 조정하면 앞장 빈칸으로 들어갈 수 있는 거").
 *
 * ① 끝줄 붙이기: **바꾼 문단** 가운데 끝줄에 몇 글자(빈칸 빼고 4자 이하)만 남은 문단은 자간을 한 단계씩 좁혀 윗줄로 붙인다.
 *    한도까지 좁혀도 안 되면 원래대로 둔다. 바꾸지 않은 문단은 손대지 않는다.
 * ③ 넘침 당기기: 쪽 끝 문단의 마지막 한두 줄만 다음 쪽으로 넘어가 그 쪽이 거의 비면(뒤는 새 쪽에서 시작하거나 문서 끝),
 *    앞 쪽 글 문단의 줄 간격을 조금(최대 10%p) 줄여 앞 쪽에 넣는다. 쪽 수가 줄지 않으면 원래대로 둔다.
 *    (쪽 배치 원칙 2026-10-12: "문단 끝 한두 줄만 다음 쪽으로 넘어가면 줄 간격을 줄인다")
 * ② 표 당기기: 표가 통째로 다음 쪽으로 넘어가 앞 쪽 아래가 크게(30mm 넘게) 비었고, 표 높이를 20% 안쪽으로 줄이면 들어갈 것 같으면
 *    칸 높이를 줄여 본다. 앞 쪽으로 올라오지 않으면 원래대로 둔다. 일부러 나눈 쪽(쪽 나눔)은 건드리지 않는다.
 *
 * 줄·쪽 위치는 한글로 다시 저장한 파일의 줄 정보(hp:lineseg — textpos 는 줄 첫 글자, vertpos 는 쪽 본문 맨 위에서의 높이)로 잰다.
 * 한글이 없으면 아무것도 하지 않는다.
 */
import { unzipSync, zipSync, type Zippable } from "fflate";
import { hangulLayout } from "../hwpx/hangul";
import { paragraphText, readTemplate, type TParagraph } from "./engine";

/** 끝줄에 남은 글자가 이 이하(빈칸 빼고)면 윗줄로 붙인다 */
const SHORT_TAIL = 4;
/** 자간을 이만큼(%) 더 좁혀 본다 — 한 단계씩, 붙으면 멈춘다 */
const CONDENSE_STEPS = [-3, -6, -10];
/**
 * 줄이는 단계 — 자간(sp, %)과 장평(ratio, %). 장평은 표 칸에만 쓴다: 좁은 칸의 「일부집행」이 「일부집/행」으로 넘어가 행이 세 줄
 * 높이가 됐고, 원본 담당자는 같은 칸을 글자 폭을 좁혀 한 줄로 맞춰 두었다(2026-11-17 10월 현황 표9). 본문 글은 장평을 줄이면 티가 난다.
 */
interface Squeeze {
  sp: number;
  ratio: number;
  cellOnly?: boolean;
}
const SQUEEZE_STEPS: Squeeze[] = [...CONDENSE_STEPS.map((sp) => ({ sp, ratio: 100 })), { sp: -10, ratio: 90, cellOnly: true }, { sp: -10, ratio: 80, cellOnly: true }];
/** 넘친 쪽이 이 높이(HWPUNIT, 20mm) 이하로만 차 있으면 당긴다 */
const SPILL_MAX = 5669;
/** 줄 간격(%p)을 이만큼 줄여 본다 */
const LINE_STEPS = [5, 10];
/** 표를 당기려면 앞 쪽 아래가 이만큼(HWPUNIT, 30mm) 넘게 비어야 한다 */
const GAP_MIN = 8504;
/** 표 높이는 이만큼까지만 줄인다 */
const TABLE_MIN_SCALE = 0.8;

export interface FitResult {
  bytes: Uint8Array;
  /** 사람이 읽는 한 줄씩 */
  notes: string[];
}

interface Seg {
  textpos: number;
  vertpos: number;
  vertsize: number;
}

function segsOf(xml: string, p: TParagraph): Seg[] {
  if (!p.lineseg) return [];
  const s = xml.slice(p.lineseg[0], p.lineseg[1]);
  return [...s.matchAll(/<hp:lineseg\b([^>]*)\/>/g)].map((m) => ({
    textpos: Number(/textpos="(\d+)"/.exec(m[1])?.[1] ?? 0),
    vertpos: Number(/vertpos="(-?\d+)"/.exec(m[1])?.[1] ?? 0),
    vertsize: Number(/vertsize="(\d+)"/.exec(m[1])?.[1] ?? 0),
  }));
}

/** 한글로 다시 저장해 문단마다 줄 정보를 얻는다. 문단 수가 원본과 다르면(한글이 구조를 바꿈) undefined */
async function measure(bytes: Uint8Array): Promise<{ paras: TParagraph[]; sections: string[]; pages: number } | undefined> {
  const h = await hangulLayout(bytes, { save: true, timeoutMs: 180_000 });
  if (!h?.saved) return undefined;
  const saved = readTemplate(h.saved);
  const mine = readTemplate(bytes);
  if (saved.paragraphs.length !== mine.paragraphs.length) return undefined;
  return { paras: saved.paragraphs, sections: saved.sections, pages: h.texts.length };
}

/** 끝줄에 몇 글자만 남은 문단 번호 */
function shortTails(m: NonNullable<Awaited<ReturnType<typeof measure>>>, texts: Set<string>): number[] {
  const out: number[] = [];
  for (const p of m.paras) {
    if (p.tables.length || p.hasObject || !texts.has(paragraphText(p))) continue;
    const segs = segsOf(m.sections[p.section], p);
    if (segs.length < 2) continue;
    const text = paragraphText(p);
    const tail = text.slice(segs[segs.length - 1].textpos).replace(/\s/g, "");
    if (tail.length > 0 && tail.length <= SHORT_TAIL) out.push(p.id);
  }
  return out;
}

/** 머리(header.xml)에 자간을 delta 만큼 좁힌 글자 모양을 더하고 문단의 글자 모양을 그것으로 바꾼다 */
function condense(bytes: Uint8Array, targets: Map<number, Squeeze>): Uint8Array {
  if (!targets.size) return bytes;
  const doc = readTemplate(bytes);
  const dec = new TextDecoder();
  let header = dec.decode(doc.entries["Contents/header.xml"]);
  let nextId = Math.max(-1, ...[...header.matchAll(/<hh:charPr id="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  const made = new Map<string, string>();
  const added: string[] = [];
  const cloneFor = (orig: string, q: Squeeze): string => {
    const key = `${orig}:${q.sp}:${q.ratio}`;
    const hit = made.get(key);
    if (hit) return hit;
    const m = new RegExp(`<hh:charPr id="${orig}"[\\s\\S]*?</hh:charPr>`).exec(header);
    if (!m) return orig;
    const id = String(nextId++);
    const xml = m[0]
      .replace(/<hh:charPr id="\d+"/, `<hh:charPr id="${id}"`)
      .replace(/<hh:spacing\b([^>]*)\/>/, (_, a: string) => `<hh:spacing${a.replace(/="(-?\d+)"/g, (_x, v: string) => `="${Math.max(-50, Number(v) + q.sp)}"`)}/>`)
      .replace(/<hh:ratio\b([^>]*)\/>/, (_, a: string) => (q.ratio >= 100 ? `<hh:ratio${a}/>` : `<hh:ratio${a.replace(/="(\d+)"/g, (_x, v: string) => `="${Math.max(50, Math.round((Number(v) * q.ratio) / 100))}"`)}/>`));
    added.push(xml);
    made.set(key, id);
    return id;
  };
  const sections = [...doc.sections];
  // 뒤 문단부터 바꿔 앞 문단의 위치가 흔들리지 않게
  const paras = doc.paragraphs.filter((p) => targets.has(p.id)).sort((a, b) => b.section - a.section || b.start - a.start);
  for (const p of paras) {
    const delta = targets.get(p.id)!;
    let s = sections[p.section].slice(p.start, p.end);
    s = s.replace(/charPrIDRef="(\d+)"/g, (_, id: string) => `charPrIDRef="${cloneFor(id, delta)}"`);
    if (p.lineseg) s = s.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/, "");
    sections[p.section] = sections[p.section].slice(0, p.start) + s + sections[p.section].slice(p.end);
  }
  header = header.replace(/(<hh:charProperties\b[^>]*itemCnt=")(\d+)(")/, (_, a: string, n: string, b: string) => `${a}${Number(n) + added.length}${b}`);
  header = header.replace("</hh:charProperties>", `${added.join("")}</hh:charProperties>`);
  return repack(doc.entries, doc.sectionNames, sections, header);
}

function repack(entries: Record<string, Uint8Array>, sectionNames: string[], sections: string[], header?: string): Uint8Array {
  const enc = new TextEncoder();
  const out: Zippable = {};
  for (const [name, data] of Object.entries(entries)) {
    const si = sectionNames.indexOf(name);
    const bytes = si >= 0 ? enc.encode(sections[si]) : name === "Contents/header.xml" && header !== undefined ? enc.encode(header) : data;
    out[name] = name === "mimetype" ? [bytes, { level: 0 }] : [bytes, { level: 6 }];
  }
  return zipSync(out, { mtime: new Date("1980-01-01T00:00:00Z") });
}

/** 본문 높이(HWPUNIT) — 첫 구역의 용지 높이에서 위·아래 여백과 머리말·꼬리말을 뺀다 */
function bodyHeight(section0: string): number | undefined {
  const pp = /<hp:pagePr\b([^>]*)>[\s\S]*?<hp:margin\b([^>]*)\/>/.exec(section0);
  if (!pp) return undefined;
  const a = (s: string, k: string) => Number(new RegExp(`\\b${k}="(\\d+)"`).exec(s)?.[1] ?? NaN);
  const landscape = /landscape="NARROWLY"/.test(pp[1]);
  const h = landscape ? a(pp[1], "width") : a(pp[1], "height");
  const v = h - a(pp[2], "top") - a(pp[2], "bottom") - a(pp[2], "header") - a(pp[2], "footer");
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/** 통째로 다음 쪽으로 넘어가 앞 쪽 아래를 크게 비운 표 문단과, 줄여야 할 비율 */
function pushedTables(m: NonNullable<Awaited<ReturnType<typeof measure>>>, done: Set<number>): { p: number; scale: number; gapMm: number }[] {
  const body = bodyHeight(m.sections[0]);
  if (!body) return [];
  const out: { p: number; scale: number; gapMm: number }[] = [];
  // 최상위 문단만 — 쪽 위치는 본문 기준이다(표 칸 안 문단은 칸 안 좌표)
  const top = m.paras.filter((p) => p.parent === undefined);
  let prevBottom = 0;
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    const segs = segsOf(m.sections[p.section], p);
    if (!segs.length) continue;
    const first = segs[0];
    const forced = /\bpageBreak="1"/.exec(m.sections[p.section].slice(p.start, p.start + 300)) !== null;
    const newPage = i > 0 && first.vertpos < prevBottom;
    if (newPage && !forced && p.tables.length && !done.has(p.id)) {
      const gap = body - prevBottom;
      const tableH = first.vertsize;
      if (gap > GAP_MIN && tableH > gap) {
        const scale = (gap - 300) / tableH;
        if (scale >= TABLE_MIN_SCALE) out.push({ p: p.id, scale, gapMm: Math.round(gap / 283.46) });
      }
    }
    const last = segs[segs.length - 1];
    prevBottom = last.vertpos + last.vertsize;
  }
  return out;
}

/** 표 문단 안 모든 칸·표 높이를 scale 배로(한글은 글이 더 필요하면 칸을 다시 늘린다), 칸 위아래 안쪽 여백은 절반으로 */
function shrinkTable(bytes: Uint8Array, pid: number, scale: number): Uint8Array {
  const doc = readTemplate(bytes);
  const p = doc.paragraphs.find((x) => x.id === pid);
  if (!p) return bytes;
  const sections = [...doc.sections];
  let s = sections[p.section].slice(p.start, p.end);
  s = s.replace(/<hp:cellSz\b([^>]*)\/>/g, (_, a: string) => `<hp:cellSz${a.replace(/height="(\d+)"/, (_x, v: string) => `height="${Math.round(Number(v) * scale)}"`)}/>`);
  s = s.replace(/<hp:sz\b([^>]*)\/>/, (_, a: string) => `<hp:sz${a.replace(/height="(\d+)"/, (_x, v: string) => `height="${Math.round(Number(v) * scale)}"`)}/>`);
  s = s.replace(/<hp:cellMargin\b([^>]*)\/>/g, (_, a: string) => `<hp:cellMargin${a.replace(/(top|bottom)="(\d+)"/g, (_x, k: string, v: string) => `${k}="${Math.round(Number(v) / 2)}"`)}/>`);
  // 표 문단과 칸 문단의 줄 정보는 지워 한글이 다시 잰다
  s = s.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, "");
  sections[p.section] = sections[p.section].slice(0, p.start) + s + sections[p.section].slice(p.end);
  return repack(doc.entries, doc.sectionNames, sections);
}

interface PagePos {
  id: number;
  startPage: number;
  endPage: number;
  bottom: number;
  forced: boolean;
}

/** 최상위 문단마다 쪽(0부터)과 마지막 줄 아래 끝 — 줄 높이 위치(vertpos)가 앞 줄보다 작아지면 새 쪽이다 */
function pageMap(m: NonNullable<Awaited<ReturnType<typeof measure>>>): PagePos[] {
  const out: PagePos[] = [];
  let page = 0, prev = 0, prevSection = 0;
  for (const p of m.paras.filter((x) => x.parent === undefined)) {
    const segs = segsOf(m.sections[p.section], p);
    const forced = /\bpageBreak="1"/.test(m.sections[p.section].slice(p.start, p.start + 300));
    if (p.section !== prevSection) {
      page++;
      prev = 0;
      prevSection = p.section;
    }
    if (!segs.length) continue;
    if (segs[0].vertpos < prev || (forced && out.length)) page++;
    const startPage = page;
    for (let i = 1; i < segs.length; i++) if (segs[i].vertpos < segs[i - 1].vertpos) page++;
    const last = segs[segs.length - 1];
    prev = last.vertpos + last.vertsize;
    out.push({ id: p.id, startPage, endPage: page, bottom: prev, forced });
  }
  return out;
}

/**
 * 거의 빈 채로 끝난 쪽 — 앞 쪽에서 한두 줄(문단의 꼬리든, 한 줄짜리 문단 하나든)만 넘어와 20mm 안쪽만 찼고, 다음 내용은
 * 새 쪽(쪽 나눔·새 구역)에서 시작하거나 문서가 끝난다. 그 앞 쪽의 글 문단들을 돌려준다.
 * 2026-11-17 경영목표: 한 줄짜리 문단 「- 현장 중심의 찾아가는 서비스…」가 통째로 12쪽에 넘어가 12쪽이 한 줄로 끝났다 —
 * 처음 조건(문단 꼬리만)은 이것을 못 잡았다.
 */
function spills(m: NonNullable<Awaited<ReturnType<typeof measure>>>): { page: number; ids: number[] }[] {
  const pos = pageMap(m);
  const sectionOf = (id: number) => m.paras.find((x) => x.id === id)?.section ?? 0;
  const out: { page: number; ids: number[] }[] = [];
  const last = Math.max(0, ...pos.map((q) => q.endPage));
  for (let pg = 1; pg <= last; pg++) {
    const on = pos.filter((q) => q.endPage === pg);
    if (!on.length || pos.some((q) => q.startPage === pg && q.endPage > pg)) continue;
    // 이 쪽에서 시작한 문단 중 일부러 새 쪽을 연 것(쪽 나눔)이 있으면 그 쪽은 원래 짧게 끝나는 자리다
    if (on.some((q) => q.startPage === pg && q.forced)) continue;
    const bottom = Math.max(...on.map((q) => q.bottom));
    if (bottom > SPILL_MAX) continue;
    const tail = on[on.length - 1];
    const next = pos.find((q) => q.startPage === pg + 1);
    if (next && !next.forced && sectionOf(next.id) === sectionOf(tail.id)) continue;
    const ids = pos
      .filter((q) => q.startPage === pg - 1)
      .map((q) => m.paras.find((x) => x.id === q.id)!)
      .filter((p) => !p.tables.length && !p.hasObject)
      .map((p) => p.id);
    if (ids.length) out.push({ page: pg, ids });
  }
  return out;
}

/** 문단들의 줄 간격(PERCENT)을 dec %p 줄인 문단 모양을 머리에 더하고 그 문단들이 쓰게 한다 */
function tightenLines(bytes: Uint8Array, ids: number[], dec: number): Uint8Array {
  const doc = readTemplate(bytes);
  let header = new TextDecoder().decode(doc.entries["Contents/header.xml"]);
  let nextId = Math.max(-1, ...[...header.matchAll(/<hh:paraPr id="(\d+)"/g)].map((x) => Number(x[1]))) + 1;
  const made = new Map<string, string>();
  const added: string[] = [];
  const cloneFor = (orig: string): string => {
    const hit = made.get(orig);
    if (hit) return hit;
    const m = new RegExp(`<hh:paraPr id="${orig}"[\\s\\S]*?</hh:paraPr>`).exec(header);
    if (!m || !/<hh:lineSpacing type="PERCENT"/.test(m[0])) return orig;
    const id = String(nextId++);
    added.push(m[0].replace(/<hh:paraPr id="\d+"/, `<hh:paraPr id="${id}"`).replace(/(<hh:lineSpacing type="PERCENT" value=")(\d+)/g, (_, a: string, v: string) => `${a}${Math.max(100, Number(v) - dec)}`));
    made.set(orig, id);
    return id;
  };
  const sections = [...doc.sections];
  const want = new Set(ids);
  for (const p of doc.paragraphs.filter((x) => want.has(x.id)).sort((a, b) => b.section - a.section || b.start - a.start)) {
    let s = sections[p.section].slice(p.start, p.end);
    if (p.lineseg) s = s.slice(0, p.lineseg[0] - p.start) + s.slice(p.lineseg[1] - p.start);
    s = s.replace(/^(<hp:p\b[^>]*?paraPrIDRef=")(\d+)/, (_, a: string, id: string) => `${a}${cloneFor(id)}`);
    sections[p.section] = sections[p.section].slice(0, p.start) + s + sections[p.section].slice(p.end);
  }
  if (!added.length) return bytes;
  header = header.replace(/(<hh:paraProperties\b[^>]*itemCnt=")(\d+)(")/, (_, a: string, n: string, b: string) => `${a}${Number(n) + added.length}${b}`);
  header = header.replace("</hh:paraProperties>", `${added.join("")}</hh:paraProperties>`);
  return repack(doc.entries, doc.sectionNames, sections, header);
}

/**
 * 배치 다듬기. changed = 바꾸거나 넣은 문단의 글 — 넣은 문단 때문에 결과 파일의 문단 번호는 원본과 달라지므로 글로 찾는다.
 * 같은 글이 바꾸지 않은 문단에도 있으면 그 문단도 함께 맞춰지지만, 모양(자간)만 바뀌고 글자는 그대로다.
 */
export async function fitTemplateLayout(bytes: Uint8Array, changed: Set<string>): Promise<FitResult> {
  const notes: string[] = [];
  let cur = bytes;
  let m = await measure(cur);
  if (!m) return { bytes, notes };
  const first = m;
  const label = (id: number) => {
    const p = first.paras.find((x) => x.id === id);
    const t = p ? paragraphText(p).trim().replace(/\s+/g, " ") : "";
    return t ? `「${t.slice(0, 18)}${t.length > 18 ? "…" : ""}」` : `문단 ${id}`;
  };

  // ① 끝줄 붙이기 — 자간을 한 단계씩 좁히고, 표 칸은 그래도 안 되면 장평(글자 폭)까지 줄인다
  const isCell = new Set(m.paras.filter((p) => p.cell).map((p) => p.id));
  let bad = shortTails(m, changed);
  const level = new Map<number, Squeeze>();
  for (const step of SQUEEZE_STEPS) {
    const todo = bad.filter((id) => !step.cellOnly || isCell.has(id));
    if (!todo.length) continue;
    for (const id of todo) level.set(id, step);
    const trial = condense(bytes, level);
    const mm = await measure(trial);
    if (!mm) break;
    cur = trial;
    m = mm;
    bad = shortTails(m, changed);
  }
  // 한도까지 줄여도 안 붙은 문단은 원래대로
  if (bad.length) {
    for (const id of bad) level.delete(id);
    const trial = condense(bytes, level);
    const mm = await measure(trial);
    if (mm) {
      cur = trial;
      m = mm;
    }
    notes.push(`끝줄 붙이기 못 함(자간 -10%, 표 칸은 장평 80%까지): ${[...new Set(bad.map(label))].join(", ")} — 글을 줄이면 한 줄로 붙습니다`);
  }
  if (level.size) {
    // 같은 글(표의 「일부집행」 같은 칸)이 수십 번 나오면 묶어 센다
    const groups = new Map<string, number>();
    for (const [id, s] of level) {
      const k = `${label(id)} 자간 ${s.sp}%${s.ratio < 100 ? `·장평 ${s.ratio}%` : ""}`;
      groups.set(k, (groups.get(k) ?? 0) + 1);
    }
    notes.push(`끝줄 붙이기 ${level.size}곳: ${[...groups.entries()].map(([k, n]) => (n > 1 ? `${k}(${n}곳)` : k)).join(", ")}`);
  }

  // ② 표 당기기 — 한 번에 하나씩(앞 표를 당기면 뒤 쪽 배치가 달라진다)
  const tried = new Set<number>();
  for (let round = 0; round < 3; round++) {
    const cand = pushedTables(m, tried)[0];
    if (!cand) break;
    tried.add(cand.p);
    const trial = shrinkTable(cur, cand.p, cand.scale);
    const mm = await measure(trial);
    if (!mm) break;
    const moved = !pushedTables(mm, new Set()).some((c) => c.p === cand.p) && mm.pages <= m.pages;
    const stillTop = (() => {
      const p = mm.paras.find((x) => x.id === cand.p);
      const segs = p ? segsOf(mm.sections[p.section], p) : [];
      return segs.length ? segs[0].vertpos === 0 : true;
    })();
    if (moved && !stillTop) {
      cur = trial;
      m = mm;
      notes.push(`표 당기기: ${label(cand.p + 1)} 표의 높이를 ${Math.round(cand.scale * 100)}%로 줄여 앞 쪽 빈칸(${cand.gapMm}mm)으로 올림`);
    } else notes.push(`표 당기기 못 함: ${label(cand.p + 1)} 표는 높이를 ${Math.round(cand.scale * 100)}%로 줄여도 앞 쪽에 들어가지 않아 그대로 둠`);
  }

  // ③ 넘침 당기기 — 앞 쪽에서 한두 줄만 넘어와 거의 빈 쪽
  const pulled = new Set<number>();
  for (let round = 0; round < 3; round++) {
    const sp = spills(m).find((x) => !pulled.has(x.page));
    if (!sp) break;
    pulled.add(sp.page);
    let ok = false;
    for (const dec of LINE_STEPS) {
      const trial = tightenLines(cur, sp.ids, dec);
      const mm = await measure(trial);
      if (mm && mm.pages < m.pages) {
        cur = trial;
        m = mm;
        ok = true;
        notes.push(`넘침 당기기: ${sp.page + 1}쪽으로 넘어간 줄을 앞 쪽에 넣음(그 쪽 문단 ${sp.ids.length}개 줄 간격 -${dec}%p)`);
        break;
      }
    }
    if (!ok) notes.push(`넘침 당기기 못 함: ${sp.page + 1}쪽으로 넘어간 줄은 줄 간격을 ${LINE_STEPS[LINE_STEPS.length - 1]}%p 줄여도 앞 쪽에 들어가지 않음 — 문장을 줄이면 들어갑니다`);
  }
  return { bytes: cur, notes };
}

/** 시험용 — zip 안 header 글자 */
export function headerOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(unzipSync(bytes)["Contents/header.xml"]);
}
