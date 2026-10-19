/**
 * 문서 금액 대조 — 결과보고서·정산보고서·제출 공문에 적힌 금액이 정산 원장에서 나올 수 있는 값인지 본다.
 *
 * 정산 표는 `{{정산:…}}` 매크로가 원장으로 펼치지만, 기업별 지원 현황·본문 문장의 금액은 에이전트(또는 사람)가
 * 적는다. 세 문서가 같은 원장의 숫자만 쓴다는 약속을 지키려면 그 금액도 원장에서 설명돼야 한다 — 집행 건,
 * 세목·세부사업·지급처별 합계, 예산·잔액·이자·반납액, 그리고 그 천원 단위 값. 설명되지 않는 금액은 경고로
 * 알린다(사업계획서의 지원 한도처럼 원장 밖의 값이 정상일 수도 있으므로 막지는 않는다).
 *
 * 올린 자료(계획서·용역 완료보고서·결과 메모)에 그대로 적힌 금액은 옮겨 적은 값이므로 경고하지 않는다 — 방송 매출·현장
 * 판매액 같은 실적 숫자가 경고 16건으로 쏟아져 정작 직접 더한 값을 가렸다(시험 사업 2026-10-19). 자료 어디에도 없는
 * 금액만 남는다.
 */
import type { LedgerResult } from "./ledger";

/** 원장에서 나올 수 있는 금액(원 단위) */
export function ledgerAmounts(r: LedgerResult): Set<number> {
  const out = new Set<number>();
  const add = (n: number | undefined) => {
    if (n !== undefined) out.add(Math.abs(n));
  };
  const l = r.ledger;
  [r.예산, r.집행, r.잔액, r.이자, r.반납액, l.결산세, l.통장최종잔액, l.자부담].forEach(add);
  l.재원.forEach((s) => add(s.예산));
  r.재원.forEach((s) => [s.예산, s.집행, s.잔액, s.이자, s.반납액].forEach(add));
  l.이자.forEach((i) => add(i.금액));
  for (const g of r.groups) {
    [g.당초예산, g.예산, g.집행, g.잔액].forEach(add);
    for (const line of g.lines) [line.당초예산, line.예산, line.집행, line.잔액, line.예산 - line.당초예산].forEach(add);
  }
  // 집행 건과 그 묶음 합계 — 기업별 지원 현황 표는 지급처(세부사업 안·전체)별 합계를 쓴다
  const sums = new Map<string, number>();
  const bump = (k: string, n: number) => sums.set(k, (sums.get(k) ?? 0) + n);
  const sub = new Map<string, { 예산: number; 당초: number }>();
  for (const b of l.예산) {
    const k = b.세부사업 ?? "";
    const s = sub.get(k) ?? { 예산: 0, 당초: 0 };
    sub.set(k, { 예산: s.예산 + b.예산, 당초: s.당초 + (b.당초예산 ?? b.예산) });
  }
  for (const s of sub.values()) [s.예산, s.당초, s.예산 - s.당초].forEach(add);
  for (const e of l.집행) {
    add(e.금액);
    bump(`지급처|${e.지급처}`, e.금액);
    bump(`세부지급처|${e.세부사업 ?? ""}|${e.지급처}`, e.금액);
    bump(`세부|${e.세부사업 ?? e.세목}`, e.금액);
    bump(`세목|${e.세목}`, e.금액);
    bump(`지출번호|${e.지출번호 ?? ""}|${e.일자}`, e.금액);
  }
  sums.forEach(add);
  for (const n of [...out]) {
    out.add(Math.floor(n / 1000));
    out.add(Math.round(n / 1000));
  }
  return out;
}

export interface UnledgeredAmount {
  line: number;
  amount: string;
  context: string;
}

// 콤마로 끊은 1,000 이상의 수. 뒤에 수량 단위가 오면(1,200명·3,500건·12,000USD) 금액이 아니다.
const AMOUNT_RE = /(?<![\d.,])(\d{1,3}(?:,\d{3})+)(?![\d,])(?!\s*(?:명|건|개|회|부|매|장|석|㎡|m²|평|kg|톤|t\b|%|USD|US\$|달러|불|천달러|천USD|km|대|척|시간|일|주|개월|년))/g;

/** 올린 자료 글에 적힌 금액 — 원 단위와 천원 단위를 서로 바꾼 값도 넣는다(자료는 원, 문서는 천원으로 적는 일이 잦다) */
export function sourceAmounts(texts: string[]): Set<number> {
  const out = new Set<number>();
  for (const t of texts)
    for (const m of t.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d{4,})(?![\d,])/g)) {
      const n = Number(m[1].replace(/,/g, ""));
      out.add(n);
      out.add(n * 1000);
      out.add(Math.floor(n / 1000));
      out.add(Math.round(n / 1000));
    }
  return out;
}

/** 문서(DSL)에서 원장으로도, 올린 자료로도 설명되지 않는 금액을 찾는다. 표 속성 줄(`{table …}`)은 건너뛴다. */
export function findUnledgeredAmounts(dsl: string, r: LedgerResult, source: Set<number> = new Set()): UnledgeredAmount[] {
  const ledger = ledgerAmounts(r);
  const known = { has: (n: number) => ledger.has(n) || source.has(n) };
  const out: UnledgeredAmount[] = [];
  dsl.split(/\r?\n/).forEach((text, i) => {
    if (/^\s*\{table\b/.test(text)) return;
    for (const m of text.matchAll(AMOUNT_RE)) {
      if (known.has(Number(m[1].replace(/,/g, "")))) continue;
      const at = m.index ?? 0;
      out.push({ line: i + 1, amount: m[1], context: text.slice(Math.max(0, at - 24), at + m[1].length + 16).trim() });
    }
  });
  return out;
}

/** 저장 경고 문구 — 한 금액에 한 줄, 많으면 앞의 12개만 */
export function unledgeredWarnings(dsl: string, r: LedgerResult, source?: Set<number>): { line: number; message: string }[] {
  const found = findUnledgeredAmounts(dsl, r, source);
  const shown = found.slice(0, 12).map((f) => ({
    line: f.line,
    message: `원장·자료에 없는 금액 ${f.amount} — "…${f.context}…" : 직접 더하거나 뺀 값인지 확인하세요`,
  }));
  if (found.length > shown.length) shown.push({ line: 0, message: `원장·자료에 없는 금액이 ${found.length - shown.length}개 더 있습니다` });
  return shown;
}
