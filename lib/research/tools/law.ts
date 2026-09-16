/**
 * 법제처 국가법령정보 공동활용 (open.law.go.kr; OC = registered e-mail id).
 *   lawSearch — DRF/lawSearch.do  target=law (법령) | ordin (자치법규)
 *   lawText   — DRF/lawService.do full text → 기본정보 + 조문 목록 (optionally one 조)
 * Shapes verified 2026-09-16: 법령 = {법령:{기본정보, 조문:{조문단위:[{조문번호, 조문제목, 조문내용, 항:[…]}]}}},
 * 자치법규 = {LawService:{자치법규기본정보, 조문:{조:[{조문번호:[…], 조제목, 조내용}]}}}.
 */
import { asArray, buildUrl, getText, notConfigured, redactUrl, str, type Env, type Fetcher, type ToolResult } from "./http";

const SEARCH = "https://www.law.go.kr/DRF/lawSearch.do";
const SERVICE = "https://www.law.go.kr/DRF/lawService.do";

export type LawTarget = "law" | "ordin";

export interface LawSearchParams {
  query: string;
  target: LawTarget;
  /** 자치법규: 지자체명으로 거르기 (예: 경상북도, 안동시) */
  region?: string;
  limit?: number;
}

export interface LawHit {
  target: LawTarget;
  이름: string;
  MST: string;
  ID: string;
  종류: string;
  소관: string;
  시행일자: string;
  공포일자: string;
  링크: string;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function lawSearch(p: LawSearchParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ hits: LawHit[]; total: number }>> {
  if (!env.LAW_OC) return notConfigured("법제처", "LAW_OC");
  if (!p.query.trim()) return { ok: false, error: "query 가 비어 있습니다" };
  const limit = Math.min(Math.max(1, p.limit ?? 10), 50);
  // results come back in name order nationwide, so a 지자체 must be part of the query, not only a post-filter
  const query = p.region && !p.query.includes(p.region) ? `${p.region} ${p.query.trim()}` : p.query.trim();
  const url = buildUrl(SEARCH, { OC: env.LAW_OC, target: p.target, type: "JSON", query, display: 100 });
  const source = { 기관: "법제처 국가법령정보센터", 서비스: `국가법령정보 공동활용 검색 (${p.target === "law" ? "법령" : "자치법규"})`, url: redactUrl(url) };
  const { text } = await getText(fetchImpl, url);
  const doc = parseJson(text);
  if (!doc) return { ok: false, error: `법제처 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`, source, hint: "OC(이메일 id)가 승인되지 않았을 수 있습니다." };
  const root = (doc.LawSearch ?? doc.OrdinSearch ?? {}) as Record<string, unknown>;
  const raw = asArray(root.law as Record<string, unknown> | Record<string, unknown>[] | undefined);
  let hits: LawHit[] = raw.map((r) =>
    p.target === "law"
      ? { target: p.target, 이름: str(r.법령명한글), MST: str(r.법령일련번호), ID: str(r.법령ID), 종류: str(r.법령구분명), 소관: str(r.소관부처명), 시행일자: str(r.시행일자), 공포일자: str(r.공포일자), 링크: `https://www.law.go.kr${str(r.법령상세링크)}`.replace(/OC=[^&]*/, "OC=***") }
      : { target: p.target, 이름: str(r.자치법규명), MST: str(r.자치법규일련번호), ID: str(r.자치법규ID), 종류: str(r.자치법규종류), 소관: str(r.지자체기관명), 시행일자: str(r.시행일자), 공포일자: str(r.공포일자), 링크: `https://www.law.go.kr${str(r.자치법규상세링크)}`.replace(/OC=[^&]*/, "OC=***") },
  );
  if (p.region) hits = hits.filter((h) => h.소관.includes(p.region!));
  const total = Number(str(root.totalCnt)) || hits.length;
  return { ok: true, source, data: { hits: hits.slice(0, limit), total }, note: "본문은 law_text(target, MST) 로 조회" };
}

export interface LawTextParams {
  target: LawTarget;
  /** 검색 결과의 MST (법령일련번호 / 자치법규일련번호) */
  MST: string;
  /** 특정 조만: "3" 또는 "제3조" */
  article?: string;
  /** 조문 최대 수 (기본 40) */
  limit?: number;
}

export interface LawArticle {
  조: string;
  제목: string;
  내용: string;
}

export interface LawTextData {
  이름: string;
  종류: string;
  소관: string;
  시행일자: string;
  공포일자: string;
  조문: LawArticle[];
  조문수: number;
}

/** 기본정보 fields such as 소관부처/법종구분 arrive as objects ({소관부처명, 소관부처코드}); take the name. */
function nameOf(v: unknown, nameKey: string): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return str(o.content ?? o[nameKey]);
  }
  return str(v);
}

function articleNo(v: unknown): string {
  const s = Array.isArray(v) ? str(v[0]) : str(v);
  // 자치법규 조문번호 is 6 digits: 조 4 + 가지 2 ("000300" → 3, "000302" → 3의2); 법령 gives "3"
  if (/^\d{6}$/.test(s)) {
    const main = Number(s.slice(0, 4));
    const branch = Number(s.slice(4));
    return branch ? `${main}의${branch}` : String(main);
  }
  return s;
}

export async function lawText(p: LawTextParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<LawTextData>> {
  if (!env.LAW_OC) return notConfigured("법제처", "LAW_OC");
  if (!p.MST) return { ok: false, error: "MST 가 필요합니다 (law_search 결과)" };
  const url = buildUrl(SERVICE, { OC: env.LAW_OC, target: p.target, MST: p.MST, type: "JSON" });
  const source = { 기관: "법제처 국가법령정보센터", 서비스: `국가법령정보 공동활용 본문 (${p.target === "law" ? "법령" : "자치법규"} MST ${p.MST})`, url: redactUrl(url) };
  const { text } = await getText(fetchImpl, url);
  const doc = parseJson(text);
  if (!doc) return { ok: false, error: `법제처 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`, source };
  let head: Record<string, unknown>;
  let articles: LawArticle[];
  if (p.target === "law") {
    const law = (doc.법령 ?? {}) as Record<string, unknown>;
    head = (law.기본정보 ?? {}) as Record<string, unknown>;
    const units = asArray(((law.조문 as Record<string, unknown> | undefined)?.조문단위 ?? []) as Record<string, unknown> | Record<string, unknown>[]);
    articles = units
      .filter((u) => str(u.조문여부) === "조문")
      .map((u) => {
        const 항 = asArray(u.항 as Record<string, unknown> | Record<string, unknown>[] | undefined).map((h) => str(h.항내용)).filter(Boolean);
        const body = 항.length ? 항.join("\n") : str(u.조문내용);
        return { 조: articleNo(u.조문번호), 제목: str(u.조문제목), 내용: body };
      });
  } else {
    const svc = (doc.LawService ?? {}) as Record<string, unknown>;
    head = (svc.자치법규기본정보 ?? {}) as Record<string, unknown>;
    const units = asArray(((svc.조문 as Record<string, unknown> | undefined)?.조 ?? []) as Record<string, unknown> | Record<string, unknown>[]);
    articles = units.filter((u) => str(u.조문여부) !== "N").map((u) => ({ 조: articleNo(u.조문번호), 제목: str(u.조제목), 내용: str(u.조내용) }));
  }
  if (p.article) {
    const want = p.article.replace(/^제/, "").replace(/조$/, "").trim();
    articles = articles.filter((a) => a.조 === want);
    if (!articles.length) return { ok: false, error: `제${want}조 를 찾지 못했습니다`, source };
  }
  const limit = Math.min(Math.max(1, p.limit ?? 40), 200);
  const data: LawTextData = {
    이름: str(head.법령명_한글 ?? head.자치법규명),
    종류: (p.target === "law" ? nameOf(head.법종구분, "법종구분명") : str(head.자치법규종류)) || (p.target === "law" ? "법령" : "자치법규"),
    소관: p.target === "law" ? nameOf(head.소관부처, "소관부처명") : str(head.지자체기관명),
    시행일자: str(head.시행일자),
    공포일자: str(head.공포일자),
    조문: articles.slice(0, limit),
    조문수: articles.length,
  };
  return { ok: true, source: { ...source, 기준시점: `시행 ${data.시행일자}` }, data, note: articles.length > limit ? `조문 ${articles.length}개 중 ${limit}개만 반환. article 로 특정 조를 지정하세요.` : undefined };
}
