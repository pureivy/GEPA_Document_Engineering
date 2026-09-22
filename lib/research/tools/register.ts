/**
 * Registers the public-data tools on an McpServer. Tool names appear to the agent as
 * `mcp__gepa-data__<name>`. Every handler returns a ToolResult JSON string; failures are
 * reported as ordinary text results (not MCP errors) so the model reads the hint and moves on.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { researchDataSourcesStatus } from "../dataSources";
import { bizinfoSearch, BIZINFO_FIELDS } from "./bizinfo";
import { customsTrade, SIDO_CODES } from "./customs";
import { factorySearch } from "./factory";
import type { Env, Fetcher, ToolResult } from "./http";
import { kosisSearch, kosisTable } from "./kosis";
import { KOTRA_SECTIONS, kotraCountryInfo, kotraPrices } from "./kotra";
import { lawSearch, lawText } from "./law";
import { policyNewsSearch } from "./policyNews";
import { regionPopulation } from "./population";
import { storeStats, storeUpjongCodes } from "./stores";

export const RESEARCH_TOOL_NAMES = ["data_sources_status", "customs_trade", "store_stats", "store_upjong_codes", "policy_news_search", "kosis_search", "kosis_table", "law_search", "law_text", "bizinfo_search", "kotra_country_info", "kotra_prices", "factory_search", "region_population"] as const;
export const MCP_SERVER_NAME = "gepa-data";
/** fully qualified names as the CLI exposes them (for allow-lists and agent frontmatter) */
export const RESEARCH_MCP_TOOL_IDS = RESEARCH_TOOL_NAMES.map((n) => `mcp__${MCP_SERVER_NAME}__${n}`);

const defaultFetch: Fetcher = (url, init) => fetch(url, init);

function text(result: ToolResult<unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

async function guarded<T>(fn: () => Promise<ToolResult<T>>) {
  try {
    return text(await fn());
  } catch (e) {
    return text({ ok: false, error: `도구 실행 오류: ${e instanceof Error ? e.message : String(e)}`, hint: "잠시 후 다시 시도하거나 다른 출처를 쓰세요." });
  }
}

export function registerResearchTools(server: McpServer, env: Env, fetchImpl: Fetcher = defaultFetch): void {
  server.registerTool(
    "data_sources_status",
    { description: "설정된 공공데이터 출처(키·서비스)를 보여준다. 어떤 도구를 쓸 수 있는지 먼저 확인할 때.", inputSchema: {} },
    async () =>
      text({
        ok: true,
        source: { 기관: "-", 서비스: "설정 상태", url: "" },
        data: (() => {
          const st = researchDataSourcesStatus(env);
          return {
            dataGoKr: st.dataGoKr.keySet ? st.dataGoKr.services.map((s) => `${s.id} ${s.name}`) : [],
            kosis: st.kosis,
            법제처: st.law,
            기업마당: st.bizinfo,
            도구: RESEARCH_TOOL_NAMES,
          };
        })(),
      }),
  );

  server.registerTool(
    "customs_trade",
    {
      description:
        "관세청 수출입실적(월별, 모든 금액 천 달러). kind=sido: 시도별(경북 sidoCd=47) 수출입 추이 / sigungu: 시군구별 (sidoCd + HS 6자리 필수) / nation: 국가별(cntyCd) / item_nation: 품목×국가(cntyCd + hsSgn 2·4·6·10자리) / item: 품목별 전 국가 합계(hsSgn). 기간은 YYYYMM 이고 한 호출에 12개월 이내(3개년은 연도별 3회). 시군 전체 합계는 제공되지 않으므로 시군은 품목(HS6)별로 조회한다.",
      inputSchema: {
        kind: z.enum(["sido", "sigungu", "nation", "item_nation", "item"]),
        strtYymm: z.string().regex(/^\d{6}$/),
        endYymm: z.string().regex(/^\d{6}$/),
        sidoCd: z.string().optional().describe(`시도 코드: ${Object.entries(SIDO_CODES).map(([k, v]) => `${k}=${v}`).join(", ")}`),
        hsSgn: z.string().optional().describe("HS 코드 (sigungu: 6자리 필수, item_nation/item: 2·4·6·10자리)"),
        cntyCd: z.string().optional().describe("국가 ISO2 (US, CN, JP, VN …)"),
      },
    },
    async (p) => guarded(() => customsTrade(p, env, fetchImpl)),
  );

  server.registerTool(
    "store_stats",
    {
      description: "소상공인시장진흥공단 상가업소 DB에서 지역(시도 2자리/시군구 5자리/행정동 코드) × 업종(대·중·소분류 코드)의 점포 수를 센다. 업종 코드는 store_upjong_codes 로 확인.",
      inputSchema: {
        areaCode: z.string().describe("행정구역 코드: 경상북도 47, 경산시 47290 …"),
        indsLclsCd: z.string().optional().describe("상권업종 대분류 (I2 음식, G2 소매, S2 수리·개인 …)"),
        indsMclsCd: z.string().optional(),
        indsSclsCd: z.string().optional(),
      },
    },
    async (p) => guarded(() => storeStats(p, env, fetchImpl)),
  );

  server.registerTool(
    "store_upjong_codes",
    {
      description: "상가업소 업종 분류 코드 목록 (large: 대분류 전체 / middle: parent=대분류 코드 / small: parent=중분류 코드).",
      inputSchema: { level: z.enum(["large", "middle", "small"]), parent: z.string().optional() },
    },
    async (p) => guarded(() => storeUpjongCodes(p, env, fetchImpl)),
  );

  server.registerTool(
    "policy_news_search",
    {
      description: "대한민국 정책브리핑(korea.kr) 정책뉴스를 기간(YYYYMMDD)으로 가져와 keyword 로 거른다. 중앙부처 정책 근거·보도자료를 찾을 때.",
      inputSchema: { startDate: z.string().regex(/^\d{8}$/), endDate: z.string().regex(/^\d{8}$/), keyword: z.string().optional(), limit: z.number().int().min(1).max(30).optional() },
    },
    async (p) => guarded(() => policyNewsSearch(p, env, fetchImpl)),
  );

  server.registerTool(
    "kosis_search",
    { description: "KOSIS 국가통계포털 통계표 검색 → orgId/tblId. 예: '고령인구비율', '전국사업체조사 시군구 종사자규모', '기업생멸'.", inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() } },
    async (p) => guarded(() => kosisSearch(p, env, fetchImpl)),
  );

  server.registerTool(
    "kosis_table",
    {
      description:
        "KOSIS 통계표 자료 조회. kosis_search 의 orgId/tblId 와 주기(prdSe Y/Q/M/H), 시작·종료 시점(Y: 2022, M: 202401). nameFilter 로 행정구역 이름만 남긴다 — KOSIS 는 시군을 도 이름 없이 적으므로 '포항시'처럼 시군 이름만(도 전체는 '경상북도'). codePrefix='37' 은 통계청 코드 기준 경상북도 모든 시군(행안부 코드 47과 다름). 행이 많으면 limit 까지만 반환.",
      inputSchema: {
        orgId: z.string(),
        tblId: z.string(),
        prdSe: z.enum(["Y", "Q", "M", "H"]),
        startPrdDe: z.string(),
        endPrdDe: z.string(),
        nameFilter: z.string().optional(),
        codePrefix: z.string().optional(),
        itmId: z.string().optional(),
        objL1: z.string().optional(),
        objL2: z.string().optional().describe("표에 분류2가 있을 때만 (보통 'ALL'); KOSIS 오류 30/31 이면 분류 수가 안 맞는 것"),
        objL3: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
    },
    async (p) => guarded(() => kosisTable(p, env, fetchImpl)),
  );

  server.registerTool(
    "law_search",
    {
      description: "법제처 국가법령정보 검색. target=law 법령(중소기업기본법 …) / ordin 자치법규(조례; region 으로 '경상북도'·'안동시' 등 거르기). 결과의 MST 로 law_text 호출.",
      inputSchema: { query: z.string().min(1), target: z.enum(["law", "ordin"]), region: z.string().optional().describe("자치법규: 지자체명으로 거르기 (경상북도, 안동시 …)"), limit: z.number().int().min(1).max(50).optional() },
    },
    async (p) => guarded(() => lawSearch(p, env, fetchImpl)),
  );

  server.registerTool(
    "law_text",
    {
      description: "법령·자치법규 본문(조문). article 로 특정 조(예: '3' 또는 '제3조')만 볼 수 있다. 인용은 '「법령명」 제N조(제목)' 형식.",
      inputSchema: { target: z.enum(["law", "ordin"]), MST: z.string().min(1), article: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
    },
    async (p) => guarded(() => lawText(p, env, fetchImpl)),
  );

  server.registerTool(
    "bizinfo_search",
    {
      description: `기업마당 지원사업 공고(중앙부처·지자체) 검색 — 유사·선행 사업 조사용. field: ${Object.entries(BIZINFO_FIELDS).map(([k, v]) => `${k}=${v}`).join(", ")}. keyword 는 공고명·요약·해시태그에 모두 포함되는 단어.`,
      inputSchema: { keyword: z.string().optional(), field: z.string().optional(), hashtags: z.string().optional(), fetchCount: z.number().int().min(1).max(500).optional(), limit: z.number().int().min(1).max(50).optional() },
    },
    async (p) => guarded(() => bizinfoSearch(p, env, fetchImpl)),
  );

  server.registerTool(
    "kotra_country_info",
    {
      description: `KOTRA 국가정보 — 해외마케팅·사절단·전시회 대상국 근거. cntyCd(ISO2) 한 국가의 sections 만 돌려준다: ${KOTRA_SECTIONS.join(", ")} (기본: 개요·경제지표·시장특성·한국과의교역). 경제지표는 연도별 값(GDP·성장률·물가·수출입), 한국과의교역은 대한 수출입(백만$)과 한국의 수출 상위 품목.`,
      inputSchema: {
        cntyCd: z.string().describe("ISO2 국가코드 (VN, US, CN, JP, IN …)"),
        sections: z.array(z.enum(KOTRA_SECTIONS)).optional(),
        maxChars: z.number().int().min(200).max(8000).optional().describe("서술형 항목 한 개당 최대 글자 수(기본 1200)"),
      },
    },
    async (p) => guarded(() => kotraCountryInfo(p, env, fetchImpl)),
  );

  server.registerTool(
    "kotra_prices",
    {
      description: "KOTRA 국가별 생활물가(US$, 약 40개 품목: 식품·음료·교통·주거·임금·통신·의료 …). cntyCd 로 한 국가의 전체 품목, 또는 item(품목명 일부: '빅맥', '최저임금', '아파트')으로 국가 간 비교. 둘 다 주면 교집합.",
      inputSchema: { cntyCd: z.string().optional().describe("ISO2 국가코드"), item: z.string().optional().describe("품목명 일부") },
    },
    async (p) => guarded(() => kotraPrices(p, env, fetchImpl)),
  );

  server.registerTool(
    "factory_search",
    {
      description: "한국산업단지공단 공장등록정보(팩토리온). irsttNm(산업단지명, 부분 일치: '구미국가산업단지', '포항철강') 또는 cmpnyNm(회사명) 중 하나로 등록공장을 찾는다. totalCount 가 대상 모수(단지 내 등록공장 수), rows 는 업종·주생산품·고용인원 예시.",
      inputSchema: {
        irsttNm: z.string().optional(),
        cmpnyNm: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        pageNo: z.number().int().min(1).optional(),
      },
    },
    async (p) => guarded(() => factorySearch(p, env, fetchImpl)),
  );

  server.registerTool(
    "region_population",
    {
      description: "행정안전부 통계연보 시도별 연말 주민등록인구(총인구·남·여·세대, 2008~). region 은 '경북'·'경상북도' 모두 가능, 생략하면 전 시도. 기본은 최근 3개년. 시군 단위는 kosis_table 을 쓴다.",
      inputSchema: { region: z.string().optional(), fromYear: z.number().int().optional(), toYear: z.number().int().optional() },
    },
    async (p) => guarded(() => regionPopulation(p, env, fetchImpl)),
  );
}
