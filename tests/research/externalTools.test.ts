/**
 * DART·ECOS·KIPRIS 도구 (2026-11-10). 응답 모양은 실제 호출로 확인한 것을 줄여 옮겼다.
 * 네트워크 없이 돈다 — fetcher 와 DART 고유번호 목록을 주입한다.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { dartCompany, dartFinance, normalizeCorpName, parseCorpCodeXml, type DartCorp } from "../../lib/research/tools/dart";
import { clearEcosCache, ecosSearch, ecosSeries } from "../../lib/research/tools/ecos";
import { kiprisSearch } from "../../lib/research/tools/kipris";
import { researchDataSourcesStatus } from "../../lib/research/dataSources";
import { RESEARCH_TOOL_NAMES } from "../../lib/research/tools/register";
import type { Fetcher } from "../../lib/research/tools/http";

function fetcher(body: (url: string) => string): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => body(url) };
  }) as Fetcher & { calls: string[] };
  f.calls = calls;
  return f;
}
const env = { DART_KEY: "dartsecret123", ECOS_KEY: "ECOSSECRET99", KIPRIS_API_KEY: "kipris+secret/=" };
const noLeak = (r: unknown) => {
  const s = JSON.stringify(r);
  for (const k of Object.values(env)) expect(s).not.toContain(k);
  expect(s).not.toContain(encodeURIComponent(env.KIPRIS_API_KEY));
};

describe("DART", () => {
  const corps: DartCorp[] = [
    { c: "00155276", n: "포스코퓨처엠", s: "003670" },
    { c: "00999999", n: "포스코퓨처엠서비스", s: "" },
    { c: "00111111", n: "에코프로", s: "086520" },
    { c: "00222222", n: "에코프로비엠", s: "247540" },
  ];
  const load = async () => corps;
  const company = JSON.stringify({ status: "000", message: "정상", corp_code: "00155276", corp_name: "(주)포스코퓨처엠", stock_code: "003670", ceo_nm: "엄기천", corp_cls: "Y", adres: "경상북도 포항시 남구  신항로 110", induty_code: "282", est_dt: "19710513", acc_mt: "12" });

  it("고유번호 목록 XML 을 읽는다", () => {
    const xml =
      "<result><list><corp_code>00434003</corp_code><corp_name>다코</corp_name><corp_eng_name>Daco</corp_eng_name><stock_code> </stock_code><modify_date>20170630</modify_date></list>" +
      "<list><corp_code>00430964</corp_code><corp_name>굿앤엘에스</corp_name><corp_eng_name>Good &amp; LS</corp_eng_name><stock_code>123456</stock_code><modify_date>x</modify_date></list></result>";
    expect(parseCorpCodeXml(xml)).toEqual([
      { c: "00434003", n: "다코", s: "" },
      { c: "00430964", n: "굿앤엘에스", s: "123456" },
    ]);
  });

  it("회사명의 (주)·주식회사·띄어쓰기를 무시한다", () => {
    expect(normalizeCorpName("(주)포스코 퓨처엠")).toBe(normalizeCorpName("주식회사 포스코퓨처엠"));
  });

  it("정확히 같은 이름이 하나면 개황까지 가져오고 키를 숨긴다", async () => {
    const f = fetcher(() => company);
    const r = await dartCompany({ name: "㈜포스코퓨처엠" }, env, f, load);
    expect(r.ok && r.data.개황).toMatchObject({ 고유번호: "00155276", 상장구분: "유가증권시장", 주소: "경상북도 포항시 남구 신항로 110" });
    expect(r.ok && r.data.후보[0].고유번호).toBe("00155276");
    expect(f.calls[0]).toContain("crtfc_key=dartsecret123");
    noLeak(r);
  });

  it("후보가 여럿이면 개황 없이 후보만, 상장사가 앞", async () => {
    const f = fetcher(() => company);
    const r = await dartCompany({ name: "에코" }, env, f, load);
    expect(r.ok && r.data.후보.map((x) => x.회사명)).toEqual(["에코프로", "에코프로비엠"]);
    expect(r.ok && r.data.개황).toBeUndefined();
    expect(f.calls).toHaveLength(0);
  });

  it("주요계정은 연결을 고르고 금액을 숫자로", async () => {
    const row = (fs: string, acc: string, a: string) => ({ fs_div: fs, fs_nm: fs === "CFS" ? "연결재무제표" : "재무제표", sj_nm: "손익계산서", account_nm: acc, thstrm_dt: "2024.01.01 ~ 2024.12.31", frmtrm_dt: "2023", bfefrmtrm_dt: "2022", thstrm_amount: a, frmtrm_amount: "-", bfefrmtrm_amount: "1,000", currency: "KRW" });
    const f = fetcher(() => JSON.stringify({ status: "000", list: [row("CFS", "매출액", "3,700,000,000"), row("OFS", "매출액", "9")] }));
    const r = await dartFinance({ corp_code: "00155276", year: "2024" }, env, f);
    expect(r.ok && r.data.행).toEqual([{ 재무제표: "연결재무제표", 구분: "손익계산서", 계정: "매출액", 당기: 3_700_000_000, 전기: null, 전전기: 1000 }]);
    noLeak(r);
  });

  it("데이터 없음(013)은 hint 와 함께 ok:false", async () => {
    const r = await dartFinance({ corp_code: "00155276", year: "2099" }, env, fetcher(() => JSON.stringify({ status: "013", message: "조회된 데이타가 없습니다." })));
    expect(!r.ok && r.error).toContain("없습니다");
    expect(!r.ok && r.hint).toBeTruthy();
  });

  it("키가 없으면 부르지 않는다", async () => {
    const f = fetcher(() => "");
    expect((await dartCompany({ name: "x" }, {}, f, load)).ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
});

describe("ECOS", () => {
  beforeEach(() => clearEcosCache());
  const body = (url: string) => {
    if (url.includes("/StatisticTableList/"))
      return JSON.stringify({
        StatisticTableList: {
          list_total_count: 3,
          row: [
            { STAT_CODE: "0000000048", STAT_NAME: "1.3. 금리", SRCH_YN: "N" },
            { STAT_CODE: "722Y001", STAT_NAME: "1.3.1. 한국은행 기준금리 및 여수신금리", CYCLE: "D", SRCH_YN: "Y", P_STAT_CODE: "0000000048" },
            { STAT_CODE: "901Y009", STAT_NAME: "4.2.1. 소비자물가지수", CYCLE: "M", SRCH_YN: "Y" },
          ],
        },
      });
    if (url.includes("/KeyStatisticList/")) return JSON.stringify({ KeyStatisticList: { row: [{ CLASS_NAME: "시장금리", KEYSTAT_NAME: "한국은행 기준금리", DATA_VALUE: "3", CYCLE: "20261107", UNIT_NAME: "%" }] } });
    if (url.includes("/2099")) return JSON.stringify({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } });
    return JSON.stringify({
      StatisticSearch: {
        list_total_count: 2,
        row: [
          { STAT_NAME: "기준금리", ITEM_NAME1: "한국은행 기준금리", UNIT_NAME: "연%", TIME: "2024", DATA_VALUE: "3" },
          { STAT_NAME: "기준금리", ITEM_NAME1: "한국은행 기준금리", UNIT_NAME: "연%", TIME: "2025", DATA_VALUE: "2.5" },
        ],
      },
    });
  };

  it("목차 줄(SRCH_YN=N)은 빼고, 핵심지표 최신값을 함께 준다. 키는 경로에서 가린다", async () => {
    const f = fetcher(body);
    const r = await ecosSearch({ keyword: "기준금리" }, env, f);
    expect(r.ok && r.data.통계표.map((t) => t.통계표코드)).toEqual(["722Y001"]);
    expect(r.ok && r.data.핵심지표[0]).toMatchObject({ 값: 3, 시점: "20261107" });
    expect(f.calls[0]).toContain("/ECOSSECRET99/");
    expect(r.ok && r.source.url).toContain("/***/");
    noLeak(r);
  });

  it("시계열을 숫자로, 빈 뒤쪽 항목은 경로에서 뺀다", async () => {
    const f = fetcher(body);
    const r = await ecosSeries({ statCode: "722Y001", cycle: "A", start: "2024", end: "2025", item1: "0101000", item2: "" }, env, f);
    expect(r.ok && r.data.행.map((x) => x.값)).toEqual([3, 2.5]);
    expect(f.calls[0].endsWith("/722Y001/A/2024/2025/0101000")).toBe(true);
    noLeak(r);
  });

  it("중간 항목을 비우면 부르지 않고 알려 준다", async () => {
    const f = fetcher(body);
    const r = await ecosSeries({ statCode: "X", cycle: "A", start: "2024", end: "2025", item2: "B" }, env, f);
    expect(r.ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it("데이터 없음은 ok:false", async () => {
    const r = await ecosSeries({ statCode: "722Y001", cycle: "M", start: "209901", end: "209902", item1: "0101000" }, env, fetcher(body));
    expect(!r.ok && r.error).toContain("없습니다");
  });
});

describe("KIPRIS", () => {
  const ok =
    '<?xml version="1.0"?><response><header><successYN>Y</successYN><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>' +
    "<body><items><item><applicantName>(주)포스코퓨처엠</applicantName><applicationDate>20240430</applicationDate><applicationNumber>1020240057861</applicationNumber>" +
    "<inventionTitle>양극 활물질</inventionTitle><ipcNumber>C01G 53/506</ipcNumber><registerDate>20261106</registerDate><registerNumber>1030466610000</registerNumber>" +
    "<registerStatus>등록</registerStatus></item></items></body><count><numOfRows>1</numOfRows><pageNo>1</pageNo><totalCount>375</totalCount></count></response>";

  it("출원인·기간은 상세 검색으로, 총건수와 항목을 준다", async () => {
    const f = fetcher(() => ok);
    const r = await kiprisSearch({ applicant: "포스코퓨처엠", from: "20240101", to: "20241231" }, env, f);
    expect(r.ok && r.data.총건수).toBe(375);
    expect(r.ok && r.data.항목[0]).toMatchObject({ 출원인: "(주)포스코퓨처엠", 상태: "등록", 등록번호: "1030466610000" });
    expect(f.calls[0]).toContain("getAdvancedSearch");
    expect(f.calls[0]).toContain("applicationDate=20240101%7E20241231");
    noLeak(r);
  });

  it("낱말만 주면 낱말 검색", async () => {
    const f = fetcher(() => ok);
    await kiprisSearch({ word: "스마트팜" }, env, f);
    expect(f.calls[0]).toContain("getWordSearch");
  });

  it("키 오류(30)는 ok:false", async () => {
    const r = await kiprisSearch({ word: "x" }, env, fetcher(() => "<response><header><successYN>N</successYN><resultCode>30</resultCode><resultMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</resultMsg></header></response>"));
    expect(!r.ok && r.error).toContain("30");
  });
});

describe("설정·등록", () => {
  it("세 키를 설정 상태에 싣는다", () => {
    const st = researchDataSourcesStatus({ DART_KEY: "a", ECOS_KEY: "", KIPRIS_API_KEY: "c" });
    expect([st.dart, st.ecos, st.kipris]).toEqual([true, false, true]);
  });
  it("도구 이름이 등록 목록에 있다", () => {
    for (const n of ["dart_company", "dart_finance", "ecos_search", "ecos_items", "ecos_series", "kipris_search"]) expect(RESEARCH_TOOL_NAMES).toContain(n);
  });
});

/** 2026-11-10: 법령 본문을 항까지만 읽어 기준 수치(호·목·별표)가 빠졌고, 보고서에 [확인필요] 가 남았다 */
describe("law_text — 호·목·별표", () => {
  it("항 아래 호·목까지 펼치고, 별표 목록과 본문을 준다", async () => {
    const { lawText } = await import("../../lib/research/tools/law");
    const doc = {
      법령: {
        기본정보: { 법령명_한글: "중소기업기본법 시행령", 시행일자: "20260102" },
        조문: {
          조문단위: [
            {
              조문번호: "3", 조문여부: "조문", 조문제목: "중소기업의 범위",
              항: [{ 항내용: "① 다음 각 호의 요건을 모두 갖춘 기업", 호: [{ 호내용: "1. 다음 각 목의 요건", 목: [{ 목내용: "가. 별표 1의 기준에 맞을 것" }, { 목내용: [["나. 자산총액이 5천억원 미만일 것", "  1) 세부"]] }] }] }],
            },
          ],
        },
        별표: { 별표단위: [{ 별표번호: "0001", 별표가지번호: "00", 별표제목: "업종별 규모 기준", 별표내용: [["┌────┐", "│식료품 제조업 │C10 │1,200억원 이하│   ", "└────┘"]] }] },
      },
    };
    const f = fetcher(() => JSON.stringify(doc));
    const r = await lawText({ target: "law", MST: "1", article: "3" }, { LAW_OC: "me" }, f);
    expect(r.ok && r.data.조문[0].내용).toContain("가. 별표 1의 기준에 맞을 것");
    expect(r.ok && r.data.조문[0].내용).toContain("나. 자산총액이 5천억원 미만일 것");
    expect(r.ok && r.data.별표목록).toEqual([{ 번호: "1", 제목: "업종별 규모 기준" }]);
    const b = await lawText({ target: "law", MST: "1", appendix: "별표 1" }, { LAW_OC: "me" }, f);
    expect(b.ok && b.data.별표?.내용).toBe("│식료품 제조업 │C10 │1,200억원 이하│");
    const none = await lawText({ target: "law", MST: "1", appendix: "9" }, { LAW_OC: "me" }, f);
    expect(!none.ok && none.error).toContain("있는 별표: 1");
  });
});
