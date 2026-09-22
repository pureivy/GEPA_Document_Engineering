/**
 * Per-browser run preferences (localStorage) exposed as an external store, so server and client
 * render the same default and every component sees a change at once.
 *   gepa.autoChain    — 완료 후 다음 단계 자동 실행 (default on)
 *   gepa.planResearch — 사업계획서 작성 시 보충 조사 허용 (default off; set once in the new-project
 *                       dialog or on the 사업계획서 page, reused by "전체 자동 실행")
 *   gepa.contact      — 새 프로젝트 폼의 부서·담당 연락처 (프로젝트마다 다시 치지 않도록; DB 가 아니라
 *                       브라우저에만 둔다 — 프로젝트 데이터가 아니라 이 사람의 입력 습관이다)
 */
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
export function subscribePref(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function readPref(key: string, def: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? def : v === "1";
  } catch {
    return def;
  }
}
export function writePref(key: string, v: boolean): void {
  try {
    window.localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* private mode */
  }
  for (const l of listeners) l();
}
export const PREF_AUTO_CHAIN = "gepa.autoChain";
export const PREF_PLAN_RESEARCH = "gepa.planResearch";
export function useBoolPref(key: string, def: boolean): boolean {
  return useSyncExternalStore(
    subscribePref,
    () => readPref(key, def),
    () => def,
  );
}

// ---- JSON pref ---------------------------------------------------------------------------

/**
 * 담아 둔 원본 문자열 → 파싱 결과. useSyncExternalStore 의 스냅숏은 **참조까지** 같아야 한다 —
 * 매번 JSON.parse 하면 값이 그대로여도 새 객체가 나와 React 가 무한히 다시 그린다.
 */
const jsonCache = new Map<string, { raw: string | null; value: unknown }>();

/**
 * JSON 값 pref. `valid` 를 통과하지 못한 값(옛 모양·깨진 글자)은 기본값으로 떨어뜨린다 —
 * 한 번 잘못 담긴 값이 폼을 영영 못 쓰게 만들지 않게 한다. private 모드에서 localStorage
 * 접근이 던지면 boolean pref 와 같이 기본값으로 돌아간다.
 */
export function readJsonPref<T>(key: string, def: T, valid: (v: unknown) => v is T): T {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return def;
  }
  const hit = jsonCache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value = def;
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (valid(parsed)) value = parsed;
    } catch {
      /* 깨진 값 — 기본값 */
    }
  }
  jsonCache.set(key, { raw, value });
  return value;
}

export function writeJsonPref(key: string, v: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode · 용량 초과 */
  }
  for (const l of listeners) l();
}

export function useJsonPref<T>(key: string, def: T, valid: (v: unknown) => v is T): T {
  return useSyncExternalStore(
    subscribePref,
    () => readJsonPref(key, def, valid),
    () => def,
  );
}

// ---- 연락처 ------------------------------------------------------------------------------

export const PREF_CONTACT = "gepa.contact";

/** 새 프로젝트 폼의 연락처 칸 — NewProjectInput["contact"] 의 공용 일곱 칸(공문 전용 값은 담지 않는다). */
export interface ContactPref {
  부서명: string;
  담당자: string;
  전화: string;
  전송: string;
  이메일: string;
  우편주소: string;
  우편번호: string;
}
const CONTACT_KEYS = ["부서명", "담당자", "전화", "전송", "이메일", "우편주소", "우편번호"] as const;
/**
 * 이 기능이 처음 나왔을 때부터 있던 다섯 칸 — **얼어붙었다, 여기 새 키를 넣지 않는다.**
 * saveContactPref 는 항상 자기가 아는 키를 전부 채워 쓰므로, 우리 코드가 이미 저장해 둔 값은
 * "그 버전 기준으로" 완전하다. isContactPref 가 이 다섯 칸을 요구하는 한 그런 값은 항상 통과한다.
 * 나중에 칸을 늘릴 때는 이 배열이 아니라 아래 CONTACT_OPTIONAL_KEYS 에 넣는다 — 여기 넣으면
 * 그 전에 저장된 모든 값이 "모양이 다르다"며 한꺼번에 EMPTY_CONTACT 로 사라진다(전송·우편번호를
 * 처음에 CONTACT_KEYS 전부에 넣었다가 리뷰에서 실측으로 잡힌 바로 그 사고).
 */
const CONTACT_REQUIRED_KEYS = ["부서명", "담당자", "전화", "이메일", "우편주소"] as const;
/**
 * 이 기능이 나온 뒤에 늘어난 칸(user 2026-09-22: 전송·우편번호) — 없어도 되고, 없으면 읽을 때
 * 빈 문자열로 채운다. 나중에 칸을 더 늘리면 여기에 추가한다(CONTACT_REQUIRED_KEYS 에는 넣지 않는다).
 */
const CONTACT_OPTIONAL_KEYS = new Set<(typeof CONTACT_KEYS)[number]>(["전송", "우편번호"]);
/** 기본값은 모듈 상수여야 한다 — 매번 새 객체를 만들면 스냅숏 참조가 달라진다 */
export const EMPTY_CONTACT: ContactPref = { 부서명: "", 담당자: "", 전화: "", 전송: "", 이메일: "", 우편주소: "", 우편번호: "" };

/**
 * CONTACT_REQUIRED_KEYS 는 전부 문자열이어야 하고, 하나라도 없으면 깨진 값(모양이 다르다)으로
 * 보고 거절한다. CONTACT_OPTIONAL_KEYS 는 없어도 통과시키고 그 자리에서 빈 문자열로 채운다 —
 * JSON.parse 로 막 만들어진 객체라 이 자리에서 채워도 다른 곳에 영향이 없고, 같은 raw 문자열에는
 * 캐시된 같은 참조가 그대로 돌아간다(useSyncExternalStore 스냅숏 안정성).
 */
function isContactPref(v: unknown): v is ContactPref {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (!CONTACT_REQUIRED_KEYS.every((k) => typeof o[k] === "string")) return false;
  for (const k of CONTACT_OPTIONAL_KEYS) {
    if (o[k] !== undefined && typeof o[k] !== "string") return false;
    if (o[k] === undefined) o[k] = "";
  }
  return true;
}

export function readContactPref(): ContactPref {
  return readJsonPref(PREF_CONTACT, EMPTY_CONTACT, isContactPref);
}
export function useContactPref(): ContactPref {
  return useJsonPref(PREF_CONTACT, EMPTY_CONTACT, isContactPref);
}
/** 다음 프로젝트의 기본값 — 실제로 만들어진 프로젝트의 연락처를 그대로 담는다 */
export function saveContactPref(c: Partial<ContactPref>): void {
  const next: ContactPref = { ...EMPTY_CONTACT };
  for (const k of CONTACT_KEYS) next[k] = c[k] ?? "";
  writeJsonPref(PREF_CONTACT, next);
}
