/**
 * Per-browser run preferences (localStorage) exposed as an external store, so server and client
 * render the same default and every component sees a change at once.
 *   gepa.autoChain    — 완료 후 다음 단계 자동 실행 (default on)
 *   gepa.planResearch — 사업계획서 작성 시 보충 조사 허용 (default off; set once in the new-project
 *                       dialog or on the 사업계획서 page, reused by "전체 자동 실행")
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
