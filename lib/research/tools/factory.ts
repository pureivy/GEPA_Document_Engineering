/**
 * 한국산업단지공단 공장등록 생산정보 (data.go.kr 15087611, base …/B550624/fctryRegistInfo, FactoryOn).
 * Two lookups the research stage uses: every registered factory in an 산업단지 (partial name
 * match — "구미" also hits 구미 농공단지) and a company-name search. `totalCount` gives the
 * 모수 (e.g. 구미국가산업단지 3,259개); rows show 업종·주생산품·고용인원 for examples.
 * Note: the 회사명 operation lists `fctryManageNo` as required but answers without it; `adres`
 * alone is rejected and is ignored as a filter, so it is not offered.
 */
import { callableDataGoKrServices } from "../dataSources";
import { asArray, buildUrl, dataGoKrEnvelopeError, getText, num, parseXml, redactUrl, str, type Env, type Fetcher, type ToolResult } from "./http";

const SERVICE_ID = "15087611";
const BASE = "http://apis.data.go.kr/B550624/fctryRegistInfo/";

export interface FactorySearchParams {
  /** 산업단지명(부분 일치): "구미국가산업단지", "포항철강", "안동" … */
  irsttNm?: string;
  /** 회사명(부분 일치) */
  cmpnyNm?: string;
  /** 반환할 공장 수 (기본 10, 최대 100) — 총수는 항상 totalCount */
  limit?: number;
  pageNo?: number;
}

export interface FactoryRow {
  회사명: string;
  주소: string;
  산업단지: string;
  업종: string;
  대표업종코드: string;
  주생산품: string;
  고용인원: number | null;
  공장등록일: string;
  관리기관: string;
}

export async function factorySearch(p: FactorySearchParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ totalCount: number; rows: FactoryRow[] }>> {
  if (!env.DATA_GO_KR_KEY) return { ok: false, error: "data.go.kr 인증키가 설정되지 않았습니다 (DATA_GO_KR_KEY)", hint: "이 도구는 사용할 수 없습니다." };
  if (!callableDataGoKrServices(env).some((s) => s.id === SERVICE_ID)) return { ok: false, error: `공장등록생산정보 API(${SERVICE_ID}) 가 DATA_GO_KR_SERVICES 에 없습니다`, hint: "다른 출처를 쓰세요." };
  const irstt = p.irsttNm?.trim();
  const cmpny = p.cmpnyNm?.trim();
  if (!irstt === !cmpny) return { ok: false, error: "irsttNm(산업단지명) 과 cmpnyNm(회사명) 중 정확히 하나를 주세요" };
  const numOfRows = Math.min(Math.max(p.limit ?? 10, 1), 100);
  const url = irstt
    ? buildUrl(BASE + "getFctryListInIrsttService_v2", { serviceKey: env.DATA_GO_KR_KEY, irsttNm: irstt, numOfRows, pageNo: p.pageNo ?? 1 })
    : buildUrl(BASE + "getFctryPrdctnService_v2", { serviceKey: env.DATA_GO_KR_KEY, cmpnyNm: cmpny, numOfRows, pageNo: p.pageNo ?? 1 });
  const source = { 기관: "한국산업단지공단", 서비스: `한국산업단지공단_공장등록생산정보조회서비스 (data.go.kr ${SERVICE_ID})`, url: redactUrl(url), 기준시점: "팩토리온 공장등록 DB(실시간)" };
  const { text } = await getText(fetchImpl, url);
  const envelope = dataGoKrEnvelopeError(text);
  if (envelope) return { ok: false, error: envelope.error, hint: envelope.hint, source };
  const doc = parseXml(text) as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: unknown } | ""; totalCount?: string } } };
  const code = str(doc.response?.header?.resultCode);
  if (code === "03") return { ok: true, source, data: { totalCount: 0, rows: [] }, note: "일치하는 공장 없음" };
  if (code !== "00") return { ok: false, error: `공장등록정보 API ${code}: ${str(doc.response?.header?.resultMsg)}`, source };
  const body = doc.response?.body;
  const items = asArray((body?.items && typeof body.items === "object" ? body.items.item : undefined) as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const rows = items.map((it) => ({
    회사명: str(it.cmpnyNm),
    주소: str(it.rnAdres),
    산업단지: str(it.irsttNm),
    업종: str(it.indutyNm),
    대표업종코드: str(it.rprsntvIndutyCode),
    주생산품: str(it.mainProductCn),
    고용인원: num(it.allEmplyCo),
    공장등록일: str(it.frstFctryRegistDe),
    관리기관: str(it.cvplChrgOrgnztNm),
  }));
  return {
    ok: true,
    source,
    data: { totalCount: num(body?.totalCount) ?? rows.length, rows },
    note: irstt ? "산업단지명은 부분 일치(예: '구미'는 구미국가산업단지와 구미 농공단지 모두) — 특정 단지 수는 정식 명칭으로 조회. 대표자·연락처는 개인정보이므로 문서에 옮기지 않는다" : "대표자·연락처는 개인정보이므로 문서에 옮기지 않는다",
  };
}
