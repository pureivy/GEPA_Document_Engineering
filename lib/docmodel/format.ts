/**
 * 공문서 표기 유틸 (행정업무운영 편람 / 범정부오피스 관행).
 *   koreanAmount(12340)      → "금12,340원(금일만이천삼백사십원)"
 *   govDate("2026-01-01")    → "2026. 1. 1.(목)"
 *   thousands(1234567)       → "1,234,567"
 *   deltaText(30, 40, "명")  → "30명→40명으로 33% 증가(10명↑)"
 */

const DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL = ["", "십", "백", "천"];
const BIG = ["", "만", "억", "조", "경"];

/** 12340 → "일만이천삼백사십" (회계 한글 표기: 일십 → 십은 쓰지 않고 '일'을 살린다) */
export function koreanNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error("koreanNumber: non-negative finite number required");
  const v = Math.floor(n);
  if (v === 0) return "영";
  let out = "";
  let group = 0;
  let rest = v;
  while (rest > 0) {
    const chunk = rest % 10000;
    if (chunk > 0) {
      let s = "";
      for (let i = 3; i >= 0; i--) {
        const d = Math.floor(chunk / 10 ** i) % 10;
        if (d === 0) continue;
        s += DIGITS[d] + SMALL[i];
      }
      out = s + BIG[group] + out;
    }
    rest = Math.floor(rest / 10000);
    group++;
  }
  return out;
}

export function thousands(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** 회계 한글화: 금12,340원(금일만이천삼백사십원) */
export function koreanAmount(won: number): string {
  return `금${thousands(won)}원(금${koreanNumber(won)}원)`;
}

/** 천원 단위: 12,340,000 → "12,340천원" */
export function thousandWon(won: number): string {
  return `${thousands(Math.round(won / 1000))}천원`;
}
/** 백만원 단위: 60,000,000 → "60백만원" */
export function millionWon(won: number): string {
  return `${thousands(Math.round(won / 1_000_000))}백만원`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 공문 날짜: 2026. 1. 1.(목) — weekday optional */
export function govDate(input: string | Date, opts: { weekday?: boolean } = {}): string {
  const d = typeof input === "string" ? parseLooseDate(input) : input;
  if (!d) throw new Error(`govDate: cannot parse "${input}"`);
  const base = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
  return opts.weekday === false ? base : `${base}(${WEEKDAYS[d.getDay()]})`;
}

/** "2026-01-01", "2026.1.1", "20260101", "2026년 1월 1일", "2026. 1. 1." → Date */
export function parseLooseDate(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{4})[.\-/년\s]*\s*(\d{1,2})[.\-/월\s]*\s*(\d{1,2})[.일]?/.exec(t);
  if (!m) {
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  }
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 기간: 2026. 7. 1.~7. 15. (편람: 물결표는 앞말·뒷말에 붙인다; same year → month/day only on the right) */
export function govPeriod(from: string | Date, to: string | Date): string {
  const a = typeof from === "string" ? parseLooseDate(from) : from;
  const b = typeof to === "string" ? parseLooseDate(to) : to;
  if (!a || !b) throw new Error("govPeriod: cannot parse dates");
  const left = `${a.getFullYear()}. ${a.getMonth() + 1}. ${a.getDate()}.`;
  const right = a.getFullYear() === b.getFullYear() ? `${b.getMonth() + 1}. ${b.getDate()}.` : `${b.getFullYear()}. ${b.getMonth() + 1}. ${b.getDate()}.`;
  return `${left}~${right}`;
}

/** 증감 표기: 30명→40명으로 33% 증가(10명↑) / 감소(…↓); decimals for non-integer inputs */
export function deltaText(before: number, after: number, unit = ""): string {
  const diff = after - before;
  const pct = before === 0 ? 0 : (diff / before) * 100;
  const isInt = Number.isInteger(before) && Number.isInteger(after);
  const fmt = (x: number) => (isInt ? thousands(x) : x.toFixed(1));
  const dir = diff >= 0 ? "증가" : "감소";
  const arrow = diff >= 0 ? "↑" : "↓";
  const pctStr = isInt ? Math.round(Math.abs(pct)).toString() : Math.abs(pct).toFixed(1);
  return `${fmt(before)}${unit}→${fmt(after)}${unit}으로 ${pctStr}% ${dir}(${fmt(Math.abs(diff))}${unit}${arrow})`;
}

/** △ notation for negative numbers in tables: -30 → "△30" */
export function triangleNegative(n: number): string {
  return n < 0 ? `△${thousands(Math.abs(n))}` : thousands(n);
}

/**
 * `${지역} 내 ${대상기업군}` for the 공고문 greeting, without doubling the scope when the
 * writer already put it into 대상기업군 ("도내 22개 시군" → "경상북도 내 도내 22개 시군").
 *   greetingScope("경상북도", "수출 중소기업") → "경상북도 내 수출 중소기업"
 *   greetingScope("경상북도", "도내 22개 시군") → "도내 22개 시군"
 */
export function greetingScope(지역: string, 대상기업군: string): string {
  const t = 대상기업군.trim();
  if (/^(도내|관내|시내|군내|지역\s?내|경상북도\s?내|경북\s?내)/.test(t) || (지역 && t.startsWith(`${지역} 내`))) return t;
  return `${지역} 내 ${t}`;
}
