/**
 * 기업마당 지원사업정보 API (bizinfo.go.kr/uss/rss/bizinfoApi.do). Returns the latest
 * 중앙부처·지자체 지원사업 공고 with optional 분야(searchLclasId) and 해시태그 filters; the tool
 * adds a keyword filter over 공고명·요약 so the agent can look for 유사·선행 사업.
 *
 * 분야 코드 (searchLclasId): 01 금융, 02 기술, 03 인력, 04 수출, 05 내수, 06 창업, 07 경영, 09 기타
 */
import { buildUrl, getText, notConfigured, redactUrl, str, stripHtml, type Env, type Fetcher, type ToolResult } from "./http";

const BASE = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";

export const BIZINFO_FIELDS: Record<string, string> = { "01": "금융", "02": "기술", "03": "인력", "04": "수출", "05": "내수", "06": "창업", "07": "경영", "09": "기타" };

export interface BizinfoParams {
  /** 공고명·요약에 포함될 단어 (공백 = AND) */
  keyword?: string;
  /** 분야 코드 01~09 (BIZINFO_FIELDS) */
  field?: string;
  /** 해시태그 (지역명 등, 쉼표 구분) — 예: "경북" */
  hashtags?: string;
  /** API 에서 가져올 최신 공고 수 (기본 200, 최대 500); keyword 는 그 안에서 거름 */
  fetchCount?: number;
  /** 반환 최대 건수 (기본 15) */
  limit?: number;
}

export interface BizinfoItem {
  공고명: string;
  분야: string;
  소관기관: string;
  수행기관: string;
  접수기간: string;
  대상: string;
  요약: string;
  URL: string;
  해시태그: string;
}

export async function bizinfoSearch(p: BizinfoParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ items: BizinfoItem[]; matched: number; fetched: number }>> {
  if (!env.BIZINFO_KEY) return notConfigured("기업마당", "BIZINFO_KEY");
  if (p.field && !BIZINFO_FIELDS[p.field]) return { ok: false, error: `field 는 ${Object.entries(BIZINFO_FIELDS).map(([k, v]) => `${k}=${v}`).join(", ")} 중 하나` };
  const fetchCount = Math.min(Math.max(1, p.fetchCount ?? 200), 500);
  const url = buildUrl(BASE, { crtfcKey: env.BIZINFO_KEY, dataType: "json", searchCnt: fetchCount, searchLclasId: p.field, hashtags: p.hashtags });
  const source = { 기관: "중소벤처기업부 기업마당", 서비스: "기업마당 지원사업정보 API", url: redactUrl(url), 기준시점: "조회 시점의 최신 공고" };
  const { text } = await getText(fetchImpl, url);
  let doc: { jsonArray?: Record<string, unknown>[] };
  try {
    doc = JSON.parse(text) as { jsonArray?: Record<string, unknown>[] };
  } catch {
    return { ok: false, error: `기업마당 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`, source, hint: "인증키(BIZINFO_KEY)가 잘못됐을 수 있습니다." };
  }
  const raw = doc.jsonArray ?? [];
  const words = (p.keyword ?? "").split(/\s+/).map((w) => w.trim()).filter(Boolean);
  const items: BizinfoItem[] = [];
  for (const r of raw) {
    const 공고명 = str(r.pblancNm);
    const 요약 = stripHtml(str(r.bsnsSumryCn));
    const hay = `${공고명}\n${요약}\n${str(r.hashtags)}`;
    if (words.length && !words.every((w) => hay.includes(w))) continue;
    items.push({
      공고명,
      분야: [str(r.pldirSportRealmLclasCodeNm), str(r.pldirSportRealmMlsfcCodeNm)].filter(Boolean).join(" > "),
      소관기관: str(r.jrsdInsttNm),
      수행기관: str(r.excInsttNm),
      접수기간: str(r.reqstBeginEndDe),
      대상: str(r.trgetNm),
      요약: 요약.slice(0, 300),
      URL: str(r.pblancUrl),
      해시태그: str(r.hashtags).slice(0, 120),
    });
  }
  const limit = Math.min(Math.max(1, p.limit ?? 15), 50);
  return { ok: true, source, data: { items: items.slice(0, limit), matched: items.length, fetched: raw.length }, note: "최신 공고 위주(종료된 과거 사업은 포함되지 않을 수 있음). 세부 지원내용·예산은 URL 을 WebFetch 로 확인" };
}
