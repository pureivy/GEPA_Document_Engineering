/**
 * 업무보고 본보기 모음 — 진흥원 실제 보고서를 모아 두고, 업무보고를 쓸 때 에이전트가 지시와 가장 가까운 본보기를
 * 골라 짜임·분량·어투·표 쓰는 방식을 따른다(담당자 2026-11-18: "양식을 꼭 정해놔야 하나, 내가 이것저것 줄 테니
 * 보고 내용·형태·대상·분량을 보고 알아서 쓰게"). 고정 「참조 양식」 목록을 대신한다.
 *
 *   <data>/report-examples/원본/   담당자가 넣는 실제 보고서(hwpx·hwp·pdf·docx) — 하위 폴더 가능
 *   <data>/report-examples/글/     본보기마다 뽑은 글(.txt) — 에이전트가 Read 한다
 *   <data>/report-examples/catalog.md  본보기 카드(제목·분량·장절 줄·표 수) — 에이전트가 먼저 읽고 고른다
 *
 * 참고본(templates/report/reference.hwpx)은 첫 본보기로 늘 들어간다. 글은 원본이 바뀔 때만 다시 뽑는다.
 * 대상(내부·도지사·도의회·행감)과 성격은 프로그램이 짐작하지 않는다 — 카드의 제목과 장절 줄을 보고 에이전트가 판단한다.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { unzipSync } from "fflate";
import { extractReferenceText } from "../reference/extract";

export const EXAMPLE_EXTENSIONS = [".hwpx", ".hwp", ".pdf", ".docx"] as const;

/** 한 쪽에 드는 글자 수 어림(개조식 보고, 표 포함) — 분량을 짐작하는 데만 쓴다 */
const CHARS_PER_PAGE = 1_100;
/** 카드에 싣는 장·절 줄 수 */
const OUTLINE_MAX = 18;

/** 장(Ⅰ.)·절(1.)·□ 소제목·참고 머리 — 카드의 짜임 줄 */
const OUTLINE = /^\s*(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\s*[.．]|\d{1,2}\s*[.．](?!\d)\s*[^\d\s]|□|<?\s*참고\s*\d|붙임\s*\d?)/;

export interface ExampleCard {
  /** 글 파일 이름(글/ 아래) */
  id: string;
  source: string;
  /** 파일 이름에서 날짜·★(최종) 같은 꾸밈을 뗀 이름 — 문서 첫 줄(표지 글자)보다 무엇인지 잘 드러난다 */
  name: string;
  title: string;
  chars: number;
  pagesApprox: number;
  tables: number | null;
  outline: string[];
}

export function examplesDir(dataDir: string): string {
  return join(dataDir, "report-examples");
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ((EXAMPLE_EXTENSIONS as readonly string[]).includes(extname(n).toLowerCase())) out.push(p);
  }
  return out;
}

/** 표 수 — hwpx 만 센다(다른 형식은 글로 뽑으면 표 경계가 사라진다) */
function tableCount(file: string): number | null {
  if (extname(file).toLowerCase() !== ".hwpx") return null;
  try {
    const entries = unzipSync(new Uint8Array(readFileSync(file)));
    let n = 0;
    for (const [name, data] of Object.entries(entries)) {
      if (!/^Contents\/section\d+\.xml$/.test(name)) continue;
      n += (Buffer.from(data).toString("utf8").match(/<hp:tbl\b/g) ?? []).length;
    }
    return n;
  } catch {
    return null;
  }
}

export function cardFromText(id: string, source: string, text: string, tables: number | null): ExampleCard {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const title = lines.find((l) => l.length >= 4 && !/^\d+$/.test(l)) ?? basename(source);
  const chars = text.replace(/\s+/g, "").length;
  const outline: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!OUTLINE.test(l) || l.length > 60) continue;
    // 목차 줄 끝의 쪽번호를 떼고, 목차와 본문에 같은 줄이 두 번 나오면 한 번만
    const line = l.replace(/[\s.．·…]*\d+$/, "").trim();
    const key = line.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    outline.push(line);
    if (outline.length >= OUTLINE_MAX) break;
  }
  return { id, source, name: cleanName(source), title: title.slice(0, 80), chars, pagesApprox: Math.max(1, Math.round(chars / CHARS_PER_PAGE)), tables, outline };
}

export function cleanName(source: string): string {
  // 시스템 참고본(templates/report/reference.hwpx) — 파일 이름이 "reference" 라 무엇인지 드러나지 않는다
  if (/^기본__reference\.hwpx$/.test(basename(source))) return "주요업무보고(시스템 참고본 — 2025년 추진성과·2026년 주요사업)";
  return basename(source)
    .replace(/^기본__/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[★☆]?\(최종\)/g, "")
    .replace(/^[★☆]+/, "")
    .replace(/^\s*(?:참고_)?(?:\(\s*\d{1,2}\.\s*\d{1,2}\.\s*\)|\d{6}|\d{4}\.\d{2}\.\d{2}_?|\d{1,2}\.\s*\d{1,2}\.\(.\)|\d{2}\.)\s*/, "")
    .replace(/^참고_/, "")
    .replace(/\s*\(\d+\)$/, "") // 내려받기 사본 꼬리 " (1)"
    .trim();
}

function textId(rel: string): string {
  return rel.replace(/[\\/]/g, "__").replace(/\.[^.]+$/, "") + ".txt";
}

export interface IndexResult {
  dir: string;
  cards: ExampleCard[];
  extracted: number;
  failed: string[];
  /** 글이 앞 본보기와 똑같아 카드에서 뺀 파일("뺀 것 = 남긴 것") */
  duplicates: string[];
}

/**
 * 원본/ 을 훑어 글을 뽑고 catalog.md 를 다시 쓴다. 원본이 글보다 새것일 때만 다시 뽑는다.
 * builtIn: 늘 들어가는 본보기(참고본) — 원본/ 에 없어도 카드에 오른다.
 */
export function indexExamples(dir: string, builtIn: string[] = []): IndexResult {
  const srcDir = join(dir, "원본");
  const txtDir = join(dir, "글");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(txtDir, { recursive: true });
  const files = [...builtIn.filter((f) => existsSync(f)).map((f) => ({ path: f, rel: `기본__${basename(f)}` })), ...walk(srcDir).map((f) => ({ path: f, rel: relative(srcDir, f) }))];
  const cards: ExampleCard[] = [];
  const failed: string[] = [];
  const duplicates: string[] = [];
  const seenText = new Map<string, string>();
  let extracted = 0;
  for (const { path, rel } of files) {
    const id = textId(rel);
    const txt = join(txtDir, id);
    let text: string;
    if (existsSync(txt) && statSync(txt).mtimeMs >= statSync(path).mtimeMs) {
      text = readFileSync(txt, "utf8");
    } else {
      try {
        text = extractReferenceText(basename(path), new Uint8Array(readFileSync(path))).text;
      } catch (e) {
        failed.push(`${rel}: ${(e as Error).message.slice(0, 80)}`);
        continue;
      }
      if (text.replace(/\s+/g, "").length < 50) {
        failed.push(`${rel}: 글이 거의 없다(스캔 PDF?)`);
        continue;
      }
      writeFileSync(txt, text);
      extracted++;
    }
    // 글이 똑같은 파일(이름만 다른 사본)은 카드 한 장 — 같은 본보기가 두 번 뽑히지 않게
    const key = text.replace(/\s+/g, "");
    const first = seenText.get(key);
    if (first) {
      duplicates.push(`${rel} = ${first}`);
      continue;
    }
    seenText.set(key, rel);
    cards.push(cardFromText(id, rel, text, tableCount(path)));
  }
  writeFileSync(join(dir, "catalog.md"), catalogMarkdown(cards));
  return { dir, cards, extracted, failed, duplicates };
}

export function catalogMarkdown(cards: ExampleCard[]): string {
  const head = `# 업무보고 본보기 카드 (${cards.length}건)

진흥원 실제 보고서다(이름에 「행정안전부」처럼 다른 기관이 적힌 것은 중앙부처 업무보고 — 상급기관·정부 보고 형식의 본보기). 쓰려는 보고와 **대상(내부 결재·도지사·도의회·행정사무감사 등)·성격(계획·추진·결과·현황)·분량**이
가장 가까운 것을 2~3건 고르고, 고른 것의 글을 \`글/<파일>\` 에서 Read 한다. 분량은 글자 수로 어림한 값이다.
`;
  const body = cards.map(
    (c, i) =>
      `## ${i + 1}. ${c.name}\n- 첫 줄: ${c.title}\n- 글: 글/${c.id}\n- 원본: ${c.source}\n- 분량: 약 ${c.pagesApprox}쪽(${c.chars.toLocaleString("ko-KR")}자)${c.tables !== null ? ` · 표 ${c.tables}개` : ""}\n${c.outline.length ? `- 짜임:\n${c.outline.map((l) => `  - ${l}`).join("\n")}` : "- 짜임: (장·절 줄 없음 — 짧은 개조식)"}`,
  );
  return [head, ...body].join("\n\n") + "\n";
}

// ---- 본보기 문장 옮겨 쓰기 -----------------------------------------------------------------------

/** 이보다 짧은 줄은 우연히 같을 수 있다("만족도 조사 실시") */
const MIN_COPY_CHARS = 20;
const LEAD = /^\s*(?:#+|[□ㅇ○●❍\-·※◇]|\d+\)|[가-하]\.)\s*/;

function norm(s: string): string {
  return s.replace(/\*\*/g, "").replace(/[\s.,·:;'"‘’“”()（）「」『』\-–—~]/g, "");
}

/**
 * 원고 줄이 본보기 글에 그대로 있으면 경고 — 본보기는 짜임·분량·어투만 따르고 내용(수치·사업명·문장)은 이번 자료에서
 * 가져와야 한다(담당자 2026-11-18). 표 줄·코드 블록·front-matter 는 보지 않는다.
 */
export function exampleCopyWarnings(dsl: string, exampleTexts: string[]): string[] {
  if (!exampleTexts.length) return [];
  const corpus = norm(exampleTexts.join("\n"));
  const out: string[] = [];
  let fm = false;
  dsl.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === "---") {
      fm = !fm;
      return;
    }
    if (fm || /^\s*(\||\{|```|<)/.test(raw)) return;
    const body = raw.replace(LEAD, "").trim();
    const key = norm(body);
    if (key.length >= MIN_COPY_CHARS && corpus.includes(key))
      out.push(`[본보기 문장] ${i + 1}행 "${body.slice(0, 30)}…" — 본보기 보고서와 같은 문장이다. 본보기는 짜임·분량·어투만 따르고, 내용은 이번 지시·자료의 사실로 다시 쓴다`);
  });
  return out;
}

/** 글/ 아래 모든 본보기 글 */
export function exampleTexts(dir: string): string[] {
  const txtDir = join(dir, "글");
  if (!existsSync(txtDir)) return [];
  return readdirSync(txtDir)
    .filter((n) => n.endsWith(".txt"))
    .map((n) => readFileSync(join(txtDir, n), "utf8"));
}
