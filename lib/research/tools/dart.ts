/**
 * 금융감독원 전자공시(OpenDART, opendart.fss.or.kr; crtfc_key = DART_KEY).
 *   dartCompany — 회사명 → 고유번호(corp_code) 찾기 + 기업개황(company.json)
 *   dartFinance — 단일회사 주요계정(fnlttSinglAcnt.json): 매출액·영업이익·당기순이익·자산·부채·자본, 3개년
 *
 * 회사명으로 찾으려면 전체 고유번호 목록(corpCode.xml, zip 약 3.6MB → XML 30MB, 약 11만 개사)이
 * 필요하다. 한 번 내려받아 DATA_DIR/mcp/dart-corps.json 에 줄여 저장하고 7일마다 갱신한다.
 * 응답 모양 확인 2026-11-10: status "000" 정상, "013" 조회된 데이타 없음, "010"·"011"·"012" 키 문제, "020" 한도 초과.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { buildUrl, getText, notConfigured, num, redactUrl, str, type Env, type Fetcher, type ToolResult } from "./http";

const BASE = "https://opendart.fss.or.kr/api";
const SOURCE_ORG = "금융감독원 전자공시시스템(DART)";

export interface DartCorp {
  /** 고유번호 8자리 */
  c: string;
  /** 회사명 */
  n: string;
  /** 종목코드(상장사만) */
  s: string;
}

/** 전체 고유번호 목록을 돌려준다. 시험에서는 고정 목록을 넣는다. */
export type CorpListLoader = (env: Env) => Promise<DartCorp[]>;

const CORP_TTL_MS = 7 * 24 * 3600 * 1000;
let memo: { at: number; list: DartCorp[] } | null = null;

export function parseCorpCodeXml(xml: string): DartCorp[] {
  const out: DartCorp[] = [];
  const re = /<list>\s*<corp_code>([^<]*)<\/corp_code>\s*<corp_name>([^<]*)<\/corp_name>[\s\S]*?<stock_code>([^<]*)<\/stock_code>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    out.push({ c: m[1].trim(), n: m[2].trim().replace(/&amp;/g, "&"), s: m[3].trim() });
  }
  return out;
}

export const defaultCorpListLoader: CorpListLoader = async (env) => {
  if (memo && Date.now() - memo.at < CORP_TTL_MS) return memo.list;
  const dir = path.resolve(env.DATA_DIR?.trim() || "data", "mcp");
  const file = path.join(dir, "dart-corps.json");
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < CORP_TTL_MS) {
    const list = JSON.parse(readFileSync(file, "utf8")) as DartCorp[];
    memo = { at: statSync(file).mtimeMs, list };
    return list;
  }
  const res = await fetch(buildUrl(`${BASE}/corpCode.xml`, { crtfc_key: env.DART_KEY }));
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    // zip 이 아니면 JSON/XML 오류 응답이다
    throw new Error(`DART 고유번호 목록을 받지 못했습니다: ${new TextDecoder().decode(buf.slice(0, 200))}`);
  }
  const files = unzipSync(buf);
  const xmlBytes = Object.values(files)[0];
  const list = parseCorpCodeXml(new TextDecoder("utf-8").decode(xmlBytes));
  if (!list.length) throw new Error("DART 고유번호 목록이 비어 있습니다");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(list));
  memo = { at: Date.now(), list };
  return list;
};

/** "(주)포스코퓨처엠" / "주식회사 포스코퓨처엠" / "포스코 퓨처엠" → "포스코퓨처엠" */
export function normalizeCorpName(s: string): string {
  return s
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(재\)|재단법인|\(사\)|사단법인/g, "")
    .replace(/[\s·.,]/g, "")
    .toLowerCase();
}

const CLS: Record<string, string> = { Y: "유가증권시장", K: "코스닥", N: "코넥스", E: "기타(비상장)" };

function dartError(status: string, message: string): { error: string; hint: string } {
  if (status === "013") return { error: `DART: 조회된 데이터가 없습니다 (${message})`, hint: "연도·보고서 종류를 바꾸거나(사업보고서가 아직 안 나온 해일 수 있다) 다른 출처를 쓰세요." };
  if (status === "020") return { error: `DART: 요청 한도 초과 (${message})`, hint: "오늘은 더 호출할 수 없습니다. 이미 받은 결과를 쓰세요." };
  if (["010", "011", "012", "901"].includes(status)) return { error: `DART: 인증키 문제 ${status} (${message})`, hint: "이 도구는 건너뛰고 다른 출처를 쓰세요." };
  return { error: `DART 오류 ${status} (${message})`, hint: "잠시 후 다시 시도하거나 다른 출처를 쓰세요." };
}

export interface DartCompanyParams {
  /** 회사명(일부도 가능) — corp_code 가 없을 때 */
  name?: string;
  /** 고유번호 8자리 */
  corp_code?: string;
  limit?: number;
}

export interface DartCompanyInfo {
  고유번호: string;
  회사명: string;
  영문명: string;
  종목코드: string;
  상장구분: string;
  대표자: string;
  법인등록번호: string;
  사업자등록번호: string;
  주소: string;
  홈페이지: string;
  업종코드: string;
  설립일: string;
  결산월: string;
}

export interface DartCompanyData {
  /** 이름으로 찾은 후보(최대 limit). corp_code 로 부르면 비어 있다 */
  후보: { 고유번호: string; 회사명: string; 종목코드: string }[];
  /** 후보가 하나로 좁혀졌거나 corp_code 로 불렀을 때의 기업개황 */
  개황?: DartCompanyInfo;
}

export async function dartCompany(p: DartCompanyParams, env: Env, fetchImpl: Fetcher, loadCorps: CorpListLoader = defaultCorpListLoader): Promise<ToolResult<DartCompanyData>> {
  if (!env.DART_KEY) return notConfigured("DART", "DART_KEY");
  const limit = Math.min(Math.max(1, p.limit ?? 10), 30);
  let code = p.corp_code?.trim();
  const 후보: DartCompanyData["후보"] = [];
  if (!code) {
    const q = normalizeCorpName(p.name ?? "");
    if (!q) return { ok: false, error: "name 또는 corp_code 가 필요합니다" };
    const list = await loadCorps(env);
    const exact = list.filter((x) => normalizeCorpName(x.n) === q);
    const partial = list.filter((x) => normalizeCorpName(x.n) !== q && normalizeCorpName(x.n).includes(q));
    // 상장사를 앞으로 — 같은 이름의 휴면 법인보다 공시가 많은 쪽이 대개 찾는 회사다
    const byListed = (a: DartCorp, b: DartCorp) => Number(!!b.s) - Number(!!a.s);
    const hits = [...exact.sort(byListed), ...partial.sort(byListed)];
    for (const h of hits.slice(0, limit)) 후보.push({ 고유번호: h.c, 회사명: h.n, 종목코드: h.s });
    if (!hits.length) return { ok: false, error: `DART 에 "${p.name}" 회사가 없습니다`, hint: "DART 는 공시 의무가 있는 회사(상장사·외부감사 대상 등)만 담고 있다. 이름을 줄여 다시 찾거나 다른 출처를 쓰세요." };
    // 정확히 같은 이름이 하나뿐이면 개황까지 바로 가져온다
    if (exact.length === 1 || hits.length === 1) code = (exact[0] ?? hits[0]).c;
  }
  const source = { 기관: SOURCE_ORG, 서비스: "OpenDART 기업개황", url: "" };
  if (!code) {
    return { ok: true, source: { ...source, url: `${BASE}/corpCode.xml` }, data: { 후보 }, note: "후보가 여럿이다. 맞는 회사의 고유번호로 corp_code 를 주어 다시 부르면 기업개황이 나온다." };
  }
  const url = buildUrl(`${BASE}/company.json`, { crtfc_key: env.DART_KEY, corp_code: code });
  source.url = redactUrl(url);
  const { text } = await getText(fetchImpl, url);
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: `DART 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`, source };
  }
  const status = str(doc.status);
  if (status !== "000") return { ok: false, ...dartError(status, str(doc.message)), source };
  const 개황: DartCompanyInfo = {
    고유번호: str(doc.corp_code),
    회사명: str(doc.corp_name),
    영문명: str(doc.corp_name_eng),
    종목코드: str(doc.stock_code),
    상장구분: CLS[str(doc.corp_cls)] ?? str(doc.corp_cls),
    대표자: str(doc.ceo_nm),
    법인등록번호: str(doc.jurir_no),
    사업자등록번호: str(doc.bizr_no),
    주소: str(doc.adres).replace(/\s+/g, " "),
    홈페이지: str(doc.hm_url),
    업종코드: str(doc.induty_code),
    설립일: str(doc.est_dt),
    결산월: str(doc.acc_mt),
  };
  return { ok: true, source, data: { 후보, 개황 }, note: "재무는 dart_finance(corp_code, year) 로 조회" };
}

export const DART_REPORTS = { annual: "11011", half: "11012", q1: "11013", q3: "11014" } as const;
export type DartReport = keyof typeof DART_REPORTS;
const REPORT_NAME: Record<DartReport, string> = { annual: "사업보고서", half: "반기보고서", q1: "1분기보고서", q3: "3분기보고서" };

export interface DartFinanceParams {
  corp_code: string;
  /** 사업연도 YYYY */
  year: string;
  report?: DartReport;
  /** CFS 연결 / OFS 별도. 생략하면 연결이 있으면 연결, 없으면 별도 */
  fs?: "CFS" | "OFS";
}

export interface DartFinanceRow {
  재무제표: string;
  구분: string;
  계정: string;
  당기: number | null;
  전기: number | null;
  전전기: number | null;
}

export interface DartFinanceData {
  회사명?: string;
  보고서: string;
  기준: { 당기: string; 전기: string; 전전기: string };
  단위: string;
  행: DartFinanceRow[];
}

export async function dartFinance(p: DartFinanceParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<DartFinanceData>> {
  if (!env.DART_KEY) return notConfigured("DART", "DART_KEY");
  if (!/^\d{8}$/.test(p.corp_code ?? "")) return { ok: false, error: "corp_code(8자리)가 필요합니다 — dart_company 로 먼저 찾으세요" };
  if (!/^\d{4}$/.test(p.year ?? "")) return { ok: false, error: "year 는 YYYY 입니다" };
  const report = p.report ?? "annual";
  const url = buildUrl(`${BASE}/fnlttSinglAcnt.json`, { crtfc_key: env.DART_KEY, corp_code: p.corp_code, bsns_year: p.year, reprt_code: DART_REPORTS[report] });
  const source = { 기관: SOURCE_ORG, 서비스: `OpenDART 단일회사 주요계정 (${p.year}년 ${REPORT_NAME[report]})`, url: redactUrl(url) };
  const { text } = await getText(fetchImpl, url);
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: `DART 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`, source };
  }
  const status = str(doc.status);
  if (status !== "000") return { ok: false, ...dartError(status, str(doc.message)), source };
  const all = (Array.isArray(doc.list) ? doc.list : []) as Record<string, unknown>[];
  const want = p.fs ?? (all.some((r) => str(r.fs_div) === "CFS") ? "CFS" : "OFS");
  const rows = all.filter((r) => str(r.fs_div) === want);
  if (!rows.length) return { ok: false, error: `${want === "CFS" ? "연결" : "별도"}재무제표 항목이 없습니다`, hint: `fs 를 ${want === "CFS" ? "OFS" : "CFS"} 로 바꿔 보세요.`, source };
  const first = rows[0];
  const data: DartFinanceData = {
    보고서: `${p.year}년 ${REPORT_NAME[report]}`,
    기준: { 당기: str(first.thstrm_dt), 전기: str(first.frmtrm_dt), 전전기: str(first.bfefrmtrm_dt) },
    단위: `원(${str(first.currency) || "KRW"})`,
    행: rows.map((r) => ({ 재무제표: str(r.fs_nm), 구분: str(r.sj_nm), 계정: str(r.account_nm), 당기: num(r.thstrm_amount), 전기: num(r.frmtrm_amount), 전전기: num(r.bfefrmtrm_amount) })),
  };
  return { ok: true, source: { ...source, 기준시점: data.기준.당기 }, data, note: "금액 단위는 원. 보고서에는 억원·백만원으로 바꿔 쓰고 기준일을 밝힌다." };
}
