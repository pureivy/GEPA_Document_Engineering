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
 * 전송·우편번호는 나중에 늘어난 칸이다(user 2026-09-22) — 그 전에 담긴 값(다섯 칸)에는 이 두 키가
 * 아예 없다. isContactPref 가 CONTACT_KEYS 를 전부 typeof 로 요구하면 옛 값 전체가 "모양이
 * 다르다"며 EMPTY_CONTACT 로 떨어진다(실측 — 리뷰에서 잡음). 이 두 칸만 없어도 봐준다.
 */
const LEGACY_OPTIONAL_KEYS = new Set<(typeof CONTACT_KEYS)[number]>(["전송", "우편번호"]);
/** 기본값은 모듈 상수여야 한다 — 매번 새 객체를 만들면 스냅숏 참조가 달라진다 */
export const EMPTY_CONTACT: ContactPref = { 부서명: "", 담당자: "", 전화: "", 전송: "", 이메일: "", 우편주소: "", 우편번호: "" };

/**
 * 원래 다섯 칸(부서명·담당자·전화·이메일·우편주소)은 여전히 전부 문자열이어야 하고, 없으면
 * 깨진 값(모양이 다르다)으로 보고 거절한다 — 그 자리는 그대로다. 나중에 늘어난 두 칸(전송·
 * 우편번호)만 없어도 통과시키고 그 자리에서 빈 문자열로 채운다 — JSON.parse 로 막 만들어진
 * 객체라 이 자리에서 채워도 다른 곳에 영향이 없고, 같은 raw 문자열에는 캐시된 같은 참조가
 * 그대로 돌아간다(useSyncExternalStore 스냅숏 안정성).
 */
function isContactPref(v: unknown): v is ContactPref {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const k of CONTACT_KEYS) {
    if (typeof o[k] === "string") continue;
    if (o[k] === undefined && LEGACY_OPTIONAL_KEYS.has(k)) continue;
    return false;
  }
  for (const k of LEGACY_OPTIONAL_KEYS) if (o[k] === undefined) o[k] = "";
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
