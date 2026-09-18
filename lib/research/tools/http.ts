/**
 * Shared plumbing for the public-data tool handlers: a fetch abstraction (so tests inject
 * fixtures), XML → object parsing, data.go.kr's common error envelope, and the result shape
 * every tool returns. Results are plain JSON; the MCP layer stringifies them.
 */
import { XMLParser } from "fast-xml-parser";

export type Fetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type Env = Record<string, string | undefined>;

/** provenance the agent copies into sources.json */
export interface ToolSource {
  기관: string;
  서비스: string;
  /** the request URL with the key removed — citable and reproducible */
  url: string;
  기준시점?: string;
  비고?: string;
}

export type ToolResult<T> =
  | { ok: true; source: ToolSource; data: T; note?: string }
  | { ok: false; error: string; hint?: string; source?: ToolSource };

export const KEY_PARAMS = ["serviceKey", "ServiceKey", "apiKey", "crtfcKey", "OC"] as const;

/** Build a URL; `params` values are encoded, undefined/empty skipped. */
export function buildUrl(base: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** The same URL with credential parameters blanked, for provenance. */
export function redactUrl(url: string): string {
  const u = new URL(url);
  for (const k of KEY_PARAMS) if (u.searchParams.has(k)) u.searchParams.set(k, "***");
  return u.toString();
}

export async function getText(fetchImpl: Fetcher, url: string): Promise<{ status: number; text: string }> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json, application/xml;q=0.9, */*;q=0.8" } });
  const text = await res.text();
  return { status: res.status, text };
}

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

export function parseXml(text: string): unknown {
  return xml.parse(text);
}

/** "  3,631,968" → 3631968; "-" / "" → null */
export function num(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\s,]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * data.go.kr wraps auth/quota failures in `OpenAPI_ServiceResponse.cmmMsgHeader` (XML or JSON)
 * regardless of the service. Map the codes the research agent must react to differently.
 */
export function dataGoKrEnvelopeError(text: string): { code: string; error: string; hint: string } | null {
  const m = /returnReasonCode>\s*(\d+)\s*<|"returnReasonCode"\s*:\s*"?(\d+)/.exec(text);
  if (!m || !/OpenAPI_ServiceResponse/.test(text)) return null;
  const code = m[1] ?? m[2];
  const msg = /returnAuthMsg>([^<]*)<|"returnAuthMsg"\s*:\s*"([^"]*)"/.exec(text);
  const authMsg = (msg?.[1] ?? msg?.[2] ?? "").trim();
  switch (code) {
    case "30":
      return { code, error: `data.go.kr: 이 서비스에 등록되지 않은 인증키 (${authMsg})`, hint: "활용신청이 아직 반영되지 않았거나(최대 1시간) 신청하지 않은 서비스입니다. 이 도구는 건너뛰고 다른 출처를 쓰세요." };
    case "22":
      return { code, error: `data.go.kr: 일일 트래픽 초과 (${authMsg})`, hint: "오늘은 이 서비스를 더 호출할 수 없습니다. 이미 받은 결과를 쓰거나 다른 출처를 쓰세요." };
    case "31":
      return { code, error: `data.go.kr: 활용기간 만료 (${authMsg})`, hint: "운영자가 활용기간을 연장해야 합니다." };
    default:
      return { code, error: `data.go.kr 오류 ${code} (${authMsg})`, hint: "잠시 후 다시 시도하거나 다른 출처를 쓰세요." };
  }
}

export function notConfigured(what: string, envKey: string): ToolResult<never> {
  return { ok: false, error: `${what} 키가 설정되지 않았습니다 (${envKey})`, hint: "이 도구는 사용할 수 없습니다. 웹검색 등 다른 출처를 쓰세요." };
}

/** Strip HTML tags/entities from portal text fields (기업마당 요약 등). */
export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
