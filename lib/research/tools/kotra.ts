/**
 * KOTRA 해외시장 정보 (data.go.kr, 2 services, JSON).
 *
 *   15034830  국가정보      …/B410001/kotra_nationalInformation/natnInfo/natnInfo  (isoWd2CntCd)
 *   15122665  국가별 물가정보 …/B410001/priceInfoByNatn/priceInfoByNatn          (prcsCritSeq)
 *
 * 국가정보 returns one ~240 KB record per country (≈200 fields: 경제지표 lists, 시장특성,
 * 무역규제, 진출 한국기업 …), so `kotraCountryInfo` hands back only the requested sections with
 * long texts clipped. 물가정보 is keyed by 품목 slot (`prcsCritSeq` 1‥~40, every country per
 * slot), so one country's price list takes one call per slot; the result is cached per process.
 */
import { callableDataGoKrServices } from "../dataSources";
import { buildUrl, dataGoKrEnvelopeError, getText, num, redactUrl, str, stripHtml, type Env, type Fetcher, type ToolResult } from "./http";

const NATN_ID = "15034830";
const PRICE_ID = "15122665";
const NATN_URL = "http://apis.data.go.kr/B410001/kotra_nationalInformation/natnInfo/natnInfo";
const PRICE_URL = "http://apis.data.go.kr/B410001/priceInfoByNatn/priceInfoByNatn";

function gate(env: Env, id: string, name: string): ToolResult<never> | null {
  if (!env.DATA_GO_KR_KEY) return { ok: false, error: "data.go.kr 인증키가 설정되지 않았습니다 (DATA_GO_KR_KEY)", hint: "이 도구는 사용할 수 없습니다." };
  if (!callableDataGoKrServices(env).some((s) => s.id === id)) return { ok: false, error: `${name}(${id}) 이 DATA_GO_KR_SERVICES 에 없습니다`, hint: "다른 출처(KOTRA 해외시장뉴스 WebFetch 등)를 쓰세요." };
  return null;
}

async function callJson(fetchImpl: Fetcher, url: string): Promise<{ doc: KotraResponse } | { error: string; hint?: string }> {
  const { text } = await getText(fetchImpl, url);
  const envelope = dataGoKrEnvelopeError(text);
  if (envelope) return { error: envelope.error, hint: envelope.hint };
  try {
    return { doc: JSON.parse(text) as KotraResponse };
  } catch {
    return { error: `KOTRA API 응답을 해석할 수 없습니다: ${text.slice(0, 120)}` };
  }
}

interface KotraResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { totalCnt?: string | number; itemList?: { item?: Record<string, unknown> | Record<string, unknown>[] } | "" };
  };
}

function headerError(doc: KotraResponse): string | null {
  const code = str(doc.response?.header?.resultCode);
  return code === "00" ? null : `KOTRA API ${code || "?"}: ${str(doc.response?.header?.resultMsg)}`;
}

const ACCENTS: Record<string, string> = { grave: "\u0300", acute: "\u0301", circ: "\u0302", tilde: "\u0303", uml: "\u0308", ring: "\u030A", cedil: "\u0327" };

/** KOTRA text fields mix HTML entities (&middot;, &agrave;, &#39;) and CRLF; clip to `max` chars. */
function clean(v: unknown, max: number): string {
  const s = stripHtml(str(v))
    .replace(/&#(\d{1,6});/g, (m, n: string) => (Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : m))
    .replace(/&middot;/g, "·")
    .replace(/&([A-Za-z])(grave|acute|circ|tilde|uml|ring|cedil);/g, (_, c: string, a: string) => (c + ACCENTS[a]).normalize("NFC"))
    .replace(/&[a-z]+;/g, "")
    .replace(/\r\n?/g, "\n");
  return s.length > max ? `${s.slice(0, max)}…(생략)` : s;
}

/** `{nmgdp:[{inditValds,critYear}]}` → { "2021": 369.7, … } */
function series(v: unknown, valueKey = "inditValds"): Record<string, number | null> {
  const list = v && typeof v === "object" ? Object.values(v as Record<string, unknown>)[0] : undefined;
  const out: Record<string, number | null> = {};
  for (const row of Array.isArray(list) ? list : list ? [list] : []) {
    const r = row as Record<string, unknown>;
    const year = str(r.critYear);
    if (year) out[year] = num(r[valueKey]);
  }
  return out;
}

function rows(v: unknown): Record<string, unknown>[] {
  const list = v && typeof v === "object" ? Object.values(v as Record<string, unknown>)[0] : undefined;
  return (Array.isArray(list) ? list : list ? [list] : []) as Record<string, unknown>[];
}

export const KOTRA_SECTIONS = ["개요", "경제지표", "경제동향", "시장특성", "교역", "한국과의교역", "무역규제", "진출기업", "투자", "비즈니스관행"] as const;
export type KotraSection = (typeof KOTRA_SECTIONS)[number];

export interface KotraCountryParams {
  /** ISO 3166 alpha-2 (VN, US, CN, JP …) */
  cntyCd: string;
  /** 기본: 개요·경제지표·시장특성·한국과의교역 */
  sections?: KotraSection[];
  /** 서술형 항목 한 개당 최대 글자 수 (기본 1200) */
  maxChars?: number;
}

function section(it: Record<string, unknown>, s: KotraSection, max: number): unknown {
  switch (s) {
    case "개요":
      return { 국명: clean(it.natnNm, 200), 수도: clean(it.cptlNm, 100), 인구: clean(it.poplCnt, 200), 면적_km2: clean(it.area, 200), 언어: clean(it.langNm, 200), 종교: clean(it.relgnNm, 300), 기준환율: clean(it.critEhgt, 200), 정치: clean(it.poltcCntnt, max) };
    case "경제지표":
      return {
        단위: "명목GDP 십억$ · 1인당GDP $ · 성장률·물가상승률·실업률 % · 수출·수입·무역수지·외국인직접투자 백만$ · 환율 현지통화/US$",
        자료원: clean(it.mainInditArcv, 200),
        명목GDP: series(it.nmgdpList),
        "1인당GDP": series(it.gdpcpList),
        경제성장률: series(it.ecnmyGrwrtList),
        물가상승률: series(it.inflRateList),
        실업률: series(it.unempRateList),
        수출액: series(it.xportAmtList),
        수입액: series(it.imprtAmtList),
        무역수지: series(it.baltrList),
        외국인직접투자: series(it.drinvAmtList),
        환율: series(it.ehgtList),
      };
    case "경제동향":
      return { 경제개요: clean(it.ecnmyCntnt, max), 최근경제동향: clean(it.ecnmyTrendCntnt, max), 경제전망: clean(it.ecnmyPrsptCntnt, max) };
    case "시장특성":
      return { 시장특성: clean(it.mrktChrtrtCntnt, max), 소비성향: clean(it.cnsmpInclnCntnt, max), 소비인구: clean(it.cnsmpPoplCntnt, max), 한국상품이미지: clean(it.korCmmdtImageCntnt, max), 한류: clean(it.clturCntnt, max) };
    case "교역":
      return {
        자료원: clean(it.xportImprtTp10cArcvCntnt, 200),
        수출상위국: rows(it.xportTp10cList).map((r) => ({ 순위: str(r.inditSeq), 국가: str(r.crsjNatnNm), 연도: str(r.critYear), 금액_달러: num(r.inditValds) })),
        수입상위국: rows(it.imprtTp10cList).map((r) => ({ 순위: str(r.inditSeq), 국가: str(r.crsjNatnNm), 연도: str(r.critYear), 금액_달러: num(r.inditValds) })),
        수출상위품목: rows(it.tp10cXportCmdltList).map((r) => ({ 순위: str(r.inditSeq), HS: str(r.hsCd), 품목: clean(r.cmdltCntnt, 120), 연도: str(r.critYear), 금액_달러: num(r.inditValds) })),
        수입상위품목: rows(it.tp10cImprtCmdltList).map((r) => ({ 순위: str(r.inditSeq), HS: str(r.hsCd), 품목: clean(r.cmdltCntnt, 120), 연도: str(r.critYear), 금액_달러: num(r.inditValds) })),
      };
    case "한국과의교역":
      return {
        단위: clean(it.crsjUnit, 50) || "(금액 : 백만$)",
        자료원: [clean(it.korCrsjCmdltArcvCntnt, 100), clean(it.korCrsjCmdltArcvDt, 100)].filter(Boolean).join(" "),
        대한수출: series(it.crsjXportAmtList, "xportAmt"),
        대한수입: series(it.crsjImprtAmtList, "imprtAmt"),
        대한무역수지: series(it.crsjBaltrList, "baltrAmt"),
        한국의수출상위품목: rows(it.korTp10cXportCmdltList).map((r) => ({ 품목: str(r.cmdltNm), MTI: str(r.cmdltCd), 기간: str(r.yearTitl), 금액: num(r.xportAmt), 증감률: num(r.xportPcrate), 전년: num(r.yr1agXportAmt) })),
        한국의수입상위품목: rows(it.korTp10cImprtCmdltList).map((r) => ({ 품목: str(r.cmdltNm), MTI: str(r.cmdltCd), 기간: str(r.yearTitl), 금액: num(r.imprtAmt), 증감률: num(r.imprtPcrate), 전년: num(r.yr1agImprtAmt) })),
      };
    case "무역규제":
      return {
        관세제도: clean(it.tarifSystSumryCntnt, max),
        수입금지품목: clean(it.imprtPrhbtCmdltCntnt, max),
        인증제도: clean(it.crtfcSystCntnt, max),
        기술장벽: clean(it.tbtCntnt, max),
        한국산수입규제: rows(it.korImprtReglList).map((r) => ({ 규제: str(r.reglCn), 품목: str(r.cmdltName), HS: str(r.hscdCn).slice(0, 200), 대상국: str(r.probeTgtNatName), 결과: clean(r.lastRsltCn, 200) })),
        체결협정: rows(it.cnclsTrtyList).map((r) => ({ 협정: str(r.cnclsTrtyNm), 상대국: str(r.trtyCnclsNatnNm), 체결: str(r.trtyCnclsYmd), 발효: str(r.trtyEftaYmd) })),
      };
    case "진출기업":
      return { 진출한국기업: rows(it.korCompList).map((r) => ({ 기업: str(r.korCompNm), 모기업: str(r.pcompNm), 업종: str(r.indlnCntnt), 진출연도: str(r.acplcAdvncYear), 형태: str(r.acplcAdvncFormCntnt) })), 진출성공사례: clean(it.advncSucsCaseCntnt, max) };
    case "투자":
      return { 투자진출유의사항: clean(it.invtAdvncAtnotiCntnt, max), 외국인투자제도: clean(it.frgnrInvtRppcdCntnt, max), 투자제한업종: clean(it.lmttPrhbtIndlnCntnt, max), 경제특구: clean(it.sezTftaCntnt, max) };
    case "비즈니스관행":
      return { 상관행: clean(it.bizdlPrcstCntnt, max), 상담시유의사항: clean(it.cnsltClturPrcstCntnt, max), 물류: clean(it.lgistInfoCntnt, max), 지식재산권: clean(it.iprCntnt, max) };
  }
}

export async function kotraCountryInfo(p: KotraCountryParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<Record<string, unknown>>> {
  const g = gate(env, NATN_ID, "KOTRA 국가정보");
  if (g) return g;
  const cnty = p.cntyCd.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cnty)) return { ok: false, error: "cntyCd 는 ISO 2자리 국가코드입니다 (VN, US, CN, JP …)" };
  const sections = p.sections?.length ? p.sections : (["개요", "경제지표", "시장특성", "한국과의교역"] as KotraSection[]);
  const max = p.maxChars ?? 1200;
  const url = buildUrl(NATN_URL, { serviceKey: env.DATA_GO_KR_KEY, type: "json", isoWd2CntCd: cnty });
  const source = { 기관: "대한무역투자진흥공사(KOTRA)", 서비스: `대한무역투자진흥공사_국가정보 (data.go.kr ${NATN_ID})`, url: redactUrl(url) };
  const r = await callJson(fetchImpl, url);
  if ("error" in r) return { ok: false, error: r.error, hint: r.hint, source };
  const bad = headerError(r.doc);
  if (bad) return { ok: false, error: bad, source };
  const list = r.doc.response?.body?.itemList;
  const it = (list && typeof list === "object" ? (Array.isArray(list.item) ? list.item[0] : list.item) : undefined) as Record<string, unknown> | undefined;
  if (!it || !str(it.natnNm)) return { ok: false, error: `KOTRA 국가정보에 ${cnty} 자료가 없습니다`, hint: "국가코드를 확인하거나 KOTRA 해외시장뉴스를 WebFetch 하세요.", source };
  const data: Record<string, unknown> = {};
  for (const s of sections) data[s] = section(it, s, max);
  const 수정일 = str(it.updDt) || str(it.regDt);
  return {
    ok: true,
    source: { ...source, 기준시점: `KOTRA 국가정보 ${수정일 || "수정일 미상"} 갱신(지표별 기준연도는 값의 키)`, 비고: str(it.entpArcvCntnt) || undefined },
    data,
    note: "경제지표 값은 연도→값. 서술형 항목은 maxChars 에서 잘릴 수 있음(전문은 sections 를 하나만 지정해 maxChars 를 늘려 다시 조회)",
  };
}

export interface KotraPricesParams {
  /** ISO2 — 한 국가의 품목별 물가 */
  cntyCd?: string;
  /** 품목명 일부 — 이 품목을 국가 간 비교 (예: "빅맥", "최저임금", "아파트") */
  item?: string;
}

export interface KotraPriceRow {
  국가: string;
  국가코드: string;
  구분: string;
  품목: string;
  단위: string;
  금액_달러: number | null;
}

/** slot → rows, per process (the MCP server lives for one run; prices change yearly) */
const priceCache = new Map<number, KotraPriceRow[]>();
const MAX_SLOTS = 60;

async function priceSlot(seq: number, env: Env, fetchImpl: Fetcher): Promise<KotraPriceRow[] | { error: string; hint?: string }> {
  const hit = priceCache.get(seq);
  if (hit) return hit;
  const url = buildUrl(PRICE_URL, { serviceKey: env.DATA_GO_KR_KEY, type: "json", numOfRows: 300, pageNo: 1, prcsCritSeq: seq });
  const r = await callJson(fetchImpl, url);
  if ("error" in r) return r;
  const bad = headerError(r.doc);
  if (bad) return { error: bad };
  const list = r.doc.response?.body?.itemList;
  const items = list && typeof list === "object" ? list.item : undefined;
  const out = (Array.isArray(items) ? items : items ? [items] : []).map((x) => ({
    국가: str(x.untyNatName),
    국가코드: str(x.isoWd2NatCd),
    구분: str(x.cmdltSe),
    품목: str(x.cmdltNm),
    단위: str(x.unitNm),
    금액_달러: num(x.cmdltAmt),
  }));
  priceCache.set(seq, out);
  return out;
}

export async function kotraPrices(p: KotraPricesParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ rows: KotraPriceRow[]; count: number }>> {
  const g = gate(env, PRICE_ID, "KOTRA 국가별 물가정보");
  if (g) return g;
  const cnty = p.cntyCd?.trim().toUpperCase();
  const item = p.item?.trim();
  if (!cnty && !item) return { ok: false, error: "cntyCd(국가) 또는 item(품목명 일부) 중 하나는 필요합니다" };
  if (cnty && !/^[A-Z]{2}$/.test(cnty)) return { ok: false, error: "cntyCd 는 ISO 2자리 국가코드입니다 (VN, US …)" };
  const source = {
    기관: "대한무역투자진흥공사(KOTRA)",
    서비스: `대한무역투자진흥공사_국가별 물가정보 (data.go.kr ${PRICE_ID})`,
    url: redactUrl(buildUrl(PRICE_URL, { serviceKey: env.DATA_GO_KR_KEY, type: "json", numOfRows: 300, pageNo: 1 })),
    기준시점: "KOTRA 무역관 조사(연 1회 갱신, US$ 환산)",
    비고: "품목 칸 prcsCritSeq=1,2,… 를 빈 칸이 나올 때까지 반복 조회",
  };
  const rows: KotraPriceRow[] = [];
  const covered = new Map<string, string>();
  let empties = 0;
  for (let seq = 1; seq <= MAX_SLOTS && empties < 2; seq++) {
    const slot = await priceSlot(seq, env, fetchImpl);
    // a partial scan would read as "this country/item is not surveyed", so fail the whole call
    if ("error" in slot) return { ok: false, error: `${slot.error} (품목 칸 ${seq})`, hint: seq === 1 ? slot.hint : "일부 품목만 받은 상태라 결과를 쓰지 않았습니다. 이미 받은 칸은 캐시되므로 한 번 더 호출하면 이어서 조회합니다.", source };
    if (!slot.length) {
      empties++; // tolerate one retired slot number; two empty in a row ends the list
      continue;
    }
    empties = 0;
    for (const r of slot) {
      covered.set(r.국가코드, r.국가);
      if (cnty && r.국가코드 !== cnty) continue;
      if (item && !r.품목.includes(item)) continue;
      rows.push(r);
    }
  }
  if (cnty && !covered.has(cnty)) {
    return { ok: false, error: `KOTRA 물가정보는 ${covered.size}개국만 조사합니다 — ${cnty} 는 없음`, hint: `조사국: ${[...covered].map(([c, n]) => `${c} ${n}`).join(", ")}. 인접국과 비교하거나 KOTRA 해외시장뉴스를 WebFetch 하세요.`, source };
  }
  if (!rows.length) return { ok: false, error: `조건에 맞는 물가 자료가 없습니다 (${[cnty, item].filter(Boolean).join(", ")})`, hint: "품목명은 조사 무역관마다 표기가 다릅니다(예: '햄버거(맥도날드 빅맥)'). 더 짧은 단어로 다시 조회하거나 cntyCd 만 주세요.", source };
  return { ok: true, source, data: { rows, count: rows.length }, note: "같은 품목도 무역관마다 기준 상품·단위가 다를 수 있으니 국가 간 비교 시 품목·단위를 함께 적을 것" };
}

/** for tests */
export function clearKotraPriceCache(): void {
  priceCache.clear();
}
