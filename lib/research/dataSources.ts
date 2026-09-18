/**
 * Public-data sources for the research stage — what is configured, from `.env.local`.
 *
 *   DATA_GO_KR_KEY        one key per data.go.kr account (Decoding form), shared by every API
 *   DATA_GO_KR_SERVICES   comma-separated data.go.kr service ids the account has 활용신청 for
 *   KOSIS_KEY / LAW_OC / BIZINFO_KEY   the three portals outside data.go.kr
 *
 * The catalog below is the allow-list: a service id in DATA_GO_KR_SERVICES that is not in the
 * catalog is reported as unknown and never called. Endpoints are filled in as each service is
 * wired into the MCP server (the Swagger on data.go.kr shows them only after 활용신청).
 * Selection rationale: docs/research-data-sources.md.
 */

export interface DataGoKrService {
  id: string;
  name: string;
  org: string;
  /** what the research stage uses it for */
  use: string;
  /** developer-account daily quota on data.go.kr */
  dailyLimit: number | null;
  /** REST base URL once known (null until wired) */
  endpoint: string | null;
}

export const DATA_GO_KR_CATALOG: readonly DataGoKrService[] = [
  { id: "15134343", name: "관세청_시군구별 품목별 수출입실적", org: "관세청", use: "시군구 × HS6 품목 × 기간 수출입 실적(수출 사업 현황·통계) — getSigunguPerPrlstPerAcrs(strtYymm, endYymm, sidoCd, HsSgn=6자리 필수)", dailyLimit: 10_000, endpoint: "http://apis.data.go.kr/1220000/sigunguperprlstperacrs" },
  { id: "15101643", name: "관세청_시도별 수출입실적(GW)", org: "관세청", use: "시도 × 기간 수출입 추이 — getSidotradeList(strtYymm, endYymm, sidoCd? 경북=47)", dailyLimit: 10_000, endpoint: "http://apis.data.go.kr/1220000/sidotrade" },
  { id: "15101612", name: "관세청_국가별 수출입실적(GW)", org: "관세청", use: "국가별 수출입(사절단·전시회 대상국 근거)", dailyLimit: 10_000, endpoint: "http://apis.data.go.kr/1220000/nationtrade" },
  { id: "15101609", name: "관세청_품목별 수출입실적(GW)", org: "관세청", use: "품목(HS 2·4·6·10자리) 전 국가 합계 수출입 — getItemtradeList(strtYymm, endYymm, hsSgn)", dailyLimit: 10_000, endpoint: "http://apis.data.go.kr/1220000/Itemtrade" },
  { id: "15100475", name: "관세청_품목별 국가별 수출입실적(GW)", org: "관세청", use: "품목 × 국가 수출입", dailyLimit: 10_000, endpoint: "http://apis.data.go.kr/1220000/nitemtrade" },
  { id: "15095335", name: "문화체육관광부_정책브리핑_정책뉴스_API", org: "문화체육관광부", use: "중앙부처 정책뉴스 검색(정책 근거)", dailyLimit: 1_000, endpoint: "http://apis.data.go.kr/1371000/policyNewsService" },
  { id: "15012005", name: "소상공인시장진흥공단_상가(상권)정보_API", org: "소상공인시장진흥공단", use: "행정동·업종별 상가업소(소상공인 사업 수요 모수)", dailyLimit: 10_000, endpoint: "http://apis.data.go.kr/B553077/api/open/sdsc2" },
  { id: "15012894", name: "전국전통시장표준데이터", org: "행정안전부(표준데이터)", use: "전통시장 수·점포수·개설주기", dailyLimit: 1_000, endpoint: "http://api.data.go.kr/openapi/tn_pubr_public_trdit_mrkt_api" },
  { id: "15087611", name: "한국산업단지공단_공장등록생산정보조회서비스", org: "한국산업단지공단", use: "등록공장 기본정보·업종·생산품(중소기업 사업 대상 모수) — 산업단지명·회사명으로 조회", dailyLimit: 1_000, endpoint: "http://apis.data.go.kr/B550624/fctryRegistInfo" },
  { id: "15034830", name: "대한무역투자진흥공사_국가정보", org: "KOTRA", use: "국가별 경제지표·시장특성·한국과의 교역·무역규제·진출기업", dailyLimit: 10_000, endpoint: "http://apis.data.go.kr/B410001/kotra_nationalInformation/natnInfo" },
  { id: "15122665", name: "대한무역투자진흥공사_국가별 물가정보", org: "KOTRA", use: "국가별 생활물가(식품·교통·주거·임금 등 약 40개 품목, US$)", dailyLimit: 10_000, endpoint: "http://apis.data.go.kr/B410001/priceInfoByNatn" },
  { id: "15107303", name: "행정안전부_통계연보_지역별 주민등록인구", org: "행정안전부", use: "시도별 연말 주민등록인구·세대·남녀(2008~)", dailyLimit: 10_000, endpoint: "http://apis.data.go.kr/1741000/RegistrationPopulationByRegion" },
  { id: "3038225", name: "한국고용정보원_워크넷 채용정보(고용24)", org: "한국고용정보원", use: "지역·직종별 채용공고(구인난 근거, CC BY-NC-ND)", dailyLimit: null, endpoint: null },
];

export interface ResearchDataSourcesStatus {
  dataGoKr: {
    keySet: boolean;
    /** enabled and in the catalog */
    services: DataGoKrService[];
    /** ids listed in DATA_GO_KR_SERVICES that the catalog does not know */
    unknownIds: string[];
    /** catalog entries not enabled — what is still worth applying for */
    notEnabled: DataGoKrService[];
  };
  kosis: boolean;
  law: boolean;
  bizinfo: boolean;
}

/** `"15134343, 15095335;15012005"` → ["15134343","15095335","15012005"] (comma/semicolon/space separated) */
export function parseServiceIds(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const tok of raw.split(/[\s,;]+/)) {
    const id = tok.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

const has = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;

export function researchDataSourcesStatus(env: Record<string, string | undefined> = process.env): ResearchDataSourcesStatus {
  const ids = parseServiceIds(env.DATA_GO_KR_SERVICES);
  const byId = new Map(DATA_GO_KR_CATALOG.map((s) => [s.id, s] as const));
  const services = ids.map((id) => byId.get(id)).filter((s): s is DataGoKrService => !!s);
  const unknownIds = ids.filter((id) => !byId.has(id));
  const notEnabled = DATA_GO_KR_CATALOG.filter((s) => !ids.includes(s.id));
  return {
    dataGoKr: { keySet: has(env.DATA_GO_KR_KEY), services, unknownIds, notEnabled },
    kosis: has(env.KOSIS_KEY),
    law: has(env.LAW_OC),
    bizinfo: has(env.BIZINFO_KEY),
  };
}

/** data.go.kr services the MCP layer may call: enabled in env AND known to the catalog AND key present. */
export function callableDataGoKrServices(env: Record<string, string | undefined> = process.env): DataGoKrService[] {
  const st = researchDataSourcesStatus(env);
  return st.dataGoKr.keySet ? st.dataGoKr.services : [];
}
