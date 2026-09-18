/**
 * 행정안전부 통계연보 지역별 주민등록인구 (data.go.kr 15107303, JSON). Year-end 시도 totals —
 * 총인구·남·여·세대 — from 2008 on; the whole table is ~320 rows, so one call fetches it all.
 * The source switched region names from "경북" to "경상북도" (and "계" to "합계"/"전국") in 2024,
 * so both spellings are folded into one canonical name here. 시군 단위는 KOSIS 를 쓴다.
 */
import { callableDataGoKrServices } from "../dataSources";
import { buildUrl, dataGoKrEnvelopeError, getText, num, redactUrl, str, type Env, type Fetcher, type ToolResult } from "./http";

const SERVICE_ID = "15107303";
const URL_BASE = "http://apis.data.go.kr/1741000/RegistrationPopulationByRegion/getRegistrationPopulationByRegion";

const CANONICAL: Record<string, string> = {
  계: "전국", 합계: "전국", 전국: "전국",
  서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시", 인천: "인천광역시", 광주: "광주광역시", 대전: "대전광역시", 울산: "울산광역시",
  세종: "세종특별자치시", 경기: "경기도", 강원: "강원특별자치도", 강원도: "강원특별자치도", 충북: "충청북도", 충남: "충청남도",
  전북: "전북특별자치도", 전라북도: "전북특별자치도", 전남: "전라남도", 경북: "경상북도", 경남: "경상남도", 제주: "제주특별자치도", 제주도: "제주특별자치도",
};

export function canonicalRegion(name: string): string {
  const n = name.trim();
  return CANONICAL[n] ?? n;
}

export interface RegionPopulationParams {
  /** 시도 이름 (경북·경상북도 모두 가능). 생략하면 전 시도 */
  region?: string;
  /** 시작 연도 (기본: 최근 3개년) */
  fromYear?: number;
  toYear?: number;
}

export interface PopulationRow {
  연도: string;
  지역: string;
  총인구: number | null;
  남자: number | null;
  여자: number | null;
  세대수: number | null;
}

interface PopResponse {
  RegistrationPopulationByRegion?: Array<{ head?: Array<Record<string, unknown>>; row?: Array<Record<string, unknown>> }>;
}

export async function regionPopulation(p: RegionPopulationParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ rows: PopulationRow[] }>> {
  if (!env.DATA_GO_KR_KEY) return { ok: false, error: "data.go.kr 인증키가 설정되지 않았습니다 (DATA_GO_KR_KEY)", hint: "이 도구는 사용할 수 없습니다." };
  if (!callableDataGoKrServices(env).some((s) => s.id === SERVICE_ID)) return { ok: false, error: `지역별 주민등록인구 API(${SERVICE_ID}) 가 DATA_GO_KR_SERVICES 에 없습니다`, hint: "KOSIS(kosis_search '주민등록인구')를 쓰세요." };
  const url = buildUrl(URL_BASE, { ServiceKey: env.DATA_GO_KR_KEY, pageNo: 1, numOfRows: 1000, type: "json" });
  const source = { 기관: "행정안전부", 서비스: `행정안전부_통계연보_지역별 주민등록인구 (data.go.kr ${SERVICE_ID})`, url: redactUrl(url) };
  const { text } = await getText(fetchImpl, url);
  const envelope = dataGoKrEnvelopeError(text);
  if (envelope) return { ok: false, error: envelope.error, hint: envelope.hint, source };
  let doc: PopResponse;
  try {
    doc = JSON.parse(text) as PopResponse;
  } catch {
    return { ok: false, error: `주민등록인구 API 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`, source };
  }
  const parts = doc.RegistrationPopulationByRegion ?? [];
  const result = parts.flatMap((x) => x.head ?? []).find((h) => h.RESULT)?.RESULT as { resultCode?: string; resultMsg?: string } | undefined;
  if (result && str(result.resultCode) !== "INFO-0") return { ok: false, error: `주민등록인구 API ${str(result.resultCode)}: ${str(result.resultMsg)}`, source };
  const all = parts.flatMap((x) => x.row ?? []).map((r) => ({
    연도: str(r.wrttimeid),
    지역: canonicalRegion(str(r.regi)),
    총인구: num(r.population_tot),
    남자: num(r.population_man),
    여자: num(r.population_female),
    세대수: num(r.houshol),
  }));
  const years = [...new Set(all.map((r) => Number(r.연도)))].filter(Number.isFinite).sort((a, b) => a - b);
  if (!years.length) return { ok: false, error: `주민등록인구 API 응답에 자료가 없습니다: ${text.slice(0, 120)}`, hint: "KOSIS(kosis_search '주민등록인구')를 쓰세요.", source };
  const last = years[years.length - 1];
  const from = p.fromYear ?? last - 2;
  const to = p.toYear ?? last;
  const want = p.region ? canonicalRegion(p.region) : null;
  const rows = all.filter((r) => Number(r.연도) >= from && Number(r.연도) <= to && (!want || r.지역 === want));
  if (!rows.length) return { ok: false, error: `조건에 맞는 인구 자료가 없습니다 (${want ?? "전체"}, ${from}~${to}; 제공 연도 ${years[0]}~${last})`, hint: "시도 이름을 확인하세요(시군 단위는 KOSIS).", source };
  return { ok: true, source: { ...source, 기준시점: `${from}~${to}년 각 연말 주민등록인구(행정안전부 통계연보)` }, data: { rows } };
}
