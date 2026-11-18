/**
 * 같은 일의 이전 프로젝트 — 업무보고를 쓸 때 시스템 안에 이미 있는 계획안·공문·과업지시서를 찾아 준다.
 *
 * 담당자 2026-11-18: 「2027년 주요사업 안내책자 제작 현황 보고」를 자동으로 돌렸더니 예산·업체·규모가 온통
 * [확인필요] 였다. 그런데 11-09 에 만든 「2027년 주요사업 안내책자 제작」 계획안 프로젝트에 소요예산·계약업체·
 * 과업지시서가 다 있었다 — 업무보고 에이전트는 위키만 보고 다른 프로젝트를 보지 못했다.
 *
 * 제목·지시에서 뽑은 낱말이 겹치는 정도로 고른다. 연도·「보고·계획·현황」처럼 어디에나 붙는 낱말은 세지 않는다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** 어느 문서에나 붙어 같은 일인지 가려 주지 못하는 낱말 */
const STOP = new Set([
  "보고", "업무보고", "주요업무보고", "계획", "계획안", "현황", "결과", "결과보고", "추진", "추진계획", "운영", "운영계획",
  "주요", "관련", "작성", "자료", "검토", "진흥원", "경제진흥원", "경상북도경제진흥원", "경북경제진흥원", "경상북도", "경북",
  "자동", "시험", "변경", "최종", "수정", "보고서", "제출", "요청", "안내", "사업", "위해", "위한", "우리", "모두", "이거", "현재", "향후",
]);

const MAX_RELATED = 4;
const MIN_SCORE = 4;
/** 지시(topic)는 앞부분만 본다 — 긴 붙여넣기의 낱말이 우연히 겹치는 것을 막는다 */
const TOPIC_HEAD = 300;

export interface ProjectMeta {
  id: string;
  kind: string;
  title: string;
  topic: string;
  createdAt?: string;
}

export interface RelatedProject extends ProjectMeta {
  dir: string;
  score: number;
  shared: string[];
  /** 읽을 만한 파일(프로젝트 폴더 기준 상대 경로): project.json, 단계별 draft.dsl.md, 참고 문서 글 */
  files: string[];
}

export function words(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.split(/[^0-9A-Za-z가-힣]+/)) {
    const w = raw.replace(/^\d{2,4}년(도)?/, "").replace(/(을|를|이|가|은|는|의|에|와|과|로|으로|에서|까지|하는|하고|중인데)$/, "");
    if (w.length < 2 || /^\d+$/.test(w) || STOP.has(w)) continue;
    out.add(w);
  }
  return out;
}

function readMeta(dir: string): ProjectMeta | null {
  try {
    const p = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as Partial<ProjectMeta>;
    if (!p.id || !p.title) return null;
    return { id: p.id, kind: p.kind ?? "", title: p.title, topic: p.topic ?? "", createdAt: p.createdAt };
  } catch {
    return null;
  }
}

/** 프로젝트 폴더에서 에이전트가 읽을 파일 — 그림·hwpx·실행 기록은 뺀다 */
function readableFiles(dir: string): string[] {
  const out: string[] = ["project.json"];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n.startsWith(".") || !statSync(p).isDirectory()) continue;
    for (const f of ["draft.dsl.md", "base-plan.md", "notes.md"]) if (existsSync(join(p, f))) out.push(relative(dir, join(p, f)));
    const ex = join(p, ".extracted");
    if (existsSync(ex)) for (const f of readdirSync(ex)) if (f.endsWith(".txt")) out.push(relative(dir, join(ex, f)));
    // 결과·정산 자료함의 글(materials/*.txt)
    if (n === "materials") for (const f of readdirSync(p)) if (f.endsWith(".txt") || f.endsWith(".md")) out.push(relative(dir, join(p, f)));
  }
  return out.map((f) => f.replace(/\\/g, "/"));
}

/**
 * self 와 같은 일로 보이는 프로젝트. 제목 낱말 겹침은 2점, 지시 앞부분 낱말 겹침은 1점 — 4점 이상(제목 낱말 둘 이상 겹치는 정도)만.
 * 제목·지시가 똑같은 사본(같은 지시로 여러 번 만든 프로젝트)은 파일이 가장 많은 하나만 남긴다.
 */
export function relatedProjects(self: ProjectMeta, projectsRoot: string): RelatedProject[] {
  if (!existsSync(projectsRoot)) return [];
  const selfTitle = words(self.title);
  const selfAll = new Set([...selfTitle, ...words(self.topic.slice(0, TOPIC_HEAD))]);
  const best = new Map<string, RelatedProject>();
  for (const id of readdirSync(projectsRoot)) {
    if (id === self.id) continue;
    const dir = join(projectsRoot, id);
    if (!statSync(dir).isDirectory()) continue;
    const m = readMeta(dir);
    if (!m) continue;
    const title = words(m.title);
    const all = new Set([...title, ...words(m.topic.slice(0, TOPIC_HEAD))]);
    const sharedTitle = [...title].filter((w) => selfTitle.has(w));
    // 지시 낱말은 세 글자 이상만 — 「우리」「위한」 같은 두 글자 말이 우연히 겹친다
    const sharedAny = [...all].filter((w) => w.length >= 3 && selfAll.has(w) && !sharedTitle.includes(w));
    const score = sharedTitle.length * 2 + sharedAny.length;
    if (score < MIN_SCORE || sharedTitle.length === 0) continue;
    const files = readableFiles(dir);
    const key = `${m.title.trim()}\n${m.topic.trim()}`;
    const prev = best.get(key);
    if (prev && prev.files.length >= files.length) continue;
    best.set(key, { ...m, dir, score, shared: [...sharedTitle, ...sharedAny], files });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, MAX_RELATED);
}
