/**
 * 브라우저에 담아 두는 연락처 기본값 — 프로젝트마다 부서명·담당자·전화·전송·이메일·우편주소·우편번호를
 * 다시 치지 않게 한다(user 2026-09-22). DB 컬럼이 아니라 이 브라우저만의 편의값이므로
 * 사생활 보호 모드처럼 localStorage 가 막힌 곳에서도 폼이 멀쩡해야 한다.
 *
 * vitest 환경이 node 라 window 가 없다 — 실제 브라우저의 동작(담기, 못 담기, 깨진 값)을
 * 흉내 내는 저장소를 직접 끼운다.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_CONTACT, PREF_CONTACT, readContactPref, readJsonPref, saveContactPref, subscribePref, writeJsonPref } from "../../lib/client/prefs";

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

function useStore(s: Store | null) {
  // @ts-expect-error node 환경에는 window 가 없다 — 테스트에서만 끼운다
  globalThis.window = s ? { localStorage: s } : undefined;
}
function memoryStore(): Store {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}
/** 사생활 보호 모드·용량 초과 — 두 접근 모두 던진다 */
const throwingStore: Store = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

const CONTACT = {
  부서명: "북부지소",
  담당자: "홍길동 팀장",
  전화: "054-900-3801",
  전송: "054-472-2989",
  이메일: "gepa_north@naver.com",
  우편주소: "경상북도 안동시 북순환로 387",
  우편번호: "39393",
};

afterEach(() => useStore(null));

describe("연락처 pref 왕복", () => {
  it("담은 값을 그대로 돌려준다", () => {
    useStore(memoryStore());
    expect(readContactPref()).toEqual(EMPTY_CONTACT);
    saveContactPref(CONTACT);
    expect(readContactPref()).toEqual(CONTACT);
  });

  it("빠진 칸은 빈 문자열로 채워 담는다 — 담당자·전송·우편주소·우편번호는 선택 입력이다", () => {
    useStore(memoryStore());
    saveContactPref({ 부서명: "마케팅팀", 전화: "054-100-1000", 이메일: "a@gepa.kr" });
    expect(readContactPref()).toEqual({ 부서명: "마케팅팀", 담당자: "", 전화: "054-100-1000", 전송: "", 이메일: "a@gepa.kr", 우편주소: "", 우편번호: "" });
  });

  /** useSyncExternalStore 의 스냅숏은 참조까지 같아야 한다 — 매번 새 객체면 무한히 다시 그린다 */
  it("값이 그대로면 같은 객체를 돌려준다", () => {
    useStore(memoryStore());
    saveContactPref(CONTACT);
    expect(readContactPref()).toBe(readContactPref());
    saveContactPref({ ...CONTACT, 부서명: "마케팅팀" });
    expect(readContactPref().부서명).toBe("마케팅팀"); // 값이 바뀌면 새로 읽는다
  });

  it("담은 사람에게 바뀌었다고 알린다", () => {
    useStore(memoryStore());
    let n = 0;
    const off = subscribePref(() => n++);
    saveContactPref(CONTACT);
    expect(n).toBe(1);
    off();
  });

  it("모양이 다른 값·깨진 글자는 기본값으로 떨어진다", () => {
    const s = memoryStore();
    useStore(s);
    s.setItem(PREF_CONTACT, "{부서명:");
    expect(readContactPref()).toEqual(EMPTY_CONTACT);
    s.setItem(PREF_CONTACT, JSON.stringify({ 부서명: "북부지소" })); // 옛 모양이 아니라 칸 자체가 모자란다(담당자·전화 등도 없다)
    expect(readContactPref()).toEqual(EMPTY_CONTACT);
    s.setItem(PREF_CONTACT, JSON.stringify(["북부지소"]));
    expect(readContactPref()).toEqual(EMPTY_CONTACT);
  });

  /**
   * user 2026-09-22(리뷰): 전송·우편번호는 이번에 늘어난 칸이라, 그 전에 이 브라우저에 담긴
   * 값(다섯 칸)에는 이 두 키가 아예 없다. isContactPref 가 그 두 키까지 typeof 로 요구하면
   * 옛 값 전체가 깨진 것으로 보여 EMPTY_CONTACT 로 사라진다 — 우편번호·전송을 달라고 한 요청이
   * 그 사람이 이미 저장해 둔 연락처를 지워 버리는 것이다. 옛 다섯 칸은 그대로 읽히고, 늘어난
   * 두 칸만 빈 문자열로 채워져야 한다.
   */
  it("전송·우편번호 없이 저장된 옛 다섯 칸 값은 사라지지 않고, 늘어난 두 칸만 빈 문자열로 채워 읽는다", () => {
    const s = memoryStore();
    useStore(s);
    const legacyFive = { 부서명: "북부지소", 담당자: "홍길동 팀장", 전화: "054-900-3801", 이메일: "gepa_north@naver.com", 우편주소: "경상북도 안동시 북순환로 387" };
    s.setItem(PREF_CONTACT, JSON.stringify(legacyFive));
    expect(readContactPref()).toEqual({ ...legacyFive, 전송: "", 우편번호: "" });
  });

  /** boolean pref 와 같은 관행: 담지 못해도 삼키고 기본값으로 계속 간다 */
  it("localStorage 가 막혀 있어도 던지지 않는다", () => {
    useStore(throwingStore);
    expect(() => saveContactPref(CONTACT)).not.toThrow();
    expect(readContactPref()).toEqual(EMPTY_CONTACT);
  });

  it("window 자체가 없어도(서버 렌더) 기본값을 돌려준다", () => {
    useStore(null);
    expect(readContactPref()).toEqual(EMPTY_CONTACT);
  });
});

describe("readJsonPref — 일반 JSON pref", () => {
  const isNums = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number");
  const DEF: number[] = [];

  it("담고 읽고, 통과하지 못한 값은 기본값으로 떨어진다", () => {
    useStore(memoryStore());
    expect(readJsonPref("gepa.test", DEF, isNums)).toBe(DEF);
    writeJsonPref("gepa.test", [1, 2, 3]);
    expect(readJsonPref("gepa.test", DEF, isNums)).toEqual([1, 2, 3]);
    writeJsonPref("gepa.test", ["하나"]);
    expect(readJsonPref("gepa.test", DEF, isNums)).toBe(DEF);
  });
});
