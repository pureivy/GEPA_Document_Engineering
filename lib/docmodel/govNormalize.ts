/**
 * Deterministic clean-ups applied to every agent-written document before it is saved, so the
 * 행정업무운영 편람 conventions hold even when the writer ignores the prompt (user request
 * 2026-09-16: "문서만 고친 것도 앞으로 만드는 모든 문서에 적용"). Only fixes with one unambiguous
 * outcome are done here; judgement calls stay with the reviewer / lint warnings.
 *
 * Text (DSL) fixes (every line, fenced box/flow blocks included):
 *   - 물결표 앞뒤 공백 제거:           `4. 23. ~ 6. 15.` → `4. 23.~6. 15.`
 *   - 날짜 0 제거:                      `2026. 07. 01.` → `2026. 7. 1.`
 *   - 요일 앞 마침표 보충:             `2026. 7. 14(화)` → `2026. 7. 14.(화)`
 *   - 붙은 날짜 띄우기:                 `2026.7.14.` → `2026. 7. 14.`
 *   - 쌍점 앞 공백 제거:               `원장 : 김` → `원장: 김`
 *   - `끝.` 앞 두 타:                   `… 도모 끝.` / `…도모끝.` → `… 도모  끝.`
 *   - 원장 자리표시자:                  `원장 ○○○` / `○○○ 원장` → 실제 원장 성명
 * Meta (press) fixes: 담당부서 → 실·단 정식 명칭, 책임자 비어 있으면 조직표의 책임자.
 */
import type { DocModel } from "./schema";
import { departmentFullName, unitHeadFor, ORG_DIRECTOR } from "../org";

export interface NormalizeChange {
  rule: string;
  count: number;
}

function countReplace(text: string, re: RegExp, repl: string | ((...m: string[]) => string), rule: string, changes: NormalizeChange[]): string {
  let n = 0;
  const out = text.replace(re, (...args: unknown[]) => {
    n++;
    return typeof repl === "string" ? (args[0] as string).replace(re, repl) : repl(...(args as string[]));
  });
  if (n) changes.push({ rule, count: n });
  return out;
}

/** Apply the text-level rules to a DSL document (front-matter included — dates live there too). */
export function normalizeDslText(dsl: string): { text: string; changes: NormalizeChange[] } {
  const changes: NormalizeChange[] = [];
  const lines = dsl.split("\n");
  let photos = false;
  const out = lines.map((line) => {
    // 사진 대지(```photos) 줄의 앞쪽은 파일 경로다 — `사진2_판매전(2025.10.25.).jpg` 의 날짜를 고치면 그림을 못 찾는다
    // (시험 사업 2026-10-19). 경로는 그대로 두고 `|` 뒤 설명만 고친다.
    if (/^\s*```/.test(line)) {
      photos = !photos && /^\s*```photos\b/.test(line);
      return line;
    }
    if (photos) {
      const bar = line.indexOf("|");
      return bar < 0 ? line : line.slice(0, bar + 1) + normalizeLine(line.slice(bar + 1), changes);
    }
    return normalizeLine(line, changes);
  });
  return { text: mergeLoneSubItems(out, changes).join("\n"), changes: mergeChanges(changes) };
}

function normalizeLine(line: string, changes: NormalizeChange[]): string {
  let t = line;
  // 붙은 날짜: 2026.7.14. / 2026.07.14 → 2026. 7. 14.
  t = countReplace(t, /(?<![\d.])((?:19|20)\d{2})\.(\d{1,2})\.(\d{1,2})\.?(?![\d.])/g, (_m, y, mo, d) => `${y}. ${Number(mo)}. ${Number(d)}.`, "날짜 띄어쓰기", changes);
  // 0 제거: 2026. 07. 01. → 2026. 7. 1.  (month and day)
  t = countReplace(t, /((?:19|20)\d{2}|’\d{2})\. 0(\d)\./g, (_m, y, mo) => `${y}. ${mo}.`, "날짜 0 생략", changes);
  t = countReplace(t, /((?:19|20)\d{2}|’\d{2})\. (\d{1,2})\. 0(\d)(?=[.(\s]|$)/g, (_m, y, mo, d) => `${y}. ${mo}. ${d}`, "날짜 0 생략", changes);
  // 연도 없는 월.일 (기간의 뒷부분 `~07. 15.`, `(07. 01.)`): 0 제거
  t = countReplace(t, /(?<=^|[~\s(])0(\d)\. (?=\d)/g, (_m, mo) => `${mo}. `, "날짜 0 생략", changes);
  t = countReplace(t, /(?<=(?:^|[~\s(])\d{1,2}\. )0(\d)(?=[.(\s]|$)/g, (_m, d) => d, "날짜 0 생략", changes);
  // 요일 앞 마침표: 2026. 7. 14(화) → 2026. 7. 14.(화)
  t = countReplace(t, /((?:19|20)\d{2}|’\d{2})\. (\d{1,2})\. (\d{1,2})(\(\S)/g, (_m, y, mo, d, rest) => `${y}. ${mo}. ${d}.${rest}`, "날짜 마침표", changes);
  // 물결표: 앞뒤 공백 제거 (` ~ `, ` ~`, `~ `)
  t = countReplace(t, /(\S)(?: ~ | ~|~ )(?=\S)/g, (_m, a) => `${a}~`, "물결표", changes);
  // 쌍점: 앞 공백 제거 (라벨: 값) — but not inside times like 18 : 00 (rare) or URLs
  t = countReplace(t, /([가-힣A-Za-z)\]]) :(?=\s)/g, (_m, a) => `${a}:`, "쌍점", changes);
  // 끝. 앞 두 타
  t = countReplace(t, /(\S)(?: {0,1}| {3,})끝\.\s*$/g, (_m, a) => `${a}  끝.`, "끝 표시 간격", changes);
  // 원장 자리표시자
  t = countReplace(t, /원장 ○{2,3}|○{2,3} 원장/g, (m) => (m.startsWith("원장") ? `원장 ${ORG_DIRECTOR}` : `${ORG_DIRECTOR} 원장`), "원장 성명", changes);
  return t;
}

/**
 * `-` 항목 아래 `·` 항목이 하나뿐이면 위 줄 끝에 ", " 로 이어 쓴다 — 편람: 항목이 하나뿐이면 항목 기호를 붙이지 않는다
 * (위 항목에 이어 쓰기). 작성 에이전트는 이 경고를 보지 못해 매번 그대로 냈다(결과보고 2026-10-06).
 * 울타리(```) 안과 표 줄은 건드리지 않는다.
 */
function mergeLoneSubItems(lines: string[], changes: NormalizeChange[]): string[] {
  const out: string[] = [];
  let fenced = false;
  let n = 0;
  const isSub = (l: string | undefined) => !!l && /^\s*· \S/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fenced = !fenced;
    const prev = out[out.length - 1];
    if (!fenced && isSub(line) && !isSub(prev) && !isSub(lines[i + 1]) && prev !== undefined && /^\s*- \S/.test(prev)) {
      const body = line.replace(/^\s*·\s+/, "").trim();
      out[out.length - 1] = `${prev.replace(/[\s.]+$/, "")}, ${body}`;
      n++;
      continue;
    }
    out.push(line);
  }
  if (n) changes.push({ rule: "항목 하나 이어 쓰기", count: n });
  return out;
}

function mergeChanges(changes: NormalizeChange[]): NormalizeChange[] {
  const m = new Map<string, number>();
  for (const c of changes) m.set(c.rule, (m.get(c.rule) ?? 0) + c.count);
  return [...m].map(([rule, count]) => ({ rule, count }));
}

/** Meta-level fixes that need the org table (press 담당부서 정식 명칭 / 책임자). */
export function normalizeDocMeta(doc: DocModel): { doc: DocModel; changes: NormalizeChange[] } {
  const changes: NormalizeChange[] = [];
  if (doc.family === "press") {
    const full = departmentFullName(doc.meta.담당부서);
    if (full && full !== doc.meta.담당부서) {
      doc.meta.담당부서 = full;
      changes.push({ rule: "담당부서 정식 명칭", count: 1 });
    }
    if (!doc.meta.책임자) {
      const head = unitHeadFor(doc.meta.담당부서);
      if (head) {
        doc.meta.책임자 = head;
        changes.push({ rule: "책임자 자동 채움", count: 1 });
      }
    }
  }
  return { doc, changes };
}
