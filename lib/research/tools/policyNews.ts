/**
 * 문화체육관광부_정책브리핑_정책뉴스_API (data.go.kr 15095335, korea.kr). XML list of
 * `NewsItem`s for a date window; the tool adds a keyword filter on title/subtitle/body and
 * trims each body to a citable excerpt (the agent fetches `원문URL` when it needs more).
 */
import { callableDataGoKrServices } from "../dataSources";
import { asArray, buildUrl, dataGoKrEnvelopeError, getText, parseXml, redactUrl, str, stripHtml, type Env, type Fetcher, type ToolResult } from "./http";

const SERVICE_ID = "15095335";
const BASE = "http://apis.data.go.kr/1371000/policyNewsService/policyNewsList";

export interface PolicyNewsParams {
  /** YYYYMMDD */
  startDate: string;
  /** YYYYMMDD */
  endDate: string;
  /** 제목·부제·본문에 포함될 단어 (공백으로 여러 개; 모두 포함) */
  keyword?: string;
  /** 최대 반환 건수 (기본 10, 최대 30) */
  limit?: number;
}

export interface PolicyNewsItem {
  제목: string;
  부제: string;
  부처: string;
  승인일: string;
  원문URL: string;
  요약: string;
}

function pick(it: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = it[k];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
}

export async function policyNewsSearch(p: PolicyNewsParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ items: PolicyNewsItem[]; matched: number; fetched: number }>> {
  if (!/^\d{8}$/.test(p.startDate) || !/^\d{8}$/.test(p.endDate)) return { ok: false, error: "startDate/endDate 는 YYYYMMDD" };
  if (!env.DATA_GO_KR_KEY) return { ok: false, error: "data.go.kr 인증키가 설정되지 않았습니다 (DATA_GO_KR_KEY)", hint: "이 도구는 사용할 수 없습니다." };
  if (!callableDataGoKrServices(env).some((s) => s.id === SERVICE_ID)) return { ok: false, error: `정책뉴스 API(${SERVICE_ID}) 가 DATA_GO_KR_SERVICES 에 없습니다`, hint: "다른 출처를 쓰세요." };
  const url = buildUrl(BASE, { serviceKey: env.DATA_GO_KR_KEY, startDate: p.startDate, endDate: p.endDate, numOfRows: 200, pageNo: 1 });
  const source = { 기관: "대한민국 정책브리핑(문화체육관광부)", 서비스: `정책브리핑_정책뉴스_API (data.go.kr ${SERVICE_ID})`, url: redactUrl(url), 기준시점: `${p.startDate}~${p.endDate} 승인 기사` };
  const { text } = await getText(fetchImpl, url);
  const envelope = dataGoKrEnvelopeError(text);
  if (envelope) return { ok: false, error: envelope.error, hint: envelope.hint, source };
  const doc = parseXml(text) as Record<string, unknown>;
  // korea.kr wraps items as response.body.NewsItem[] (older shape: response.body.items.item[])
  const response = (doc.response ?? doc) as Record<string, unknown>;
  const header = (response.header ?? {}) as Record<string, unknown>;
  const code = str(header.resultCode);
  if (code && code !== "0" && code !== "00") return { ok: false, error: `정책뉴스 API ${code}: ${str(header.resultMsg)}`, source };
  const body = (response.body ?? {}) as Record<string, unknown>;
  const raw = asArray((body.NewsItem ?? (body.items as Record<string, unknown> | undefined)?.item ?? []) as Record<string, unknown> | Record<string, unknown>[]);
  const words = (p.keyword ?? "").split(/\s+/).map((w) => w.trim()).filter(Boolean);
  const items: PolicyNewsItem[] = [];
  for (const it of raw) {
    const 제목 = pick(it, "Title", "title");
    const 부제 = pick(it, "SubTitle1", "subTitle1", "SubTitle");
    const 본문 = stripHtml(pick(it, "DataContents", "dataContents", "Contents"));
    const hay = `${제목}\n${부제}\n${본문}`;
    if (words.length && !words.every((w) => hay.includes(w))) continue;
    items.push({
      제목,
      부제,
      부처: pick(it, "MinisterCode", "ministerCode", "Minister"),
      승인일: pick(it, "ApproveDate", "approveDate", "ModifyDate"),
      원문URL: pick(it, "OriginalUrl", "originalUrl", "Url"),
      요약: 본문.slice(0, 400),
    });
  }
  const limit = Math.min(Math.max(1, p.limit ?? 10), 30);
  return { ok: true, source, data: { items: items.slice(0, limit), matched: items.length, fetched: raw.length }, note: "요약은 본문 앞 400자. 인용할 때는 원문URL을 WebFetch로 확인" };
}
