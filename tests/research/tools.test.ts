import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { customsTrade } from "../../lib/research/tools/customs";
import { storeStats } from "../../lib/research/tools/stores";
import { kosisTable } from "../../lib/research/tools/kosis";
import { lawSearch, lawText } from "../../lib/research/tools/law";
import { bizinfoSearch } from "../../lib/research/tools/bizinfo";
import { policyNewsSearch } from "../../lib/research/tools/policyNews";
import { buildUrl, dataGoKrEnvelopeError, redactUrl, stripHtml, type Fetcher } from "../../lib/research/tools/http";
import { RESEARCH_MCP_TOOL_IDS, RESEARCH_TOOL_NAMES } from "../../lib/research/tools/register";

const fx = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
/** a fetcher that records the URL and answers with a fixture (or a function of the url) */
function fetcher(body: string | ((url: string) => string), status = 200): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    return { ok: status < 400, status, text: async () => (typeof body === "function" ? body(url) : body) };
  }) as Fetcher & { calls: string[] };
  f.calls = calls;
  return f;
}
const env = { DATA_GO_KR_KEY: "K+E/Y=", DATA_GO_KR_SERVICES: "15101643,15134343,15012005,15095335", KOSIS_KEY: "kk", LAW_OC: "me", BIZINFO_KEY: "bb" };

describe("http helpers", () => {
  it("encodes the key and redacts it in provenance", () => {
    const url = buildUrl("http://x/y", { serviceKey: "K+E/Y=", a: "가", b: undefined, c: "" });
    expect(url).toBe("http://x/y?serviceKey=K%2BE%2FY%3D&a=%EA%B0%80");
    expect(redactUrl(url)).toBe("http://x/y?serviceKey=***&a=%EA%B0%80");
  });
  it("maps the data.go.kr envelope codes", () => {
    expect(dataGoKrEnvelopeError(fx("datago-not-registered.xml"))?.code).toBe("30");
    expect(dataGoKrEnvelopeError('{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":"22","returnAuthMsg":"LIMITED"}}}')?.error).toContain("트래픽");
    expect(dataGoKrEnvelopeError(fx("customs-sido.xml"))).toBeNull();
  });
  it("strips html", () => {
    expect(stripHtml("<p>도내 <b>해외전시회</b>&nbsp;참가비</p>")).toBe("도내 해외전시회 참가비");
  });
});

describe("customs_trade", () => {
  it("parses 시도별 rows with padded, comma-separated amounts", async () => {
    const f = fetcher(fx("customs-sido.xml"));
    const r = await customsTrade({ kind: "sido", strtYymm: "202601", endYymm: "202601", sidoCd: "47" }, env, f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows[1]).toMatchObject({ 기간: "2026", 구분: "경상북도", 수출금액_천달러: 3631968, 수입금액_천달러: 1438026, 무역수지_천달러: 2193942, 수출건수: 36369 });
    expect(r.source.url).toContain("serviceKey=***");
    expect(f.calls[0]).toContain("sidotrade/getSidotradeList?serviceKey=K%2BE%2FY%3D");
    expect(f.calls[0]).toContain("sidoCd=47");
  });
  it("parses 시군구별 rows and requires HS6", async () => {
    const f = fetcher(fx("customs-sigungu.xml"));
    const r = await customsTrade({ kind: "sigungu", strtYymm: "202601", endYymm: "202601", sidoCd: "47", hsSgn: "870323" }, env, f);
    expect(r.ok && r.data.rows.map((x) => x.구분)).toEqual(["경상북도 경산시", "경상북도 경주시"]);
    expect(r.ok && r.data.rows[0].품목명).toContain("1,500시시");
    const bad = await customsTrade({ kind: "sigungu", strtYymm: "202601", endYymm: "202601", sidoCd: "47", hsSgn: "8703" }, env, f);
    expect(bad.ok).toBe(false);
    expect(f.calls).toHaveLength(1);
  });
  it("rejects windows longer than 12 months before calling the API", async () => {
    const f = fetcher(fx("customs-sido.xml"));
    const r = await customsTrade({ kind: "sido", strtYymm: "202301", endYymm: "202512", sidoCd: "47" }, env, f);
    expect(!r.ok && r.error).toContain("12개월");
    expect(f.calls).toHaveLength(0);
    const ok = await customsTrade({ kind: "sido", strtYymm: "202301", endYymm: "202312", sidoCd: "47" }, env, f);
    expect(ok.ok).toBe(true);
  });
  it("refuses services not enabled in env and reports an unregistered key without throwing", async () => {
    const r = await customsTrade({ kind: "nation", strtYymm: "202601", endYymm: "202601", cntyCd: "US" }, env, fetcher(""));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("DATA_GO_KR_SERVICES");
    const r2 = await customsTrade({ kind: "sido", strtYymm: "202601", endYymm: "202601" }, env, fetcher(fx("datago-not-registered.xml")));
    expect(!r2.ok && r2.hint).toContain("건너뛰고");
  });
});

describe("store_stats", () => {
  it("reads totalCount for a 시군구 × 업종 filter", async () => {
    const f = fetcher(fx("sdsc2-dong.json"));
    const r = await storeStats({ areaCode: "47290", indsLclsCd: "I2" }, env, f);
    expect(r.ok && r.data).toMatchObject({ 지역명: "경상북도 경산시", 업종: "I2 음식", 점포수: 4612, 기준일자: "202606" });
    expect(f.calls[0]).toContain("divId=signguCd&key=47290&indsLclsCd=I2");
  });
  it("rejects malformed area codes", async () => {
    const r = await storeStats({ areaCode: "472" }, env, fetcher(""));
    expect(r.ok).toBe(false);
  });
});

describe("kosis_table", () => {
  it("filters by name and by code prefix, normalizing ＜br＞ in item names", async () => {
    const f = fetcher(fx("kosis-aging.json"));
    const byName = await kosisTable({ orgId: "101", tblId: "DT_1YL20631", prdSe: "Y", startPrdDe: "2024", endPrdDe: "2024", nameFilter: "포항시" }, env, f);
    expect(byName.ok && byName.data.rows).toEqual([{ 시점: "2024", 분류: "포항시", 분류코드: "37010", 항목: "고령인구비율 (A÷B×100)", 값: 23.1, 단위: "%" }]);
    const byPrefix = await kosisTable({ orgId: "101", tblId: "DT_1YL20631", prdSe: "Y", startPrdDe: "2024", endPrdDe: "2024", codePrefix: "37" }, env, f);
    expect(byPrefix.ok && byPrefix.data.total).toBe(3);
    expect(f.calls[0]).toContain("itmId=ALL&objL1=ALL&prdSe=Y");
  });
  it("treats KOSIS search err 30 as an empty result", async () => {
    const { kosisSearch } = await import("../../lib/research/tools/kosis");
    const r = await kosisSearch({ query: "없는통계" }, env, fetcher('{err:"30",errMsg:"데이터가 존재하지 않습니다."}'));
    expect(r.ok && r.data.tables).toEqual([]);
  });
  it("surfaces KOSIS's JS-style error body", async () => {
    const r = await kosisTable({ orgId: "101", tblId: "X", prdSe: "Y", startPrdDe: "2024", endPrdDe: "2024" }, env, fetcher('{err:"20",errMsg:"필수요청변수값이 누락되었습니다."}'));
    expect(!r.ok && r.error).toContain("20");
  });
});

describe("law tools", () => {
  it("search puts the 지자체 into the query and redacts OC in links", async () => {
    const f = fetcher(fx("ordin-search.json"));
    const r = await lawSearch({ query: "소상공인 지원", target: "ordin", region: "경상북도" }, env, f);
    expect(f.calls[0]).toContain("query=%EA%B2%BD%EC%83%81%EB%B6%81%EB%8F%84+%EC%86%8C%EC%83%81%EA%B3%B5%EC%9D%B8");
    expect(r.ok && r.data.hits[0]).toMatchObject({ 이름: "경상북도 소상공인 지원에 관한 조례", MST: "1514685", 소관: "경상북도", 종류: "조례" });
    expect(r.ok && r.data.hits[0].링크).toContain("OC=***");
  });
  it("normalizes ordinance article numbers and picks one article", async () => {
    const r = await lawText({ target: "ordin", MST: "1514685" }, env, fetcher(fx("ordin-text.json")));
    expect(r.ok && r.data.조문.map((a) => a.조)).toEqual(["1", "3의2"]);
    const one = await lawText({ target: "ordin", MST: "1514685", article: "제1조" }, env, fetcher(fx("ordin-text.json")));
    expect(one.ok && one.data.조문).toHaveLength(1);
    expect(one.ok && one.source.기준시점).toBe("시행 20200709");
  });
  it("flattens 항 for statutes and reads object-valued 소관부처", async () => {
    const r = await lawText({ target: "law", MST: "281989", article: "3" }, env, fetcher(fx("law-text.json")));
    expect(r.ok && r.data).toMatchObject({ 이름: "중소기업기본법", 소관: "중소벤처기업부", 종류: "법률" });
    expect(r.ok && r.data.조문[0].내용).toBe("① 정부는 중소기업의 혁신역량과 …\n②지방자치단체는 제1항에 따른 …");
  });
});

describe("bizinfo_search / policy_news_search", () => {
  it("filters 기업마당 items by keyword over name, summary and hashtags", async () => {
    const f = fetcher(fx("bizinfo.json"));
    const r = await bizinfoSearch({ keyword: "경북 해외전시회", field: "04" }, env, f);
    expect(f.calls[0]).toContain("crtfcKey=bb&dataType=json&searchCnt=200&searchLclasId=04");
    expect(r.ok && r.data.matched).toBe(1);
    expect(r.ok && r.data.items[0]).toMatchObject({ 공고명: "2026년 경북 수출기업 해외전시회 참가 지원 공고", 소관기관: "경상북도", 분야: "수출 > 해외전시", 요약: "도내 중소기업의 해외전시회 참가비를 지원" });
    const bad = await bizinfoSearch({ field: "99" }, env, f);
    expect(bad.ok).toBe(false);
  });
  it("policy news reports an unregistered key as a skip hint", async () => {
    const r = await policyNewsSearch({ startDate: "20260901", endDate: "20260915" }, env, fetcher(fx("datago-not-registered.xml")));
    expect(!r.ok && r.hint).toContain("건너뛰고");
  });
  it("policy news parses NewsItem lists and filters by keyword", async () => {
    const xml = `<response><header><resultCode>0</resultCode></header><body><NewsItem><Title>소상공인 지원 확대</Title><SubTitle1>부제</SubTitle1><DataContents><![CDATA[<p>본문 내용</p>]]></DataContents><ApproveDate>2026-09-10</ApproveDate><MinisterCode>중소벤처기업부</MinisterCode><OriginalUrl>https://korea.kr/1</OriginalUrl></NewsItem><NewsItem><Title>다른 기사</Title></NewsItem></body></response>`;
    const r = await policyNewsSearch({ startDate: "20260901", endDate: "20260915", keyword: "소상공인" }, env, fetcher(xml));
    expect(r.ok && r.data).toMatchObject({ fetched: 2, matched: 1 });
    expect(r.ok && r.data.items[0]).toMatchObject({ 제목: "소상공인 지원 확대", 부처: "중소벤처기업부", 원문URL: "https://korea.kr/1", 요약: "본문 내용" });
  });
});

describe("tool ids", () => {
  it("are prefixed the way the CLI exposes MCP tools", () => {
    expect(RESEARCH_MCP_TOOL_IDS).toHaveLength(RESEARCH_TOOL_NAMES.length);
    expect(RESEARCH_MCP_TOOL_IDS[1]).toBe("mcp__gepa-data__customs_trade");
  });
});
