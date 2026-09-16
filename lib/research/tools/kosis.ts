/**
 * KOSIS 공유서비스 (kosis.kr/openapi). Two calls cover the research needs:
 *   kosisSearch  — statisticsSearch.do  통합검색 → 통계표 id (orgId + tblId)
 *   kosisTable   — Param/statisticsParameterData.do getList → rows of one table for a period,
 *                  optionally filtered by classification name (e.g. "경상북도", "포항시")
 * Tables can be huge (every 시군구 × item × year); the tool applies the name filter server-side
 * (in this process) and caps the rows it returns, reporting the total it saw.
 */
import { buildUrl, getText, notConfigured, num, redactUrl, str, type Env, type Fetcher, type ToolResult } from "./http";

const SEARCH = "https://kosis.kr/openapi/statisticsSearch.do";
const DATA = "https://kosis.kr/openapi/Param/statisticsParameterData.do";

export interface KosisSearchParams {
  query: string;
  limit?: number;
}

export interface KosisTableHit {
  orgId: string;
  tblId: string;
  통계표: string;
  통계명: string;
  분류경로: string;
  내용: string;
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // KOSIS error bodies are JS-ish: {err:"20",errMsg:"…"}
    const m = /err\s*:\s*"?(\d+)"?\s*,\s*errMsg\s*:\s*"([^"]*)"/.exec(text);
    if (m) return { err: m[1], errMsg: m[2] };
    return null;
  }
}

export async function kosisSearch(p: KosisSearchParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ tables: KosisTableHit[] }>> {
  if (!env.KOSIS_KEY) return notConfigured("KOSIS", "KOSIS_KEY");
  if (!p.query.trim()) return { ok: false, error: "query 가 비어 있습니다" };
  const url = buildUrl(SEARCH, { method: "getList", apiKey: env.KOSIS_KEY, searchNm: p.query.trim(), format: "json", jsonVD: "Y" });
  const source = { 기관: "국가데이터처 KOSIS", 서비스: "KOSIS 공유서비스 통합검색", url: redactUrl(url) };
  const { text } = await getText(fetchImpl, url);
  const doc = parseJsonLoose(text);
  if (!doc) return { ok: false, error: `KOSIS 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`, source };
  if (!Array.isArray(doc)) {
    const e = doc as { err?: string; errMsg?: string };
    // err 30 = no table matched the query: an empty result, not a failure
    if (str(e.err) === "30") return { ok: true, source, data: { tables: [] }, note: "검색 결과 없음. 더 짧은 핵심어(예: '사업체수', '고령인구')로 다시 검색" };
    return { ok: false, error: `KOSIS 오류 ${str(e.err)}: ${str(e.errMsg)}`, source };
  }
  const limit = Math.min(Math.max(1, p.limit ?? 15), 50);
  const tables = (doc as Record<string, unknown>[]).slice(0, limit).map((r) => ({
    orgId: str(r.ORG_ID),
    tblId: str(r.TBL_ID),
    통계표: str(r.TBL_NM),
    통계명: str(r.STAT_NM),
    분류경로: str(r.MT_ATITLE),
    내용: str(r.CONTENTS).slice(0, 200),
  }));
  return { ok: true, source, data: { tables }, note: "다음 단계: kosis_table(orgId, tblId, prdSe, startPrdDe, endPrdDe, nameFilter)" };
}

export interface KosisTableParams {
  orgId: string;
  tblId: string;
  /** 주기: Y 연, Q 분기, M 월, H 반기 */
  prdSe: "Y" | "Q" | "M" | "H";
  /** 시작 시점 (Y: 2022, M: 202401, Q: 20241 …) */
  startPrdDe: string;
  endPrdDe: string;
  /**
   * 분류(행정구역 등) 이름에 포함될 문자열 (공백 = AND). KOSIS 는 시군 이름을 도 이름 없이
   * 적으므로("포항시", "의성군") 시군은 이름만 준다.
   */
  nameFilter?: string;
  /** 분류1 코드 접두 — 예: 통계청 행정구역 코드 "37" = 경상북도의 모든 시군 (행안부 47 과 다름) */
  codePrefix?: string;
  /** 항목 id (기본 ALL) */
  itmId?: string;
  /** 분류1 코드 (기본 ALL) */
  objL1?: string;
  /** 분류2·3 코드 — 표에 그 분류가 있을 때만 ("ALL" 가능); 없는 표에 보내면 오류 */
  objL2?: string;
  objL3?: string;
  /** 최대 반환 행 (기본 200, 최대 1000) */
  limit?: number;
}

export interface KosisRow {
  시점: string;
  분류: string;
  분류코드: string;
  항목: string;
  값: number | null;
  단위: string;
}

export async function kosisTable(p: KosisTableParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ 통계표: string; rows: KosisRow[]; returned: number; total: number; 최종갱신?: string }>> {
  if (!env.KOSIS_KEY) return notConfigured("KOSIS", "KOSIS_KEY");
  if (!p.orgId || !p.tblId) return { ok: false, error: "orgId, tblId 가 필요합니다 (kosis_search 결과)" };
  const url = buildUrl(DATA, {
    method: "getList",
    apiKey: env.KOSIS_KEY,
    orgId: p.orgId,
    tblId: p.tblId,
    itmId: p.itmId ?? "ALL",
    objL1: p.objL1 ?? "ALL",
    // objL2/objL3 only when the caller knows the table has them (sending them to a 1-level table errors)
    objL2: p.objL2,
    objL3: p.objL3,
    prdSe: p.prdSe,
    startPrdDe: p.startPrdDe,
    endPrdDe: p.endPrdDe,
    format: "json",
    jsonVD: "Y",
  });
  const source = { 기관: "국가데이터처 KOSIS", 서비스: `KOSIS 통계자료 ${p.orgId}/${p.tblId}`, url: redactUrl(url), 기준시점: `${p.startPrdDe}~${p.endPrdDe} (${p.prdSe})` };
  const { text } = await getText(fetchImpl, url);
  const doc = parseJsonLoose(text);
  if (!doc) return { ok: false, error: `KOSIS 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`, source };
  if (!Array.isArray(doc)) {
    const e = doc as { err?: string; errMsg?: string };
    const msg = str(e.errMsg);
    const hint = /40,?000|셀/.test(msg)
      ? "결과가 40,000셀을 넘습니다. 기간(startPrdDe~endPrdDe)을 줄이거나 itmId 로 항목 하나만, objL1 에 지역 코드(예: 경북 37)를 지정해 다시 조회하세요."
      : e.err === "30" || e.err === "31"
        ? "분류(objL) 조합이 표와 맞지 않습니다. objL1..3 을 ALL 로 두고 nameFilter 로 거르세요."
        : undefined;
    return { ok: false, error: `KOSIS 오류 ${str(e.err)}: ${msg}`, source, hint };
  }
  const all = doc as Record<string, unknown>[];
  const words = (p.nameFilter ?? "").split(/\s+/).map((w) => w.trim()).filter(Boolean);
  const label = (r: Record<string, unknown>) => [r.C1_NM, r.C2_NM, r.C3_NM, r.C4_NM].map(str).filter(Boolean).join(" > ");
  const byPrefix = p.codePrefix ? all.filter((r) => str(r.C1).startsWith(p.codePrefix!)) : all;
  const filtered = words.length ? byPrefix.filter((r) => words.every((w) => label(r).includes(w) || str(r.ITM_NM).includes(w))) : byPrefix;
  const limit = Math.min(Math.max(1, p.limit ?? 200), 1000);
  const rows: KosisRow[] = filtered.slice(0, limit).map((r) => ({
    시점: str(r.PRD_DE),
    분류: label(r),
    분류코드: [r.C1, r.C2, r.C3, r.C4].map(str).filter(Boolean).join("/"),
    항목: str(r.ITM_NM).replace(/＜br＞|<br>/g, " "),
    값: num(r.DT),
    단위: str(r.UNIT_NM),
  }));
  return {
    ok: true,
    source,
    data: { 통계표: str(all[0]?.TBL_NM), rows, returned: rows.length, total: filtered.length, 최종갱신: str(all[0]?.LST_CHN_DE) || undefined },
    note: filtered.length > rows.length ? `행이 ${filtered.length}개라 ${rows.length}개만 반환. nameFilter 를 더 좁히세요.` : undefined,
  };
}
