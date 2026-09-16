/**
 * 관세청 수출입실적 (data.go.kr, 4 services). All share the `strtYymm/endYymm` window and the
 * `response.body.items.item[]` XML shape; amounts are in thousand USD (천 달러) — the API
 * returns them with thousands separators and padding.
 *
 *   sido        15101643  getSidotradeList            (sidoCd optional; 47 = 경상북도)
 *   sigungu     15134343  getSigunguPerPrlstPerAcrs   (sidoCd + HsSgn 6자리 필수)
 *   nation      15101612  getNationtradeList          (cntyCd, e.g. US)
 *   item_nation 15100475  getNitemtradeList           (cntyCd + hsSgn 2/4/6/10자리)
 */
import { callableDataGoKrServices } from "../dataSources";
import { asArray, buildUrl, dataGoKrEnvelopeError, getText, num, parseXml, redactUrl, str, type Env, type Fetcher, type ToolResult } from "./http";

export type CustomsKind = "sido" | "sigungu" | "nation" | "item_nation";

export interface CustomsParams {
  kind: CustomsKind;
  /** YYYYMM */
  strtYymm: string;
  /** YYYYMM */
  endYymm: string;
  /** 시도 코드 (경상북도 47, 대구 27 …) — sido/sigungu */
  sidoCd?: string;
  /** HS 코드 — sigungu: 6자리 필수; item_nation: 2/4/6/10자리 */
  hsSgn?: string;
  /** 국가 코드 ISO2 (US, CN, JP, VN …) — nation/item_nation */
  cntyCd?: string;
}

export interface CustomsRow {
  기간: string;
  구분: string;
  hs?: string;
  품목명?: string;
  수출건수: number | null;
  수출금액_천달러: number | null;
  수입건수: number | null;
  수입금액_천달러: number | null;
  무역수지_천달러: number | null;
}

const SERVICES: Record<CustomsKind, { id: string; path: string; name: string }> = {
  sido: { id: "15101643", path: "sidotrade/getSidotradeList", name: "관세청_시도별 수출입실적" },
  sigungu: { id: "15134343", path: "sigunguperprlstperacrs/getSigunguPerPrlstPerAcrs", name: "관세청_시군구별 품목별 수출입실적" },
  nation: { id: "15101612", path: "nationtrade/getNationtradeList", name: "관세청_국가별 수출입실적" },
  item_nation: { id: "15100475", path: "nitemtrade/getNitemtradeList", name: "관세청_품목별 국가별 수출입실적" },
};

const BASE = "http://apis.data.go.kr/1220000/";

export const SIDO_CODES: Record<string, string> = {
  서울: "11", 부산: "26", 대구: "27", 인천: "28", 광주: "29", 대전: "30", 울산: "31", 세종: "36",
  경기: "41", 강원: "42", 충북: "43", 충남: "44", 전북: "45", 전남: "46", 경북: "47", 경남: "48", 제주: "50",
  전남광주통합: "12",
};

/** months between two YYYYMM values, inclusive */
function monthsSpan(a: string, b: string): number {
  const ya = Number(a.slice(0, 4)), ma = Number(a.slice(4));
  const yb = Number(b.slice(0, 4)), mb = Number(b.slice(4));
  return (yb - ya) * 12 + (mb - ma) + 1;
}

function validate(p: CustomsParams): string | null {
  if (!/^\d{6}$/.test(p.strtYymm) || !/^\d{6}$/.test(p.endYymm)) return "strtYymm/endYymm 은 YYYYMM 6자리";
  const span = monthsSpan(p.strtYymm, p.endYymm);
  if (span < 1) return "endYymm 이 strtYymm 보다 앞섭니다";
  if (span > 12) return `관세청 API 는 조회기간 1년(12개월) 이내만 허용합니다 (요청: ${span}개월). 연도별로 나눠 호출하세요 (예: 202301~202312, 202401~202412)`;
  if (p.kind === "sigungu") {
    if (!p.sidoCd) return "sigungu 에는 sidoCd 가 필요합니다 (경상북도 47)";
    if (!p.hsSgn || !/^\d{6}$/.test(p.hsSgn)) return "sigungu 에는 HS 6자리(hsSgn)가 필수입니다 (2·4자리는 거부됨)";
  }
  if ((p.kind === "nation" || p.kind === "item_nation") && !p.cntyCd) return `${p.kind} 에는 cntyCd(ISO2, 예: US) 가 필요합니다`;
  if (p.kind === "item_nation" && !p.hsSgn) return "item_nation 에는 hsSgn(2/4/6/10자리) 가 필요합니다";
  return null;
}

function toRow(kind: CustomsKind, it: Record<string, unknown>): CustomsRow {
  const 구분 = kind === "sido" ? str(it.sidoNm) : kind === "sigungu" ? str(it.sggNm) : str(it.statCdCntnKor1) || str(it.statCd);
  return {
    기간: str(it.priodTitle) || str(it.year),
    구분,
    ...(it.hsSgn || it.hsCd ? { hs: str(it.hsSgn) || str(it.hsCd) } : {}),
    ...(it.korePrlstNm || it.statKor ? { 품목명: str(it.korePrlstNm) || str(it.statKor) } : {}),
    수출건수: num(it.expCnt),
    수출금액_천달러: num(it.expUsdAmt ?? it.expDlr),
    수입건수: num(it.impCnt),
    수입금액_천달러: num(it.impUsdAmt ?? it.impDlr),
    무역수지_천달러: num(it.cmtrBlncAmt ?? it.balPayments),
  };
}

export async function customsTrade(p: CustomsParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ rows: CustomsRow[]; count: number }>> {
  const svc = SERVICES[p.kind];
  if (!svc) return { ok: false, error: `알 수 없는 kind: ${String(p.kind)}` };
  const bad = validate(p);
  if (bad) return { ok: false, error: bad };
  if (!env.DATA_GO_KR_KEY) return { ok: false, error: "data.go.kr 인증키가 설정되지 않았습니다 (DATA_GO_KR_KEY)", hint: "이 도구는 사용할 수 없습니다." };
  if (!callableDataGoKrServices(env).some((s) => s.id === svc.id)) {
    return { ok: false, error: `${svc.name}(${svc.id}) 은 DATA_GO_KR_SERVICES 에 등록되지 않았습니다`, hint: "운영자가 활용신청 후 .env 의 DATA_GO_KR_SERVICES 에 id를 추가해야 합니다. 다른 출처를 쓰세요." };
  }
  const params: Record<string, string | undefined> = { serviceKey: env.DATA_GO_KR_KEY, strtYymm: p.strtYymm, endYymm: p.endYymm };
  if (p.kind === "sido") params.sidoCd = p.sidoCd;
  if (p.kind === "sigungu") {
    params.sidoCd = p.sidoCd;
    params.HsSgn = p.hsSgn;
  }
  if (p.kind === "nation") params.cntyCd = p.cntyCd;
  if (p.kind === "item_nation") {
    params.cntyCd = p.cntyCd;
    params.hsSgn = p.hsSgn;
  }
  const url = buildUrl(BASE + svc.path, params);
  const source = { 기관: "관세청", 서비스: `${svc.name} (data.go.kr ${svc.id})`, url: redactUrl(url), 기준시점: `${p.strtYymm}~${p.endYymm} 수출입신고 기준(수출 FOB·수입 CIF, 천 달러)` };
  const { text } = await getText(fetchImpl, url);
  const envelope = dataGoKrEnvelopeError(text);
  if (envelope) return { ok: false, error: envelope.error, hint: envelope.hint, source };
  const doc = parseXml(text) as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: unknown } } } };
  const code = str(doc.response?.header?.resultCode);
  if (code !== "00") return { ok: false, error: `관세청 API 응답 ${code}: ${str(doc.response?.header?.resultMsg)}`, source };
  const items = asArray(doc.response?.body?.items?.item as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const rows = items.map((it) => toRow(p.kind, it));
  return { ok: true, source, data: { rows, count: rows.length }, note: rows.some((r) => r.기간 === "총계") ? "첫 행 '총계'는 조회 기간 합계" : undefined };
}
