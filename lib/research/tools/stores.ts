/**
 * 소상공인시장진흥공단 상가(상권)정보 (data.go.kr 15012005, base …/B553077/api/open/sdsc2).
 * The research stage needs counts, not rows: `storeStats` asks for one row and reads
 * `totalCount` for a 시군구 (or 행정동) × 업종 filter. Business-type codes come from
 * `storeUpjongCodes` (대/중/소분류).
 */
import { callableDataGoKrServices } from "../dataSources";
import { buildUrl, dataGoKrEnvelopeError, getText, num, redactUrl, str, type Env, type Fetcher, type ToolResult } from "./http";

const SERVICE_ID = "15012005";
const BASE = "http://apis.data.go.kr/B553077/api/open/sdsc2/";
const SOURCE_NAME = "소상공인시장진흥공단_상가(상권)정보 (data.go.kr 15012005)";

export interface StoreStatsParams {
  /** 행정구역 코드: 시도 2자리(47) / 시군구 5자리(47290 경산시) / 행정동 8~10자리 */
  areaCode: string;
  /** 상권업종 대분류 (예: I2 음식, G2 소매, S2 수리·개인) */
  indsLclsCd?: string;
  /** 상권업종 중분류 (예: I201 한식) */
  indsMclsCd?: string;
  /** 상권업종 소분류 */
  indsSclsCd?: string;
}

function divIdFor(code: string): "ctprvnCd" | "signguCd" | "adongCd" | null {
  if (/^\d{2}$/.test(code)) return "ctprvnCd";
  if (/^\d{5}$/.test(code)) return "signguCd";
  if (/^\d{8,10}$/.test(code)) return "adongCd";
  return null;
}

function gate(env: Env): ToolResult<never> | null {
  if (!env.DATA_GO_KR_KEY) return { ok: false, error: "data.go.kr 인증키가 설정되지 않았습니다 (DATA_GO_KR_KEY)", hint: "이 도구는 사용할 수 없습니다." };
  if (!callableDataGoKrServices(env).some((s) => s.id === SERVICE_ID)) return { ok: false, error: `상가(상권)정보 API(${SERVICE_ID}) 가 DATA_GO_KR_SERVICES 에 없습니다`, hint: "다른 출처를 쓰세요." };
  return null;
}

interface SdscResponse {
  header?: { resultCode?: string; resultMsg?: string; description?: string; columns?: string[] };
  body?: { items?: Record<string, unknown>[]; totalCount?: number | string; numOfRows?: number | string };
}

async function callJson(fetchImpl: Fetcher, url: string): Promise<{ doc: SdscResponse } | { error: string; hint?: string }> {
  const { text } = await getText(fetchImpl, url);
  const envelope = dataGoKrEnvelopeError(text);
  if (envelope) return { error: envelope.error, hint: envelope.hint };
  try {
    return { doc: JSON.parse(text) as SdscResponse };
  } catch {
    return { error: `상가정보 API 응답을 해석할 수 없습니다: ${text.slice(0, 120)}` };
  }
}

export async function storeStats(p: StoreStatsParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ 지역코드: string; 지역명: string; 업종: string; 점포수: number; 기준일자?: string; 예시: string[] }>> {
  const g = gate(env);
  if (g) return g;
  const divId = divIdFor(p.areaCode);
  if (!divId) return { ok: false, error: "areaCode 는 시도 2자리·시군구 5자리·행정동 8~10자리 코드여야 합니다 (경상북도 47, 경산시 47290)" };
  const url = buildUrl(BASE + "storeListInDong", {
    serviceKey: env.DATA_GO_KR_KEY,
    divId,
    key: p.areaCode,
    indsLclsCd: p.indsLclsCd,
    indsMclsCd: p.indsMclsCd,
    indsSclsCd: p.indsSclsCd,
    numOfRows: 3,
    pageNo: 1,
    type: "json",
  });
  const source = { 기관: "소상공인시장진흥공단", 서비스: SOURCE_NAME, url: redactUrl(url) };
  const r = await callJson(fetchImpl, url);
  if ("error" in r) return { ok: false, error: r.error, hint: r.hint, source };
  const code = str(r.doc.header?.resultCode);
  if (code !== "00") return { ok: false, error: `상가정보 API ${code}: ${str(r.doc.header?.resultMsg)}`, source };
  const items = r.doc.body?.items ?? [];
  const first = items[0] ?? {};
  const 지역명 = [str(first.ctprvnNm), str(first.signguNm), divId === "adongCd" ? str(first.adongNm) : ""].filter(Boolean).join(" ");
  const 업종 = [p.indsLclsCd && `${p.indsLclsCd} ${str(first.indsLclsNm)}`, p.indsMclsCd && `${p.indsMclsCd} ${str(first.indsMclsNm)}`, p.indsSclsCd && `${p.indsSclsCd} ${str(first.indsSclsNm)}`].filter(Boolean).join(" > ") || "전체";
  const 기준일자 = str(first.stdrYm) || undefined;
  return {
    ok: true,
    source: { ...source, 기준시점: 기준일자 ? `${기준일자} 기준 상가업소 DB` : "상가업소 DB(분기 갱신)" },
    data: { 지역코드: p.areaCode, 지역명, 업종, 점포수: num(r.doc.body?.totalCount) ?? 0, 기준일자, 예시: items.slice(0, 3).map((it) => str(it.bizesNm)) },
    note: "점포수는 상가업소 DB의 등록 업소 수(국세청·카드사 기반)로, 사업자 수와는 다를 수 있음",
  };
}

export interface UpjongParams {
  level: "large" | "middle" | "small";
  /** middle: 대분류 코드 필수, small: 중분류 코드 필수 */
  parent?: string;
}

export async function storeUpjongCodes(p: UpjongParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ codes: Array<{ code: string; name: string; parent?: string }> }>> {
  const g = gate(env);
  if (g) return g;
  const op = p.level === "large" ? "largeUpjongList" : p.level === "middle" ? "middleUpjongList" : "smallUpjongList";
  if (p.level !== "large" && !p.parent) return { ok: false, error: `${p.level} 조회에는 parent(상위 분류 코드)가 필요합니다` };
  const url = buildUrl(BASE + op, { serviceKey: env.DATA_GO_KR_KEY, type: "json", ...(p.level === "middle" ? { indsLclsCd: p.parent } : {}), ...(p.level === "small" ? { indsMclsCd: p.parent } : {}) });
  const source = { 기관: "소상공인시장진흥공단", 서비스: SOURCE_NAME, url: redactUrl(url) };
  const r = await callJson(fetchImpl, url);
  if ("error" in r) return { ok: false, error: r.error, hint: r.hint, source };
  const items = r.doc.body?.items ?? [];
  const codes = items.map((it) => {
    if (p.level === "large") return { code: str(it.indsLclsCd), name: str(it.indsLclsNm) };
    if (p.level === "middle") return { code: str(it.indsMclsCd), name: str(it.indsMclsNm), parent: str(it.indsLclsCd) };
    return { code: str(it.indsSclsCd), name: str(it.indsSclsNm), parent: str(it.indsMclsCd) };
  });
  return { ok: true, source, data: { codes } };
}
