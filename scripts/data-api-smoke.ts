/**
 * Live smoke test of the public-data tool handlers with the keys in .env/.env.local
 * (`pnpm data:smoke`). Prints one line per tool; exits 1 if a configured tool fails.
 * Uses each service once (정책뉴스 is capped at 1,000 calls/day).
 */
import { config } from "dotenv";
import { customsTrade } from "../lib/research/tools/customs";
import { storeStats, storeUpjongCodes } from "../lib/research/tools/stores";
import { policyNewsSearch } from "../lib/research/tools/policyNews";
import { kosisSearch, kosisTable } from "../lib/research/tools/kosis";
import { lawSearch, lawText } from "../lib/research/tools/law";
import { bizinfoSearch } from "../lib/research/tools/bizinfo";
import { kotraCountryInfo, kotraPrices } from "../lib/research/tools/kotra";
import { factorySearch } from "../lib/research/tools/factory";
import { regionPopulation } from "../lib/research/tools/population";
import type { ToolResult } from "../lib/research/tools/http";
import { researchDataSourcesStatus } from "../lib/research/dataSources";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const env = process.env;
const f = (url: string, init?: { headers?: Record<string, string> }) => fetch(url, init);

let failures = 0;
function report(name: string, r: ToolResult<unknown>, summary: (d: never) => string, expected = true) {
  if (r.ok) console.log(`✓ ${name}: ${summary(r.data as never)}`);
  else {
    console.log(`${expected ? "✗" : "·"} ${name}: ${r.error}${r.hint ? ` — ${r.hint}` : ""}`);
    if (expected) failures++;
  }
}

async function main() {
  const st = researchDataSourcesStatus(env);
  const has = (id: string) => st.dataGoKr.keySet && st.dataGoKr.services.some((s) => s.id === id);
  const yymm = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  report("customs_trade sido 경북", await customsTrade({ kind: "sido", strtYymm: yymm, endYymm: yymm, sidoCd: "47" }, env, f), (d: { rows: { 구분: string; 수출금액_천달러: number | null }[] }) => d.rows.map((r) => `${r.구분} 수출 ${r.수출금액_천달러}천$`).join(" / "), has("15101643"));
  report("customs_trade sigungu 경북 HS870323", await customsTrade({ kind: "sigungu", strtYymm: yymm, endYymm: yymm, sidoCd: "47", hsSgn: "870323" }, env, f), (d: { count: number; rows: { 구분: string }[] }) => `${d.count}행 (${d.rows.slice(0, 3).map((r) => r.구분).join(", ")} …)`, has("15134343"));
  report("customs_trade nation US", await customsTrade({ kind: "nation", strtYymm: yymm, endYymm: yymm, cntyCd: "US" }, env, f), (d: { rows: { 기간: string; 수출금액_천달러: number | null }[] }) => d.rows.map((r) => `${r.기간}: ${r.수출금액_천달러}`).join(", "), has("15101612"));
  report("customs_trade item_nation US 8703", await customsTrade({ kind: "item_nation", strtYymm: yymm, endYymm: yymm, cntyCd: "US", hsSgn: "8703" }, env, f), (d: { count: number }) => `${d.count}행`, has("15100475"));
  report("customs_trade item 8703", await customsTrade({ kind: "item", strtYymm: yymm, endYymm: yymm, hsSgn: "8703" }, env, f), (d: { rows: { 기간: string; 수출금액_천달러: number | null }[] }) => d.rows.slice(0, 2).map((r) => `${r.기간}: ${r.수출금액_천달러}천$`).join(", "), has("15101609"));
  report("store_upjong_codes large", await storeUpjongCodes({ level: "large" }, env, f), (d: { codes: { code: string; name: string }[] }) => d.codes.map((c) => `${c.code}${c.name}`).join(" "), has("15012005"));
  report("store_stats 경산시 음식(I2)", await storeStats({ areaCode: "47290", indsLclsCd: "I2" }, env, f), (d: { 지역명: string; 업종: string; 점포수: number }) => `${d.지역명} ${d.업종} ${d.점포수}개`, has("15012005"));
  report("policy_news_search", await policyNewsSearch({ startDate: "20260901", endDate: "20260915", keyword: "소상공인", limit: 3 }, env, f), (d: { matched: number; fetched: number; items: { 제목: string }[] }) => `${d.fetched}건 중 ${d.matched}건 일치: ${d.items.map((i) => i.제목).join(" | ")}`, has("15095335"));
  const ks = await kosisSearch({ query: "고령인구비율", limit: 3 }, env, f);
  report("kosis_search 고령인구비율", ks, (d: { tables: { orgId: string; tblId: string; 통계표: string }[] }) => d.tables.map((t) => `${t.orgId}/${t.tblId} ${t.통계표}`).join(" | "), st.kosis);
  report("kosis_table DT_1YL20631 경북 시군", await kosisTable({ orgId: "101", tblId: "DT_1YL20631", prdSe: "Y", startPrdDe: "2024", endPrdDe: "2024", nameFilter: "경상북도", limit: 5 }, env, f), (d: { total: number; rows: { 분류: string; 항목: string; 값: number | null; 단위: string }[] }) => `${d.total}행: ${d.rows.map((r) => `${r.분류} ${r.항목} ${r.값}${r.단위}`).join(" / ")}`, st.kosis);
  const ls = await lawSearch({ query: "소상공인 지원", target: "ordin", region: "경상북도", limit: 3 }, env, f);
  report("law_search ordin 경북 소상공인", ls, (d: { hits: { 이름: string; MST: string }[] }) => d.hits.map((h) => `${h.이름}(${h.MST})`).join(" | "), st.law);
  if (ls.ok && ls.data.hits[0]) report("law_text ordin 제1조", await lawText({ target: "ordin", MST: ls.data.hits[0].MST, article: "1" }, env, f), (d: { 이름: string; 조문: { 조: string; 제목: string; 내용: string }[] }) => `${d.이름} 제${d.조문[0]?.조}조(${d.조문[0]?.제목}) ${d.조문[0]?.내용.slice(0, 60)}…`, st.law);
  report("law_text law 중소기업기본법 제3조", await lawText({ target: "law", MST: "281989", article: "3" }, env, f), (d: { 이름: string; 소관: string; 조문: { 제목: string; 내용: string }[] }) => `${d.이름}(${d.소관}) ${d.조문[0]?.제목}: ${d.조문[0]?.내용.slice(0, 50)}…`, st.law);
  report("bizinfo_search 수출 경북", await bizinfoSearch({ keyword: "경북", field: "04", limit: 3 }, env, f), (d: { matched: number; fetched: number; items: { 공고명: string; 소관기관: string }[] }) => `${d.fetched}건 중 ${d.matched}건: ${d.items.map((i) => `${i.공고명}(${i.소관기관})`).join(" | ")}`, st.bizinfo);

  report("kotra_country_info VN", await kotraCountryInfo({ cntyCd: "VN", sections: ["개요", "경제지표"] }, env, f), (d: { 개요: { 국명: string }; 경제지표: { 경제성장률: Record<string, number | null> } }) => `${d.개요.국명} 성장률 ${JSON.stringify(d.경제지표.경제성장률)}`, has("15034830"));
  report("kotra_prices 최저임금", await kotraPrices({ item: "최저임금" }, env, f), (d: { count: number; rows: { 국가: string; 금액_달러: number | null; 단위: string }[] }) => `${d.count}개국: ${d.rows.slice(0, 3).map((r) => `${r.국가} ${r.금액_달러}$/${r.단위}`).join(", ")} …`, has("15122665"));
  report("factory_search 구미국가산업단지", await factorySearch({ irsttNm: "구미국가산업단지", limit: 1 }, env, f), (d: { totalCount: number; rows: { 회사명: string; 주생산품: string }[] }) => `등록공장 ${d.totalCount}개 (예: ${d.rows[0]?.회사명} ${d.rows[0]?.주생산품})`, has("15087611"));
  report("region_population 경북", await regionPopulation({ region: "경북" }, env, f), (d: { rows: { 연도: string; 총인구: number | null }[] }) => d.rows.map((r) => `${r.연도} ${r.총인구}`).join(", "), has("15107303"));

  console.log(failures ? `\n${failures} tool(s) failed` : "\nall configured tools OK");
  process.exit(failures ? 1 : 0);
}

void main();
