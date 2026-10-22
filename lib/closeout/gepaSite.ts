/**
 * 진흥원 홈페이지(gepa.kr) 보도자료·행사사진 — 결과보고서의 보조 자료.
 *
 * 담당자가 올린 자료에 행사 사진이 없어도, 같은 행사를 홈페이지 「행사사진」(page_id=57)이나
 * 「보도자료」(page_id=55)에 올려 둔 경우가 많다(담당자 2026-10-21). 사업명·세부사업 이름으로 두 게시판을
 * 검색해 사업연도에 올라온 글만 `materials/web/` 에 내려받는다:
 *   - `web/<게시판>_<vid>.md` — 제목·작성일·분류·주소·본문 텍스트
 *   - `web/<게시판>_<vid>_<nn>.jpg` — 글에 붙은 사진(글마다 최대 10장)
 * 이 사업의 행사인지(사업명·날짜가 맞는지)는 에이전트가 판단한다 — 여기서는 후보만 모은다.
 * 게시판은 망보드(mangboard) 플러그인이다: 검색은 `?page_id=…&search_field=all&search_text=…` GET 으로 된다.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeSync } from "../fsSafe";

const ORIGIN = "https://www.gepa.kr";
export const GEPA_BOARDS = {
  photo: { pageId: 57, label: "행사사진" },
  press: { pageId: 55, label: "보도자료" },
} as const;
export type GepaBoard = keyof typeof GEPA_BOARDS;

export interface GepaPost {
  board: GepaBoard;
  vid: number;
  url: string;
  title: string;
  /** 작성일 YYYY-MM-DD(행사일이 아니라 게시일이다) */
  date: string;
  category?: string;
  text: string;
  images: string[];
}

/** 저장해 둔 글(자료 목록·에이전트 안내에 쓴다) */
export interface SavedGepaPost {
  board: GepaBoard;
  vid: number;
  title: string;
  date: string;
  url: string;
  /** 작업 폴더 기준 */
  textPath: string;
  photos: string[];
}

const MAX_POSTS = 8;
/** 행사 사진 글은 단체 사진에 대상 기업마다 한 장씩 올리는 일이 많다(수여식 6장) — 기업별로 고를 수 있게 넉넉히 받는다 */
const MAX_PHOTOS_PER_POST = 10;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/** 홈페이지 원본은 한 장에 13MB 남짓(6000px 넘는 카메라 원본)이라 그대로 넣으면 한글 파일이 수십 MB 가 된다 */
const PHOTO_MAX_EDGE = 1600;

/**
 * 긴 변 1600px·JPEG 로 줄인다. sharp 는 next 가 딸려 설치하는 것을 빌려 쓴다(직접 의존성 아님) —
 * 없거나 실패하면 원본을 그대로 둔다.
 */
async function shrinkPhoto(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(bytes)
      .rotate()
      .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return out.byteLength < bytes.byteLength ? new Uint8Array(out) : bytes;
  } catch {
    return bytes;
  }
}

/** 사업명에서 검색어로 쓸 핵심 낱말 — 연도·"경상북도"·"지원사업" 같은 꾸밈과 [시험] 표시를 뗀다 */
export function coreTitle(title: string): string {
  return title
    .replace(/\[[^\]]*\]|「|」|『|』|"/g, " ")
    .replace(/\(?\s*20\d\d\s*년도?\s*\)?/g, " ")
    .replace(/\(재\)|재단법인/g, " ")
    .replace(/경상북도|경북도|경북/g, " ")
    .replace(/(\s*(지원|육성|운영|추진|사업))+\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["지원", "사업", "지원사업", "육성", "운영", "추진", "및", "등", "결과", "보고", "경상북도", "경북"]);

/** 관련도를 잴 낱말(2글자 이상) */
export function keywordTokens(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const w of coreTitle(t).split(/[\s·,()/]+/)) if (w.length >= 2 && !STOP.has(w)) out.add(w);
  return [...out];
}

/**
 * 검색어 — 사업명 핵심 전체, 그 앞 두 낱말, 세부사업 이름(행사 이름이 게시글 제목이 되는 일이 많다).
 * 망보드 검색은 낱말 그대로(부분 일치) 찾으므로 긴 구는 놓치기 쉽다 — 짧은 구도 함께 쓴다.
 */
export function searchQueries(title: string, subprojects: string[] = []): string[] {
  const core = coreTitle(title);
  const words = core.split(" ").filter((w) => w.length >= 2);
  // 낱말 하나짜리 검색어도 둔다 — "청년 로컬크리에이터"는 0건, "로컬크리에이터"는 7건(2026-10-21 실측). 긴 낱말이 덜 흔하다
  const singles = keywordTokens(title).filter((w) => w.length >= 3).sort((a, b) => b.length - a.length).slice(0, 2);
  const qs = [core, words.slice(0, 2).join(" "), ...singles, ...subprojects.map(coreTitle)];
  return [...new Set(qs.map((q) => q.trim()).filter((q) => q.length >= 2))].slice(0, 8);
}

/** 글 제목·본문에 사업 낱말이 몇 개 들어 있나 — 제목에 든 낱말은 두 배 */
export function relevance(post: Pick<GepaPost, "title" | "text">, tokens: string[]): number {
  return tokens.reduce((s, t) => s + (post.title.includes(t) ? 2 : post.text.includes(t) ? 1 : 0), 0);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&");
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** 검색 결과 쪽에서 글 번호(vid)를 순서대로 */
export function parseSearchVids(html: string, board: GepaBoard): number[] {
  const re = new RegExp(`page_id=${GEPA_BOARDS[board].pageId}[^"']*?vid=(\\d+)`, "g");
  const out: number[] = [];
  for (const m of html.replace(/&#038;|&amp;/g, "&").matchAll(re)) {
    const v = Number(m[1]);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** 글 보기 쪽 → 제목·작성일·분류·본문·사진 */
export function parsePost(html: string, board: GepaBoard, vid: number): GepaPost | null {
  const title = /class="mb-vew-title"[^>]*>\s*<span>([\s\S]*?)<\/span>/.exec(html)?.[1];
  const date = /작성일<\/span>\s*<span[^>]*>\s*(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
  if (!title || !date) return null;
  const category = /분류<\/span>\s*<span[^>]*>([^<]*)</.exec(html)?.[1]?.trim() || undefined;
  const content = /<td class="content-box[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(html)?.[1] ?? "";
  const images = [...content.matchAll(/<img[^>]+src="([^"]+)"/g)]
    .map((m) => decodeEntities(m[1]))
    .map((src) => (src.startsWith("http") ? src : `${ORIGIN}${src.startsWith("/") ? "" : "/"}${src}`))
    .filter((src) => /\/wp-content\/uploads\//.test(src) && /\.(jpe?g|png)(\?|$)/i.test(src));
  return { board, vid, url: `${ORIGIN}/?page_id=${GEPA_BOARDS[board].pageId}&vid=${vid}`, title: htmlToText(title), date, category, text: htmlToText(content), images: [...new Set(images)] };
}

type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = (url) => fetch(url, { headers: { "user-agent": "Mozilla/5.0 (GEPA document engineering)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });

async function getText(f: Fetcher, url: string): Promise<string> {
  const r = await f(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

export interface CollectOptions {
  title: string;
  /** 세부사업 이름(원장의 세부사업) — 행사 이름으로 검색한다 */
  subprojects?: string[];
  /** 사업연도 — 이 해와 다음 해 2월까지 올라온 글만 */
  year?: number;
  fetcher?: Fetcher;
}

/** 두 게시판을 검색해 관련 글을 관련도 순으로(사진 게시판 먼저) */
export async function searchGepaSite(opts: CollectOptions): Promise<GepaPost[]> {
  const f = opts.fetcher ?? defaultFetch;
  const tokens = keywordTokens(opts.title, ...(opts.subprojects ?? []));
  const titleTokens = keywordTokens(opts.title);
  const seen = new Set<string>();
  const posts: { post: GepaPost; score: number }[] = [];
  for (const board of ["photo", "press"] as GepaBoard[]) {
    for (const q of searchQueries(opts.title, opts.subprojects)) {
      let html: string;
      try {
        html = await getText(f, `${ORIGIN}/?page_id=${GEPA_BOARDS[board].pageId}&search_field=all&search_text=${encodeURIComponent(q)}`);
      } catch {
        continue;
      }
      for (const vid of parseSearchVids(html, board).slice(0, 12)) {
        const key = `${board}_${vid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let post: GepaPost | null = null;
        try {
          post = parsePost(await getText(f, `${ORIGIN}/?page_id=${GEPA_BOARDS[board].pageId}&vid=${vid}`), board, vid);
        } catch {
          continue;
        }
        if (!post || !inYear(post.date, opts.year)) continue;
        const score = relevance(post, tokens);
        // 글 제목에 사업명 낱말이 하나는 있어야 한다(본문에 한 번 스친 글은 뺀다). 같은 낱말만 겹치는
        // 다른 사업 글은 남을 수 있다 — 관련도 순으로 앞에 두고, 이 사업인지는 에이전트가 날짜·내용으로 가린다.
        if ((titleTokens.some((t) => post.title.includes(t)) && score >= 2) || score >= 4) posts.push({ post, score });
      }
    }
  }
  return posts.sort((a, b) => b.score - a.score || (a.post.board === "photo" ? -1 : 1)).map((p) => p.post).slice(0, MAX_POSTS);
}

function inYear(date: string, year: number | undefined): boolean {
  if (!year) return true;
  const [y, m] = date.split("-").map(Number);
  return y === year || (y === year + 1 && m <= 2);
}

export function webDir(materialsDir: string): string {
  return join(materialsDir, "web");
}

/** 찾은 글과 사진을 `materials/web/` 에 저장한다(이전에 받은 것은 지우고 새로 받는다) */
export async function saveGepaPosts(materialsDir: string, posts: GepaPost[], fetcher?: Fetcher): Promise<SavedGepaPost[]> {
  const f = fetcher ?? defaultFetch;
  const dir = webDir(materialsDir);
  if (existsSync(dir)) removeSync(dir);
  mkdirSync(dir, { recursive: true });
  // 찾은 글이 없어도 posts.json 을 남긴다 — 하루 안에 다시 검색하지 않는 표시(webMaterials.ts)
  if (!posts.length) {
    writeFileSync(join(dir, "posts.json"), "[]", "utf8");
    return [];
  }
  const saved: SavedGepaPost[] = [];
  for (const p of posts) {
    const base = `${p.board}_${p.vid}`;
    const photos: string[] = [];
    for (const [i, src] of p.images.slice(0, MAX_PHOTOS_PER_POST).entries()) {
      try {
        const r = await f(src);
        if (!r.ok) continue;
        const raw = new Uint8Array(await r.arrayBuffer());
        if (raw.byteLength > MAX_PHOTO_BYTES || raw.byteLength < 10 * 1024) continue;
        const bytes = await shrinkPhoto(raw);
        // 줄였으면 JPEG 다(png 도 jpeg 로 다시 쓴다)
        const ext = bytes === raw && /\.png(\?|$)/i.test(src) ? ".png" : ".jpg";
        const name = `${base}_${String(i + 1).padStart(2, "0")}${ext}`;
        writeFileSync(join(dir, name), bytes);
        photos.push(`materials/web/${name}`);
      } catch {
        /* 사진 한 장을 못 받아도 글은 남긴다 */
      }
    }
    const md = [
      `# ${p.title}`,
      "",
      `- 게시판: gepa.kr ${GEPA_BOARDS[p.board].label}${p.category ? ` (${p.category})` : ""}`,
      `- 작성일: ${p.date} — 게시일이다. 행사일은 본문·사진에서 확인한다`,
      `- 주소: ${p.url}`,
      ...(photos.length ? [`- 사진: ${photos.map((x) => `\`${x}\``).join(", ")}`] : []),
      "",
      "## 본문",
      "",
      p.text || "(본문 글 없음 — 사진만 있는 글)",
      "",
    ].join("\n");
    writeFileSync(join(dir, `${base}.md`), md, "utf8");
    saved.push({ board: p.board, vid: p.vid, title: p.title, date: p.date, url: p.url, textPath: `materials/web/${base}.md`, photos });
  }
  writeFileSync(join(dir, "posts.json"), JSON.stringify(saved, null, 2), "utf8");
  return saved;
}

export function readSavedGepaPosts(materialsDir: string): SavedGepaPost[] {
  const p = join(webDir(materialsDir), "posts.json");
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SavedGepaPost[];
  } catch {
    return [];
  }
}

/** 저장된 사진 파일 이름 → 그 글 */
export function postOfPhoto(materialsDir: string, file: string): SavedGepaPost | undefined {
  return readSavedGepaPosts(materialsDir).find((p) => p.photos.some((x) => x.endsWith(`/${file}`)));
}

export function listWebPhotoFiles(materialsDir: string): string[] {
  const dir = webDir(materialsDir);
  return existsSync(dir) ? readdirSync(dir).filter((n) => /\.(jpe?g|png)$/i.test(n)).sort() : [];
}
