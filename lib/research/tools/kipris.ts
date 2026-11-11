/**
 * 특허청 KIPRIS Plus 특허·실용신안 검색 (plus.kipris.or.kr; ServiceKey = KIPRIS_API_KEY).
 *   kiprisSearch — 낱말(getWordSearch) 또는 출원인·발명명칭·출원기간(getAdvancedSearch)으로 찾고 총 건수를 센다
 * 응답 모양 확인 2026-11-10: XML. header.successYN Y/N·resultCode·resultMsg, body.items.item[],
 * count.totalCount. 출원기간은 applicationDate=YYYYMMDD~YYYYMMDD. 키 오류는 resultCode 30.
 */
import { asArray, buildUrl, getText, notConfigured, parseXml, redactUrl, str, type Env, type Fetcher, type ToolResult } from "./http";

const BASE = "http://plus.kipris.or.kr/kipo-api/kipi/patUtiModInfoSearchSevice";

export interface KiprisSearchParams {
  /** 자유 낱말(초록·명칭 전체에서) */
  word?: string;
  /** 출원인 이름(일부) */
  applicant?: string;
  /** 발명의 명칭에 들어가는 낱말 */
  title?: string;
  /** 출원일 범위 YYYYMMDD */
  from?: string;
  to?: string;
  /** 특허만(실용신안 제외) */
  patentOnly?: boolean;
  limit?: number;
}

export interface KiprisItem {
  출원인: string;
  발명명칭: string;
  출원번호: string;
  출원일: string;
  상태: string;
  등록번호: string;
  등록일: string;
  IPC: string;
}

export async function kiprisSearch(p: KiprisSearchParams, env: Env, fetchImpl: Fetcher): Promise<ToolResult<{ 총건수: number; 항목: KiprisItem[] }>> {
  if (!env.KIPRIS_API_KEY) return notConfigured("KIPRIS", "KIPRIS_API_KEY");
  const limit = Math.min(Math.max(1, p.limit ?? 10), 50);
  const advanced = !!(p.applicant?.trim() || p.title?.trim() || p.from || p.to);
  if (!advanced && !p.word?.trim()) return { ok: false, error: "word, applicant, title 중 하나는 있어야 합니다" };
  const range = p.from || p.to ? `${p.from ?? "19000101"}~${p.to ?? "29991231"}` : undefined;
  const url = advanced
    ? buildUrl(`${BASE}/getAdvancedSearch`, {
        astrtCont: p.word?.trim(),
        applicant: p.applicant?.trim(),
        inventionTitle: p.title?.trim(),
        applicationDate: range,
        patent: "true",
        utility: p.patentOnly ? "false" : "true",
        numOfRows: limit,
        pageNo: 1,
        ServiceKey: env.KIPRIS_API_KEY,
      })
    : buildUrl(`${BASE}/getWordSearch`, { word: p.word!.trim(), year: "0", patent: "true", utility: p.patentOnly ? "false" : "true", numOfRows: limit, pageNo: 1, ServiceKey: env.KIPRIS_API_KEY });
  const source = { 기관: "특허청 KIPRIS Plus", 서비스: `특허·실용신안 ${advanced ? "상세" : "낱말"} 검색`, url: redactUrl(url) };
  const { text } = await getText(fetchImpl, url);
  const doc = parseXml(text) as Record<string, unknown>;
  const res = (doc.response ?? {}) as Record<string, unknown>;
  const head = (res.header ?? {}) as Record<string, unknown>;
  if (str(head.successYN) !== "Y") {
    const code = str(head.resultCode);
    const msg = str(head.resultMsg) || text.slice(0, 120);
    return { ok: false, error: `KIPRIS 오류 ${code} (${msg})`, hint: code === "30" ? "인증키가 등록되지 않았습니다. 이 도구는 건너뛰세요." : "검색 조건을 바꾸거나 다른 출처를 쓰세요.", source };
  }
  const body = (res.body ?? {}) as Record<string, unknown>;
  const raw = asArray(((body.items as Record<string, unknown> | undefined)?.item ?? []) as Record<string, unknown> | Record<string, unknown>[]);
  const 총건수 = Number(str(((res.count ?? {}) as Record<string, unknown>).totalCount)) || raw.length;
  const 항목 = raw.map((r) => ({
    출원인: str(r.applicantName),
    발명명칭: str(r.inventionTitle),
    출원번호: str(r.applicationNumber),
    출원일: str(r.applicationDate),
    상태: str(r.registerStatus),
    등록번호: str(r.registerNumber),
    등록일: str(r.registerDate),
    IPC: str(r.ipcNumber),
  }));
  return { ok: true, source: { ...source, 기준시점: `조회 ${new Date().toISOString().slice(0, 10)}` }, data: { 총건수, 항목 }, note: "총건수는 조건에 맞는 출원 전체(특허+실용신안, patentOnly 면 특허만)다. 출원인 이름은 부분 일치라 비슷한 이름의 다른 회사가 섞일 수 있으니 항목의 출원인을 확인한다." };
}
