/**
 * 한국은행 경제통계시스템(ECOS, ecos.bok.or.kr/api; 키는 URL 경로에 들어간다 = ECOS_KEY).
 *   ecosSearch — 통계표 목록(StatisticTableList, 약 850개)과 100대 통계지표(KeyStatisticList)에서 이름으로 찾기
 *   ecosItems  — 한 통계표의 항목 코드·주기·수록 기간(StatisticItemList)
 *   ecosSeries — 시계열 값(StatisticSearch)
 * 응답 모양 확인 2026-11-10: 정상은 {<서비스명>:{list_total_count,row:[…]}}, 오류는 {RESULT:{CODE,MESSAGE}}
 * (INFO-100 인증키 오류, INFO-200 데이터 없음, ERROR-xxx 요청 오류).
 */
import { getText, num, str, type Env, type Fetcher, type ToolResult } from "./http";

const BASE = "https://ecos.bok.or.kr/api";
const ORG = "한국은행 경제통계시스템(ECOS)";

function ecosUrl(env: Env, service: string, from: number, to: number, ...rest: string[]): string {
  const parts = [BASE, service, encodeURIComponent(env.ECOS_KEY ?? ""), "json", "kr", String(from), String(to), ...rest.filter((s) => s !== undefined && s !== "").map(encodeURIComponent)];
  return parts.join("/");
}

/** 키는 경로에 있으므로 KEY_PARAMS 로는 가려지지 않는다 */
function redact(url: string, env: Env): string {
  const k = encodeURIComponent(env.ECOS_KEY ?? "");
  return k ? url.replace(`/${k}/`, "/***/") : url;
}

type Rows = Record<string, unknown>[];

async function call(env: Env, fetchImpl: Fetcher, service: string, url: string): Promise<{ rows: Rows; total: number } | { error: string; hint: string }> {
  const { text } = await getText(fetchImpl, url);
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: `ECOS 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`, hint: "잠시 후 다시 시도하세요." };
  }
  const res = doc.RESULT as Record<string, unknown> | undefined;
  if (res) {
    const code = str(res.CODE);
    const msg = str(res.MESSAGE);
    if (code === "INFO-200") return { error: `ECOS: 해당하는 데이터가 없습니다`, hint: "기간·주기(cycle)·항목 코드를 ecos_items 로 다시 확인하세요(수록 기간 밖이면 비어 있다)." };
    if (code === "INFO-100") return { error: `ECOS: 인증키 오류 (${msg})`, hint: "이 도구는 건너뛰고 다른 출처를 쓰세요." };
    return { error: `ECOS ${code} (${msg})`, hint: "통계표 코드·주기·기간 형식(연 YYYY, 분기 YYYYQn, 월 YYYYMM, 일 YYYYMMDD)을 확인하세요." };
  }
  const body = (doc[service] ?? {}) as Record<string, unknown>;
  const rows = (Array.isArray(body.row) ? body.row : []) as Rows;
  return { rows, total: Number(body.list_total_count) || rows.length };
}

let tableCache: Rows | null = null;
export function clearEcosCache(): void {
  tableCache = null;
}

export interface EcosSearchParams {
  /** 통계표·지표 이름에 들어가는 낱말. 여러 낱말은 공백으로 — 모두 들어간 것만 */
  keyword: string;
  limit?: number;
}

export interface EcosSearchData {
  통계표: { 통계표코드: string; 이름: string; 주기: string; 상위코드: string }[];
  핵심지표: { 이름: string; 분류: string; 값: number | null; 단위: string; 시점: string }[];
}

export async function ecosSearch(p: EcosSearchParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<EcosSearchData>> {
  if (!env.ECOS_KEY) return { ok: false, error: "ECOS 키가 설정되지 않았습니다 (ECOS_KEY)", hint: "이 도구는 사용할 수 없습니다. 웹검색 등 다른 출처를 쓰세요." };
  const words = p.keyword.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { ok: false, error: "keyword 가 비어 있습니다" };
  const limit = Math.min(Math.max(1, p.limit ?? 20), 100);
  const tUrl = ecosUrl(env, "StatisticTableList", 1, 2000);
  const source = { 기관: ORG, 서비스: "ECOS 통계표 목록·100대 통계지표", url: redact(tUrl, env) };
  if (!tableCache) {
    const t = await call(env, fetchImpl, "StatisticTableList", tUrl);
    if ("error" in t) return { ok: false, error: t.error, hint: t.hint, source };
    tableCache = t.rows;
  }
  const hit = (name: string) => words.every((w) => name.includes(w));
  // 조회 가능(SRCH_YN=Y)한 통계표만 — N 은 목차 줄이다
  const tables = tableCache
    .filter((r) => str(r.SRCH_YN) === "Y" && hit(str(r.STAT_NAME)))
    .slice(0, limit)
    .map((r) => ({ 통계표코드: str(r.STAT_CODE), 이름: str(r.STAT_NAME), 주기: str(r.CYCLE), 상위코드: str(r.P_STAT_CODE) }));
  const k = await call(env, fetchImpl, "KeyStatisticList", ecosUrl(env, "KeyStatisticList", 1, 200));
  const keys = "error" in k ? [] : k.rows.filter((r) => hit(`${str(r.CLASS_NAME)} ${str(r.KEYSTAT_NAME)}`)).map((r) => ({ 이름: str(r.KEYSTAT_NAME), 분류: str(r.CLASS_NAME), 값: num(r.DATA_VALUE), 단위: str(r.UNIT_NAME), 시점: str(r.CYCLE) }));
  if (!tables.length && !keys.length) return { ok: false, error: `ECOS 에 "${p.keyword}" 가 들어간 통계표가 없습니다`, hint: "낱말을 줄이거나 바꿔 보세요(예: '기준금리', '소비자물가', '지역내총생산', '가계대출').", source };
  return { ok: true, source, data: { 통계표: tables, 핵심지표: keys }, note: "핵심지표는 최신값 하나다. 시계열은 ecos_items 로 항목 코드를 본 뒤 ecos_series 로 받는다." };
}

export interface EcosItemsParams {
  statCode: string;
  /** 항목명 일부로 거르기 (예: '경북', '기준금리') */
  nameFilter?: string;
  limit?: number;
}

export interface EcosItem {
  그룹: string;
  항목코드: string;
  항목명: string;
  상위항목: string;
  주기: string;
  시작: string;
  끝: string;
  단위: string;
}

export async function ecosItems(p: EcosItemsParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ 통계표: string; 항목: EcosItem[]; 전체: number }>> {
  if (!env.ECOS_KEY) return { ok: false, error: "ECOS 키가 설정되지 않았습니다 (ECOS_KEY)", hint: "이 도구는 사용할 수 없습니다." };
  if (!p.statCode?.trim()) return { ok: false, error: "statCode 가 필요합니다 — ecos_search 로 찾으세요" };
  const url = ecosUrl(env, "StatisticItemList", 1, 2000, p.statCode.trim());
  const source = { 기관: ORG, 서비스: `ECOS 통계항목 (${p.statCode})`, url: redact(url, env) };
  const r = await call(env, fetchImpl, "StatisticItemList", url);
  if ("error" in r) return { ok: false, error: r.error, hint: r.hint, source };
  let items: EcosItem[] = r.rows.map((x) => ({ 그룹: str(x.GRP_NAME), 항목코드: str(x.ITEM_CODE), 항목명: str(x.ITEM_NAME), 상위항목: str(x.P_ITEM_NAME), 주기: str(x.CYCLE), 시작: str(x.START_TIME), 끝: str(x.END_TIME), 단위: str(x.UNIT_NAME) }));
  if (p.nameFilter) items = items.filter((i) => `${i.항목명} ${i.상위항목}`.includes(p.nameFilter!));
  const limit = Math.min(Math.max(1, p.limit ?? 60), 500);
  return { ok: true, source, data: { 통계표: str(r.rows[0]?.STAT_NAME), 항목: items.slice(0, limit), 전체: items.length }, note: items.length > limit ? `${items.length}개 중 ${limit}개. nameFilter 로 좁히세요.` : undefined };
}

export const ECOS_CYCLES = ["A", "S", "Q", "M", "SM", "D"] as const;

export interface EcosSeriesParams {
  statCode: string;
  /** A 연 / S 반년 / Q 분기 / M 월 / SM 반월 / D 일 */
  cycle: (typeof ECOS_CYCLES)[number];
  /** 연 YYYY, 반년 YYYYS1, 분기 YYYYQ1, 월 YYYYMM, 일 YYYYMMDD */
  start: string;
  end: string;
  item1?: string;
  item2?: string;
  item3?: string;
  item4?: string;
  limit?: number;
}

export interface EcosPoint {
  시점: string;
  값: number | null;
  단위: string;
  항목: string;
}

export async function ecosSeries(p: EcosSeriesParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ 통계표: string; 행: EcosPoint[]; 전체: number }>> {
  if (!env.ECOS_KEY) return { ok: false, error: "ECOS 키가 설정되지 않았습니다 (ECOS_KEY)", hint: "이 도구는 사용할 수 없습니다." };
  const limit = Math.min(Math.max(1, p.limit ?? 200), 2000);
  // 뒤쪽 항목 코드가 비면 경로에서 빼야 한다 — 빈 칸을 남기면 ECOS 가 요청 오류를 낸다
  const items = [p.item1, p.item2, p.item3, p.item4].map((s) => s?.trim() ?? "");
  while (items.length && !items[items.length - 1]) items.pop();
  if (items.some((s) => !s)) return { ok: false, error: "항목 코드는 item1 부터 차례로 채워야 합니다(중간을 비울 수 없다)", hint: "ecos_items 의 그룹 순서대로 item1, item2 … 를 주세요." };
  const url = ecosUrl(env, "StatisticSearch", 1, limit, p.statCode.trim(), p.cycle, p.start.trim(), p.end.trim(), ...items);
  const source = { 기관: ORG, 서비스: `ECOS 통계 조회 (${p.statCode}, ${p.cycle})`, url: redact(url, env) };
  const r = await call(env, fetchImpl, "StatisticSearch", url);
  if ("error" in r) return { ok: false, error: r.error, hint: r.hint, source };
  const rows: EcosPoint[] = r.rows.map((x) => ({
    시점: str(x.TIME),
    값: num(x.DATA_VALUE),
    단위: str(x.UNIT_NAME),
    항목: [x.ITEM_NAME1, x.ITEM_NAME2, x.ITEM_NAME3, x.ITEM_NAME4].map(str).filter(Boolean).join(" / "),
  }));
  const last = rows[rows.length - 1];
  return { ok: true, source: { ...source, 기준시점: last ? last.시점 : undefined }, data: { 통계표: str(r.rows[0]?.STAT_NAME), 행: rows, 전체: r.total }, note: r.total > rows.length ? `전체 ${r.total}건 중 ${rows.length}건. 기간을 좁히거나 limit 을 늘리세요.` : undefined };
}
