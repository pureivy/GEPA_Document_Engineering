/**
 * 다음 문단과 함께(keepWithNext) 보정 — 쪽 끝에 홀로 남은 제목을 다음 쪽으로 넘긴다.
 *
 * □ 제목에는 keepWithNext 를 걸지만 rhwp(미리보기·쪽수 검사)는 이를 지키지 않아, 제목만 쪽 맨 아래에
 * 남고 표·본문은 다음 쪽에서 시작했다(결과보고서 "□ 세부사업별 계획 대비 실적", 담당자 2026-10-12).
 * 빌드한 문서를 rhwp 로 배치해 보고, keepWithNext 문단(이어진 묶음의 첫 문단)과 다음 문단이 다른 쪽에 놓이면
 * 그 묶음 첫 문단에 쪽 나눔을 건다. 한글은 keepWithNext 를 스스로 지키므로 같은 자리에서 쪽이 넘어가 결과가 같다.
 */
import { unzipSync, zipSync } from "fflate";
import { child, childrenNamed, findAll, findFirst, parseXml, serialize, textOf, XML_DECL, type XmlNode } from "./xml";
import { asLaidOutByHangul, rhwp } from "./validate";
import { hangulAvailable, hangulLayout } from "./hangul";
import { buildHwpx, type BuildOptions, type BuildResult } from "./build";
import type { DocModel } from "../docmodel/schema";

const MAX_FIXES = 12;

interface Fixed {
  bytes: Uint8Array;
  sectionXml: string;
  /** 쪽 나눔을 건 문단 수 */
  moved: number;
}

export async function applyKeepWithNext(bytes: Uint8Array): Promise<Fixed> {
  const entries = unzipSync(bytes);
  const dec = (u: Uint8Array) => new TextDecoder().decode(u);
  const header = dec(entries["Contents/header.xml"]);
  const keepIds = new Set<string>();
  for (const m of header.matchAll(/<hh:paraPr id="(\d+)"[\s\S]*?<\/hh:paraPr>/g)) if (/keepWithNext="1"/.test(m[0])) keepIds.add(m[1]);
  let sectionXml = dec(entries["Contents/section0.xml"]);
  if (!keepIds.size) return { bytes, sectionXml, moved: 0 };

  const root = parseXml(sectionXml);
  const top = childrenNamed(root, "hp:p");
  // (단위) 줄은 keepWithNext 를 걸지 않지만(common.ts bodyStyle) 뒤따르는 표와 한 묶음으로 본다 — 제목 → (단위) → 표
  const isCaption = (p: XmlNode) => !findAll(p, "hp:tbl").length && /^\s*\(단위\s*[:：]/.test(textOf(p));
  const keepFlags = top.map((p) => keepIds.has(String(p.attrs.paraPrIDRef ?? "")) || isCaption(p));
  const keep = (p: XmlNode) => keepFlags[top.indexOf(p)];
  const skip = new Set<number>();
  let cur = bytes;
  let moved = 0;
  const m = await rhwp();
  for (let pass = 0; pass < MAX_FIXES; pass++) {
    const doc = new m.HwpDocument(asLaidOutByHangul(cur)) as unknown as { getCursorRect(s: number, p: number, o: number): string; free?(): void };
    const pageOf = (i: number): number => {
      try {
        return JSON.parse(doc.getCursorRect(0, i, 0)).pageIndex as number;
      } catch {
        return -1;
      }
    };
    const pages = top.map((_, i) => pageOf(i));
    doc.free?.();
    let target = -1;
    for (let i = 0; i + 1 < top.length && target < 0; i++) {
      if (!keep(top[i]) || pages[i] < 0 || pages[i + 1] <= pages[i]) continue;
      // 묶음(keepWithNext 가 이어진 문단들)의 첫 문단까지 거슬러 올라간다 — □ 제목 → (단위) 줄 → 표
      let j = i;
      while (j > 0 && keep(top[j - 1]) && pages[j - 1] === pages[i]) j--;
      // 이미 쪽 맨 위에서 시작한 묶음(한 쪽보다 긴 묶음)이나 첫 문단(구역 설정)은 건드리지 않는다
      if (j === 0 || pages[j - 1] < pages[j] || skip.has(j) || top[j].attrs.pageBreak === "1") continue;
      target = j;
    }
    if (target < 0) break;
    top[target].attrs.pageBreak = "1";
    skip.add(target);
    moved++;
    sectionXml = XML_DECL + serialize(root);
    cur = rezip(entries, sectionXml);
  }
  return { bytes: cur, sectionXml, moved };
}

/**
 * 빌드 + 배치 보정. ① 쪽을 채울 표(정산보고서 󰊱 사업개요(요약))는 표 안 줄 간격을 키워 가며 다시 빌드해 표가 놓인 쪽의
 * 본문 아래 끝 가까이까지 차게 한다 — 표 아래가 휑하게 비었다(담당자 2026-10-12). 칸 높이만 키우면 rhwp 가 남는 높이를
 * 글 영역으로 보고 줄을 일찍 꺾어("사 업 비" 가 세 줄로) 줄 간격으로 키운다. 무조건 늘리지 않는다 — 표가 쪽의 절반
 * 이상이고 뒤 내용이 그 쪽에 들어오지 못해 표 아래가 비는 경우만(shouldFill). 표가 작으면 뒤 내용이 이어 들어오는 게
 * 맞다(담당자 2026-10-12). ② 본문 쪽도 같은 경우면 글 줄 간격을 늘려 채운다(fillTextPages). ③ 홀로 남은 제목을 다음 쪽으로 넘긴다.
 */
export async function buildLaidOut(doc: DocModel, opts0: BuildOptions = {}): Promise<BuildResult> {
  // ⓪ 줄 맞춤(내어쓰기·자간) — 줄 나눔이 정해져야 쪽 채우기를 잴 수 있다
  const lineFit = await fitLines(doc, opts0);
  const opts: BuildOptions = { ...opts0, lineFit };
  let built = buildHwpx(doc, opts);
  const spacing: Record<string, number> = { ...opts.fillSpacing };
  if (built.fillPageTables.length) {
    for (const { blockId } of built.fillPageTables) {
      if (!(await shouldFill(built, blockId))) continue;
      const base = await tableRoom(built, blockId);
      if (!base || base.room <= 0) continue;
      // 줄 간격(%)을 이분 탐색 — 표가 같은 쪽에 남고 아래 여유가 FILL_SAFETY 이상인 가장 큰 값
      let lo = spacing[blockId] ?? 160;
      let hi = lo * 3;
      let best: BuildResult | undefined;
      for (let it = 0; it < 7 && hi - lo > 4; it++) {
        const mid = Math.round((lo + hi) / 2);
        const trial = buildHwpx(doc, { ...opts, fillSpacing: { ...spacing, [blockId]: mid } });
        const r = await tableRoom(trial, blockId);
        if (r && r.page === base.page && r.room >= 0) {
          lo = mid;
          best = trial;
        } else hi = mid;
      }
      if (best) {
        spacing[blockId] = lo;
        built = best;
      }
    }
  }
  const filled = await fillTextPages(doc, { ...opts, fillSpacing: spacing }, built);
  built = filled.built;
  // 한글이 있으면 한글 배치로 마무리한다(쪽 맨 위 여백·넘침) — 한글은 다음 문단과 함께를 스스로 지키므로 rhwp 로 잰 쪽 나눔은 넣지 않는다
  if (hangulAvailable()) {
    const hw = await hangulPass(doc, { ...opts, fillSpacing: spacing, spacingBoost: filled.boost }, built);
    if (hw) return hw;
  }
  const kept = await applyKeepWithNext(built.bytes);
  return { ...built, bytes: kept.bytes, sectionXml: kept.sectionXml };
}

/** 최상위 문단의 글(표·그림·글상자 안 글은 뺀다) — 한글 GetPageText 의 한 줄과 맞춘다 */
function ownText(p: XmlNode): string {
  let s = "";
  for (const r of childrenNamed(p, "hp:run")) {
    for (const t of childrenNamed(r, "hp:t")) {
      for (const c of t.children) s += typeof c === "string" ? c : "";
    }
  }
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

const norm = (s: string) => s.replace(/\s+/g, "");

/**
 * 한글 쪽별 글에서 최상위 문단마다 시작·끝 쪽을 찾는다. 쪽 글은 문단마다 한 줄(표만 든 문단은 빈 줄)이고,
 * 쪽에 걸친 문단은 두 쪽에 나뉘어 나온다. 맞추지 못하면 undefined.
 */
export function hangulParaPages(top: XmlNode[], texts: string[]): { start: number[]; end: number[] } | undefined {
  const want = top.map((p) => norm(ownText(p)));
  const start: number[] = Array(top.length).fill(-1);
  const end: number[] = Array(top.length).fill(-1);
  let k = 0, rest = want[0] ?? "";
  for (let pg = 0; pg < texts.length; pg++) {
    const lines = texts[pg].split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    for (const raw of lines) {
      const line = norm(raw);
      if (k >= top.length) return undefined;
      if (start[k] < 0) start[k] = pg;
      if (line === rest) {
        end[k] = pg;
        k++;
        rest = want[k] ?? "";
      } else if (line && rest.startsWith(line)) {
        rest = rest.slice(line.length); // 다음 쪽으로 이어지는 문단
      } else return undefined;
    }
  }
  return k === top.length ? { start, end } : undefined;
}

const HANGUL_PASSES = 4;

/**
 * 한글 배치로 마무리 — ① 쪽 맨 위에 온 문단(제목·띠 등)은 문단 위 여백을 없앤다(담당자 2026-10-13). ② 줄 간격을
 * 늘려 채운 쪽이 한글에서 넘치면 배율을 줄인다. rhwp 로 잰 채우기는 한글과 어긋나 "※ 근거" 가 다음 쪽으로 넘어갔다.
 */
async function hangulPass(doc: DocModel, opts: BuildOptions, built: BuildResult): Promise<BuildResult | undefined> {
  const boost: Record<string, number> = { ...opts.spacingBoost };
  const noPrev = new Set<string>(opts.noPrev ?? []);
  let cur = built;
  for (let pass = 0; pass < HANGUL_PASSES; pass++) {
    const hw = await hangulLayout(cur.bytes);
    if (!hw) return pass ? cur : undefined;
    const top = childrenNamed(parseXml(cur.sectionXml), "hp:p");
    const pages = hangulParaPages(top, hw.texts);
    if (!pages) return pass ? cur : undefined;
    let changed = false;
    // ① 쪽 맨 위 문단 — 앞 문단이 앞 쪽에서 끝나고 이 문단이 새 쪽에서 시작
    for (let k = 1; k < top.length; k++) {
      const id = String(top[k].attrs.id);
      if (pages.start[k] > pages.end[k - 1] && !noPrev.has(id)) {
        noPrev.add(id);
        changed = true;
      }
    }
    // ② 늘린 줄 간격이 넘친 쪽 — 같은 배율을 받은 문단 묶음이 한 쪽 안에 있지 않으면 배율을 반으로
    const groups = new Map<string, number[]>();
    top.forEach((p, k) => {
      const f = boost[String(p.attrs.id)];
      if (f && f > 1) {
        const key = `${f}`;
        const g = groups.get(key) ?? [];
        g.push(k);
        groups.set(key, g);
      }
    });
    for (const [f, ks] of groups) {
      const pg = pages.start[ks[0]];
      const fits = ks.every((k) => pages.start[k] === pg && pages.end[k] === pg);
      if (fits) continue;
      const nf = Math.round((1 + (Number(f) - 1) / 2) * 100) / 100;
      for (const k of ks) {
        const id = String(top[k].attrs.id);
        if (nf < 1.03) delete boost[id];
        else boost[id] = nf;
      }
      changed = true;
    }
    if (!changed) return cur;
    cur = buildHwpx(doc, { ...opts, spacingBoost: boost, noPrev: [...noPrev] });
  }
  return cur;
}

const TEXT_FILL_MIN_ROOM = 3000; // 이보다 덜 비면(약 2줄) 그대로 둔다
const TEXT_FILL_MAX = 1.8; // 줄 간격 배율 상한
const TEXT_PULL_MIN = 0.8; // 당길 때 줄 간격 배율 하한
const TEXT_PULL_MAX_SPILL = 4000; // 다음 쪽으로 넘어간 부분이 이보다 길면(약 2줄 넘게) 당기지 않는다
// 쪽 아래에 남길 여유 — 배치는 한글에 맞춘 사본으로 재지만(validate.asLaidOutByHangul) 남은 차이에 대비한다.
// 꽉 맞게 채우면 한글에서 끝줄이 다음 쪽으로 넘어갔다(결과보고서 2쪽 "※ 근거", 2026-10-13).
const TEXT_FILL_SAFETY = 1500;
const TEXT_PULL_SAFETY = 900;

interface ParaPos {
  page: number;
  top: number; // HWPUNIT
  bottom: number; // HWPUNIT, 알 수 없으면 NaN(표 문단·두 쪽에 걸친 문단)
  /** 글 문단이 끝나는 쪽과 그 쪽에서의 아래 끝 — 쪽 끝 문단의 끝줄이 다음 쪽으로 넘어갔는지 본다 */
  endPage: number;
  endBottom: number;
  hasTable: boolean;
}

/** 최상위 문단마다 놓인 쪽·위·아래(홀로 남은 제목 넘김을 한 배치) */
async function layoutOf(bytes: Uint8Array): Promise<{ kept: Fixed; pos: ParaPos[]; top: XmlNode[]; body: { top: number; bottom: number } } | undefined> {
  const kept = await applyKeepWithNext(bytes);
  const root = parseXml(kept.sectionXml);
  const top = childrenNamed(root, "hp:p");
  const pagePr = findFirst(root, "hp:pagePr");
  const margin = pagePr ? child(pagePr, "hp:margin") : undefined;
  if (!pagePr || !margin) return undefined;
  const mg = (k: string) => Number(margin.attrs[k]);
  const body = { top: mg("top") + mg("header"), bottom: Number(pagePr.attrs.height) - mg("bottom") - mg("footer") };
  const m = await rhwp();
  const d = new m.HwpDocument(asLaidOutByHangul(kept.bytes)) as unknown as {
    getCursorRect(s: number, p: number, o: number): string;
    getParagraphLength(s: number, p: number): number;
    free?(): void;
  };
  try {
    const pos = top.map((p, k): ParaPos => {
      const hasTable = findAll(p, "hp:tbl").length > 0 || findAll(p, "hp:pic").length > 0;
      const a = rectAt(d, k, 0);
      if (!a) return { page: -1, top: NaN, bottom: NaN, endPage: -1, endBottom: NaN, hasTable };
      let bottom = NaN, endPage = a.pageIndex, endBottom = NaN;
      const e = hasTable ? undefined : rectAt(d, k, Math.max(0, d.getParagraphLength(0, k)));
      if (e) {
        endPage = e.pageIndex;
        endBottom = Math.round((e.y + e.height) * PX);
        bottom = e.pageIndex === a.pageIndex ? endBottom : NaN;
      }
      return { page: a.pageIndex, top: Math.round(a.y * PX), bottom, endPage, endBottom, hasTable };
    });
    // 표 문단의 아래 끝은 같은 쪽 다음 문단의 위로 잰다
    pos.forEach((q, k) => {
      if (q.hasTable && pos[k + 1]?.page === q.page) q.bottom = pos[k + 1].top;
    });
    return { kept, pos, top, body };
  } finally {
    d.free?.();
  }
}

/**
 * 본문 쪽 맞춤 — 쪽마다 둘 중 하나를 고친다(글 문단의 줄 간격 배율, 표·그림 문단은 그대로).
 * ① 채우기: 다음 내용이 그 쪽에 들어가지 못해(홀로 남은 제목 넘김·표 통째 넘김) 쪽 아래가 크게 비면 줄 간격을 늘린다.
 *    결과보고서 2쪽 "※ 근거" 아래가 휑하게 비고 Ⅱ 추진결과는 표째 3쪽으로 넘어갔다. 쪽이 절반 넘게 찼을 때만.
 * ② 당기기: 쪽 끝 문단의 끝 한두 줄만 다음 쪽으로 넘어가면 줄 간격을 조금(최대 20 %) 줄여 그 쪽에 넣는다.
 *    "- (계획 대비) … 계획 일정(7월 협 / 약·지급)대로 추진" 이 3·4쪽에 걸쳤다.
 * 문서가 일부러 나눈 쪽(표지 뒤 등 쪽 나눔)은 건드리지 않는다(담당자 2026-10-12).
 */
async function fillTextPages(doc: DocModel, opts: BuildOptions, built: BuildResult): Promise<{ built: BuildResult; boost: Record<string, number> }> {
  const first = await layoutOf(built.bytes);
  if (!first) return { built, boost: { ...opts.spacingBoost } };
  let base = first;
  const explicit = new Set(childrenNamed(parseXml(built.sectionXml), "hp:p").map((p, k) => (p.attrs.pageBreak === "1" ? k : -1)).filter((k) => k >= 0));
  const boost: Record<string, number> = { ...opts.spacingBoost };
  let cur = built;
  // 배율 하나를 이분 탐색 — ok(배율) 이 참인 쪽으로 좁힌다
  const search = async (ids: string[], from: number, to: number, ok: (lay: NonNullable<Awaited<ReturnType<typeof layoutOf>>>) => boolean) => {
    let good = from, bad = to;
    let best: BuildResult | undefined;
    for (let it = 0; it < 6; it++) {
      const mid = Math.round(((good + bad) / 2) * 100) / 100;
      if (mid === good || mid === bad) break;
      const trial = buildHwpx(doc, { ...opts, spacingBoost: { ...boost, ...Object.fromEntries(ids.map((id) => [id, mid])) } });
      const lay = await layoutOf(trial.bytes);
      if (lay && ok(lay)) {
        good = mid;
        best = trial;
      } else bad = mid;
    }
    return best ? { factor: good, built: best } : undefined;
  };
  for (let page = 0; page < Math.max(...base.pos.map((q) => q.page)); page++) {
    const ks: number[] = base.pos.map((q, k) => (q.page === page ? k : -1)).filter((k) => k >= 0);
    if (!ks.length) continue;
    const last = ks[ks.length - 1];
    const next = last + 1;
    const ids = ks.filter((k) => !base.pos[k].hasTable).map((k) => String(base.top[k].attrs.id));
    if (!ids.length) continue;
    const q = base.pos[last];
    let found: { factor: number; built: BuildResult } | undefined;
    if (!q.hasTable && q.endPage === page + 1 && q.endBottom - base.body.top <= TEXT_PULL_MAX_SPILL) {
      // ② 당기기 — 줄 간격을 줄여 그 문단이 이 쪽에서 끝나게
      const fits = (lay: NonNullable<Awaited<ReturnType<typeof layoutOf>>>) => lay.pos[last]?.page === page && lay.pos[last].endPage === page && lay.pos[last].endBottom <= lay.body.bottom - TEXT_PULL_SAFETY;
      const firstTry = buildHwpx(doc, { ...opts, spacingBoost: { ...boost, ...Object.fromEntries(ids.map((id) => [id, TEXT_PULL_MIN])) } });
      const lay0 = await layoutOf(firstTry.bytes);
      if (lay0 && fits(lay0)) found = (await search(ids, TEXT_PULL_MIN, 1, fits)) ?? { factor: TEXT_PULL_MIN, built: firstTry };
    } else if (next < base.top.length && !explicit.has(next) && Number.isFinite(q.bottom)) {
      // ① 채우기
      const room = base.body.bottom - q.bottom;
      const pageTop = Math.min(...ks.map((k) => base.pos[k].top));
      if (room >= TEXT_FILL_MIN_ROOM && (q.bottom - pageTop) * 2 >= base.body.bottom - base.body.top)
        found = await search(ids, 1, TEXT_FILL_MAX, (lay) => lay.pos[last]?.page === page && lay.pos[next]?.page === page + 1 && Number.isFinite(lay.pos[last].bottom) && lay.pos[last].bottom <= lay.body.bottom - TEXT_FILL_SAFETY);
    }
    if (found && found.factor !== 1) {
      for (const id of ids) boost[id] = found.factor;
      cur = found.built;
      // 이 쪽을 고치면 뒤 쪽 배치가 바뀔 수 있다 — 다시 잰다
      base = (await layoutOf(cur.bytes)) ?? base;
    }
  }
  return { built: cur, boost };
}

const PX = 75; // rhwp 좌표(96 dpi 픽셀) 1 = 75 HWPUNIT

interface Rect {
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}
/** 커서 위치 — rhwp 가 찾지 못하는 문단(쪽에 고정한 표만 든 문단 등)은 undefined. 하나 때문에 배치 보정 전체가 멈추지 않게 */
function rectAt(d: { getCursorRect(s: number, p: number, o: number): string }, k: number, o: number): Rect | undefined {
  try {
    return JSON.parse(d.getCursorRect(0, k, o)) as Rect;
  } catch {
    return undefined;
  }
}

/** 글머리 — 빈칸 + (□ ㅇ ○ ◦ - ※ * · ① 1. 1) …) + 빈칸. 둘째 줄은 이 다음 첫 글자 아래에서 시작한다 */
const GLYPH_PREFIX = /^(\s*(?:[□■ㅇ○◦❍●•∙·※*▶►◇◆\-]|[①-⑳]|\d{1,2}[.)])\s+)/;
/** 자간을 이만큼(%)까지 줄여 본다 — 한 단계씩, 고쳐지면 멈춘다 */
const CONDENSE_STEPS = [-1, -2, -3, -4, -5, -6, -8, -10];
/** 미리보기에서 맞춘 자간에 한글용 여유를 더 줄 단계(%)와 그 바닥 */
const CONDENSE_HEADROOM = 2;
const CONDENSE_FLOOR = -12;
/** 줄여도 안 될 때 넓혀 볼 자간(%) */
const EXPAND_STEPS = [1, 2, 3, 4, 5];
/** 끝줄에 남은 글자가 이 이하(빈칸 빼고)면 윗줄로 붙인다 — "비용 / 지원", "멘토링 / 운영" */
const SHORT_TAIL = 4;

interface LineReport {
  id: string;
  /** 글머리 다음 첫 글자까지의 폭(HWPUNIT) — 내어쓰기 값 */
  hanging?: number;
  lineCount: number;
  /** 줄 끝에서 단어가 쪼개졌거나 끝줄에 몇 글자만 남았다 */
  bad: boolean;
  /** 줄 끝에서 단어가 쪼개졌다 */
  splitWord: boolean;
  /** 문단 글자(rhwp 글자 위치대로)와 단어가 쪼개진 줄 끝 위치들 */
  text: string;
  splits: number[];
}

/** 문단 글자를 rhwp 의 글자 위치대로 — hp:t 안의 고정폭 빈칸·탭 같은 요소도 한 글자(빈칸)로 센다 */
function paraChars(p: XmlNode): string {
  let out = "";
  for (const run of childrenNamed(p, "hp:run"))
    for (const t of childrenNamed(run, "hp:t")) for (const c of t.children) out += typeof c === "string" ? c : " ";
  return out;
}

/** 글 문단마다(최상위·표 칸) 줄 나눔을 잰다 — 그림을 품은 문단, 글자 수가 맞지 않는 문단은 뺀다 */
async function measureLines(bytes: Uint8Array, sectionXml: string): Promise<LineReport[]> {
  const top = childrenNamed(parseXml(sectionXml), "hp:p");
  const m = await rhwp();
  const d = new m.HwpDocument(bytes) as unknown as {
    getCursorRect(s: number, p: number, o: number): string;
    getParagraphLength(s: number, p: number): number;
    getLineInfo(s: number, p: number, o: number): string;
    getCellParagraphLength(s: number, p: number, c: number, cell: number, cp: number): number;
    getLineInfoInCell(s: number, p: number, c: number, cell: number, cp: number, o: number): string;
    getCursorRectInCell(s: number, p: number, c: number, cell: number, cp: number, o: number): string;
    free?(): void;
  };
  const out: LineReport[] = [];
  /** 한 문단의 줄 나눔·내어쓰기를 잰다 — 최상위 문단과 표 칸 문단이 위치를 묻는 함수만 다르다 */
  const report = (p: XmlNode, len: number, lineAt: (o: number) => string, xAt: (o: number) => number) => {
    const text = paraChars(p);
    if (!text.trim() || len !== text.length) return;
    const prefix = GLYPH_PREFIX.exec(text);
    const hanging = prefix ? Math.max(0, Math.round((xAt(prefix[1].length) - xAt(0)) * PX)) : undefined;
    // 줄마다 [시작, 끝)
    const lines: [number, number][] = [];
    for (let o = 0; o < len && lines.length < 50; ) {
      const li = JSON.parse(lineAt(o)) as { charStart: number; charEnd: number };
      lines.push([li.charStart, li.charEnd]);
      if (li.charEnd <= o) break;
      o = li.charEnd;
    }
    let splitWord = false, shortTail = false;
    const splits: number[] = [];
    if (lines.length > 1) {
      for (const [, e] of lines.slice(0, -1)) if (e > 0 && e < len && /\S/.test(text[e - 1]) && /\S/.test(text[e])) splits.push(e);
      splitWord = splits.length > 0;
      const tail = text.slice(lines[lines.length - 1][0]).replace(/\s/g, "");
      shortTail = tail.length > 0 && tail.length <= SHORT_TAIL;
    }
    out.push({ id: String(p.attrs.id), hanging, lineCount: lines.length, bad: splitWord || shortTail, splitWord, text, splits });
  };
  try {
    top.forEach((p, k) => {
      const tables = childrenNamed(p, "hp:run").flatMap((r) => childrenNamed(r, "hp:tbl"));
      if (!tables.length && !findAll(p, "hp:pic").length) {
        try {
          report(p, d.getParagraphLength(0, k), (o) => d.getLineInfo(0, k, o), (o) => (JSON.parse(d.getCursorRect(0, k, o)) as { x: number }).x);
        } catch {
          /* rhwp 가 위치를 못 찾는 문단은 건너뛴다 */
        }
        return;
      }
      // 표 하나만 든 문단(표 앵커) — 칸 문단도 잰다. 칸은 행 순서대로 번호가 붙는다(안에 든 표는 건드리지 않는다)
      if (tables.length !== 1 || k === 0) return;
      const cells = childrenNamed(tables[0], "hp:tr").flatMap((tr) => childrenNamed(tr, "hp:tc"));
      cells.forEach((tc, ci) => {
        const sub = child(tc, "hp:subList");
        (sub ? childrenNamed(sub, "hp:p") : []).forEach((cp, j) => {
          if (findAll(cp, "hp:tbl").length || findAll(cp, "hp:pic").length) return;
          try {
            const len = d.getCellParagraphLength(0, k, 0, ci, j);
            report(cp, len, (o) => d.getLineInfoInCell(0, k, 0, ci, j, o), (o) => (JSON.parse(d.getCursorRectInCell(0, k, 0, ci, j, o)) as { x: number }).x);
          } catch {
            /* 쪽에 고정한 표 등 rhwp 가 위치를 못 찾는 칸은 건너뛴다 */
          }
        });
      });
    });
  } finally {
    d.free?.();
  }
  return out;
}

/**
 * 줄 맞춤 — 한글에서 손으로 하는 두 가지를 실제 배치로 재서 문단마다 정한다(담당자 2026-10-12).
 * ① 내어쓰기(Shift+Tab): 둘째 줄이 글머리 다음 첫 글자("ㅇ 추진현황" 의 '추') 바로 아래에서 시작하게. 글자 폭 추정으로
 *    잡던 내어쓰기는 실제 글꼴 폭과 어긋났다.
 * ② 자간 좁게(Alt+Shift+N): 줄 끝에서 단어가 쪼개졌거나("대 / 상") 끝줄에 몇 글자만 남은("비용 / 지원") 문단은
 *    자간을 한 단계씩 줄여 윗줄로 붙인다. 고쳐지면 멈추고, 한도(-10 %)까지 안 되면 원래대로 둔다.
 */
async function fitLines(doc: DocModel, opts: BuildOptions): Promise<Record<string, { hanging?: number; charSpacing?: number; breaks?: number[] }>> {
  const fit: Record<string, { hanging?: number; charSpacing?: number; breaks?: number[] }> = { ...opts.lineFit };
  const b0 = buildHwpx(doc, { ...opts, lineFit: fit });
  for (const r of await measureLines(b0.bytes, b0.sectionXml)) if (r.hanging !== undefined) fit[r.id] = { ...fit[r.id], hanging: r.hanging };
  const b1 = buildHwpx(doc, { ...opts, lineFit: fit });
  const before = new Map((await measureLines(b1.bytes, b1.sectionXml)).map((r) => [r.id, r]));
  // 한 단계씩 바꿔 가며 고쳐진 문단은 그 값에서 멈춘다. ok: 고쳐졌는가
  const tryAll = async (ids: string[], steps: number[], ok: (r: LineReport, r0: LineReport) => boolean) => {
    let todo = ids;
    for (const step of steps) {
      if (!todo.length) break;
      for (const id of todo) fit[id] = { ...fit[id], charSpacing: step };
      const b = buildHwpx(doc, { ...opts, lineFit: fit });
      const now = new Map((await measureLines(b.bytes, b.sectionXml)).map((r) => [r.id, r]));
      todo = todo.filter((id) => {
        const r = now.get(id), r0 = before.get(id);
        return !(r && r0 && ok(r, r0));
      });
    }
    for (const id of todo) if (fit[id]) delete fit[id].charSpacing;
    return todo;
  };
  const bad = [...before.values()].filter((r) => r.bad).map((r) => r.id);
  // 1) 자간 좁게 — 쪼개진 단어·짧은 끝줄을 윗줄로
  const left = await tryAll(bad, CONDENSE_STEPS, (r, r0) => !r.bad && r.lineCount <= r0.lineCount);
  // 한글은 rhwp 보다 글자 폭을 조금 넓게 잡는다 — 미리보기에서 딱 맞춘 값이면 한글에서 끝 글자(")")가 넘쳤다
  // ("로컬상점온기(이수진 / )", 담당자 2026-10-12). 줄여서 고친 문단은 여유를 두 단계 더 준다
  for (const id of bad) if (!left.includes(id) && fit[id]?.charSpacing) fit[id].charSpacing = Math.max(CONDENSE_FLOOR, fit[id].charSpacing! - CONDENSE_HEADROOM);
  // 2) 그래도 안 되면 자간을 조금 넓혀 단어를 통째로 다음 줄로 — 한글은 어절 단위 줄 나눔(KEEP_WORD)으로 단어를 통째
  //    넘기지만 rhwp 미리보기는 한글 낱말을 글자 단위로 끊는다. 이렇게 하면 미리보기와 한글이 같은 줄 나눔이 된다
  const stuck = await tryAll(left, EXPAND_STEPS, (r, r0) => !r.splitWord && r.lineCount <= r0.lineCount);
  // 3) 그래도 쪼개지는 긴 덩어리(기관명 등)는 뜻이 갈리는 자리에서 줄을 바꾼다 — "(재)경상북도경제 / 진흥원"(담당자 2026-10-12)
  //    뜻이 갈리는 자리가 줄 끝보다 조금 뒤면("네트워 / 킹(…" 의 "(" 앞) 그 자리에서 바꾸고 자간을 줄여 윗줄에 넣는다
  const withBreaks: string[] = [];
  for (const id of stuck) {
    const r = before.get(id);
    if (!r) continue;
    const breaks = r.splits.map((e) => breakPoint(r.text, e)).filter((b): b is number => b !== undefined);
    if (breaks.length) {
      fit[id] = { ...fit[id], breaks };
      withBreaks.push(id);
    }
  }
  const failed = await tryAll(withBreaks, [0, ...CONDENSE_STEPS], (r, r0) => !r.splitWord && r.lineCount <= r0.lineCount);
  for (const id of failed) if (fit[id]) delete fit[id].breaks;
  for (const id of withBreaks) if (!failed.includes(id) && fit[id]?.charSpacing) fit[id].charSpacing = Math.max(CONDENSE_FLOOR, fit[id].charSpacing! - CONDENSE_HEADROOM);
  return fit;
}

/** 줄을 바꾸기 좋은 자리 — 법인 머리 "(재)" 뒤, 지역명 뒤, 기관 꼬리(진흥원·재단·센터 …) 앞, 가운뎃점 뒤, 여는 괄호 앞 */
const BREAK_AFTER = [/^\((?:재|주|사|사단|재단|유|합)\)/g, /(?:경상북도|경북|대구광역시|(?:포항|경주|김천|안동|구미|영주|영천|상주|문경|경산)시|(?:의성|청송|영양|영덕|청도|고령|성주|칠곡|예천|봉화|울진|울릉)군)/g, /[·∙,)]/g];
const BREAK_BEFORE = [/(?:경제진흥원|진흥원|재단|센터|협회|연구원|연구소|위원회|공단|공사|조합|지원단|사업단|협의회|협의체|기업|기관)/g, /\(/g];

/**
 * 줄 끝 e 에서 쪼개진 덩어리(빈칸 사이)를 어디서 바꿀지 — e 이하에서 뜻이 갈리는 가장 뒤 자리, 없으면 e 뒤 세 글자 안의
 * 가장 앞 자리(자간을 줄여 윗줄에 넣는다). 두 쪽 모두 두 글자 이상. 마땅한 자리가 없으면 undefined(그대로 둔다).
 */
function breakPoint(text: string, e: number): number | undefined {
  let ts = e;
  while (ts > 0 && /\S/.test(text[ts - 1])) ts--;
  let te = e;
  while (te < text.length && /\S/.test(text[te])) te++;
  const token = text.slice(ts, te);
  const cand = new Set<number>();
  for (const re of BREAK_AFTER) for (const m of token.matchAll(re)) cand.add(ts + m.index! + m[0].length);
  for (const re of BREAK_BEFORE) for (const m of token.matchAll(re)) cand.add(ts + m.index!);
  const ok = [...cand].filter((p) => p - ts >= 2 && te - p >= 2);
  const before = ok.filter((p) => p <= e), after = ok.filter((p) => p > e && p <= e + 3);
  return before.length ? Math.max(...before) : after.length ? Math.min(...after) : undefined;
}
const FILL_SAFETY = 900; // 쪽 아래 끝에서 남겨 둘 여유(약 3 mm) — 넘치면 표가 통째로 다음 쪽으로 간다

/**
 * 쪽을 채울지 — 표 높이가 본문 높이의 절반 이상이고, (홀로 남은 제목 넘김까지 한 뒤) 표 다음의 내용 문단이 다음 쪽에서
 * 시작할 때만. 뒤 내용이 같은 쪽에 이어지면 늘리지 않는다.
 */
async function shouldFill(built: BuildResult, blockId: string): Promise<boolean> {
  const tblId = built.fillPageTables.find((f) => f.blockId === blockId)?.tblId;
  const kept = await applyKeepWithNext(built.bytes);
  const root = parseXml(kept.sectionXml);
  const top = childrenNamed(root, "hp:p");
  const i = top.findIndex((p) => findAll(p, "hp:tbl").some((t) => String(t.attrs.id) === tblId));
  const pagePr = findFirst(root, "hp:pagePr");
  const margin = pagePr ? child(pagePr, "hp:margin") : undefined;
  if (i < 0 || !pagePr || !margin) return false;
  const tbl = findAll(top[i], "hp:tbl").find((t) => String(t.attrs.id) === tblId)!;
  const body = Number(pagePr.attrs.height) - ["top", "header", "bottom", "footer"].reduce((a, k) => a + Number(margin.attrs[k]), 0);
  const tblH = Number(childrenNamed(tbl, "hp:sz")[0]?.attrs.height ?? 0);
  if (tblH * 2 < body) return false;
  // 표 다음 첫 내용 문단(빈 줄 건너뜀). 없으면(문서 끝) 늘리지 않는다
  const j = top.findIndex((p, k) => k > i && (findAll(p, "hp:tbl").length > 0 || textOf(p).trim() !== ""));
  if (j < 0) return false;
  const m = await rhwp();
  const d = new m.HwpDocument(asLaidOutByHangul(kept.bytes)) as unknown as { getCursorRect(s: number, p: number, o: number): string; free?(): void };
  try {
    const a = rectAt(d, i, 0), b = rectAt(d, j, 0);
    return !!a && !!b && b.pageIndex > a.pageIndex;
  } finally {
    d.free?.();
  }
}

/** 표가 놓인 쪽과, 표 바로 다음 문단 아래에서 본문 아래 끝까지 남은 높이(HWPUNIT, 여유 뺀 값) */
async function tableRoom(built: BuildResult, blockId: string): Promise<{ page: number; room: number } | undefined> {
  const tblId = built.fillPageTables.find((f) => f.blockId === blockId)?.tblId;
  const root = parseXml(built.sectionXml);
  const top = childrenNamed(root, "hp:p");
  const i = top.findIndex((p) => findAll(p, "hp:tbl").some((t) => String(t.attrs.id) === tblId));
  const pagePr = findFirst(root, "hp:pagePr");
  const margin = pagePr ? child(pagePr, "hp:margin") : undefined;
  if (i < 0 || i + 1 >= top.length || !pagePr || !margin) return undefined;
  const bodyBottom = Number(pagePr.attrs.height) - Number(margin.attrs.bottom) - Number(margin.attrs.footer);
  const m = await rhwp();
  const d = new m.HwpDocument(asLaidOutByHangul(built.bytes)) as unknown as { getCursorRect(s: number, p: number, o: number): string; free?(): void };
  try {
    const t = rectAt(d, i, 0), n = rectAt(d, i + 1, 0);
    if (!t || !n) return undefined;
    // 다음 문단이 다음 쪽이면 표가 쪽 끝을 넘겼거나 잴 수 없다
    if (n.pageIndex !== t.pageIndex) return { page: t.pageIndex, room: -1 };
    return { page: t.pageIndex, room: bodyBottom - Math.round((n.y + n.height) * PX) - FILL_SAFETY };
  } finally {
    d.free?.();
  }
}

function rezip(entries: Record<string, Uint8Array>, sectionXml: string): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [name, data] of Object.entries(entries)) {
    const body = name === "Contents/section0.xml" ? new TextEncoder().encode(sectionXml) : data;
    files[name] = [body, { level: name === "mimetype" || name.startsWith("BinData/") ? 0 : 6 }];
  }
  return zipSync(files, { mtime: new Date("1980-01-01T00:00:00Z") });
}
