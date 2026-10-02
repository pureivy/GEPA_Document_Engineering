/**
 * 정산 원장(ledger) — 정산·결과보고(closeout) 프로젝트의 숫자는 전부 여기서 나온다.
 *
 * 에이전트는 올린 엑셀(집행 집계표·통장거래내역)을 읽어 `ledger/ledger.json` 을 **옮겨 적기만** 하고,
 * 합계·집행률·잔액·반납액·재원 안분은 이 모듈이 계산한다. 문서의 정산 표는 `{{정산:…}}` 매크로로
 * 이 계산 결과를 그대로 펼친다(lib/closeout/macros.ts). 사람이 손으로 만든 실제 정산보고서 449건 중
 * 합계가 안 맞는 것이 여럿 나왔다 — 숫자를 AI 가 타이핑하게 두면 같은 일이 생긴다.
 *
 * 규칙의 근거: docs/design-system/closeout-settlement.md §3(계산식·표기)·§4(비목 체계).
 */
import { z } from "zod";
import { koreanAmount, parseLooseDate, thousands } from "../docmodel/format";

/** 항목별 집행현황의 묶음 순서(§4.2 묶음 규칙 1) */
export const 비목군_순서 = ["사업비", "운영비", "인건비", "수수료"] as const;
export type 비목군 = (typeof 비목군_순서)[number];

const Money = z.number().int();

export const LedgerSchema = z.object({
  사업명: z.string().min(1),
  /** 공문 관례 표기 그대로 — "2025. 2. ~ 12." */
  사업기간: z.string().default(""),
  /** 사업기간 검증용(선택) — YYYY-MM-DD */
  시작일: z.string().optional(),
  종료일: z.string().optional(),
  /** 표에 나가는 재원 이름 — 위탁사업비·보조금·지방보조금·출연금 등 */
  재원명: z.string().default("위탁사업비"),
  /**
   * 재원 구성. 하나면 그 이름이 총괄표의 재원 행이 된다. 둘 이상(도비·시군비)이면 집행액·이자를
   * 예산 비율로 안분한다(§3.1 재원별 배분).
   */
  재원: z.array(z.object({ 이름: z.string().min(1), 예산: Money })).min(1),
  자부담: Money.default(0),
  /** 세목별 예산 — 비목군 매핑은 교부결정서 기준(회의비처럼 사업마다 갈리는 세목이 있다, §4.2 규칙 2) */
  예산: z
    .array(
      z.object({
        비목군: z.enum(비목군_순서),
        /**
         * 세부사업(단위사업) — 예: "신규선정", "기술혁신 역량 강화 지원사업". 있으면 집행 세부내역을
         * 세부사업별로 나누고(❍ (사업비) 세부사업(집행액: …)), 같은 세목이라도 세부사업이 다르면 다른 줄이다
         * (담당자 정산보고서: 사업비(사무관리비)=신규선정, 운영비(사무관리비)=운영비).
         */
        세부사업: z.string().optional(),
        세목: z.string().min(1),
        예산: Money,
        /** 변경 승인 전 금액 — 있고 예산과 다르면 변경내역 표에 나간다 */
        당초예산: Money.optional(),
        변경사유: z.string().optional(),
        /** "경상북도 승인" | "○○시 승인" | "자체변경" */
        승인: z.string().optional(),
        /** 잔액 발생사유(서술은 에이전트 몫, §5.2 문형) */
        잔액사유: z.string().optional(),
      }),
    )
    .min(1),
  /** 지출 건별 내역 — 여입·반환은 음수 */
  집행: z.array(
    z.object({
      일자: z.string(),
      금액: Money,
      /** 예산 줄의 세부사업과 같은 이름 — 같은 세목이 여러 세부사업에 있을 때만 필요하다 */
      세부사업: z.string().optional(),
      세목: z.string().min(1),
      내역: z.string().default(""),
      지급처: z.string().default(""),
      지출번호: z.union([z.string(), z.number()]).optional(),
      지급방법: z.string().default(""),
      /** 원자료 위치(파일·시트·행) — 검토용, 문서에는 나가지 않는다 */
      출처: z.string().optional(),
    }),
  ),
  /** 사업비 통장 예금이자 — 건별 */
  이자: z.array(z.object({ 일자: z.string().optional(), 금액: Money })).default([]),
  /** 결산 법인세·지방세(이자에서 공제) */
  결산세: Money.default(0),
  /** 통장 최종잔액 — 있으면 반납액과 대조한다(§3.3 규칙 4) */
  통장최종잔액: Money.optional(),
  /** 반납액 원단위 절사(e나라도움·일부 시군) */
  반납원단위절사: z.boolean().default(false),
  /** 에이전트가 원자료를 읽으며 남긴 메모(가정·보정·확인 필요 사항) */
  메모: z.array(z.string()).default([]),
});
export type Ledger = z.infer<typeof LedgerSchema>;

export interface LineTotal {
  비목군: 비목군;
  세부사업?: string;
  세목: string;
  /** 변경 전 예산(없으면 예산과 같다) */
  당초예산: number;
  예산: number;
  집행: number;
  잔액: number;
  잔액사유?: string;
}
export interface GroupTotal {
  비목군: 비목군;
  당초예산: number;
  예산: number;
  집행: number;
  잔액: number;
  lines: LineTotal[];
}
export interface SourceShare {
  이름: string;
  예산: number;
  집행: number;
  잔액: number;
  이자: number;
  반납액: number;
}
export interface Check {
  level: "error" | "warn";
  message: string;
}
export interface LedgerResult {
  ledger: Ledger;
  groups: GroupTotal[];
  예산: number;
  집행: number;
  잔액: number;
  /** 이자 합계 − 결산세 */
  이자: number;
  반납액: number;
  /** "91.59" — 둘째자리 절사 */
  집행률: string;
  재원: SourceShare[];
  checks: Check[];
}

/** 집행률: 소수 둘째자리 표시, 셋째자리 절사(§3.2 — 절사해야 미집행 사업이 100%로 보이지 않는다) */
export function executionRate(spent: number, budget: number): string {
  if (budget <= 0) return "-";
  // 정수 연산으로 절사한다 — 부동소수 나눗셈은 91.59 를 91.58999… 로 만들 수 있다
  const basisPoints = Math.floor((spent * 10000) / budget);
  return (basisPoints / 100).toFixed(2);
}

/** 표의 금액 칸: 원 단위 콤마, 0 은 `-`(§3.2) */
export function money(n: number): string {
  return n === 0 ? "-" : thousands(n);
}

/** 세부내역 날짜: 같은 해면 MM-DD, 아니면 YYYY-MM-DD(§3.2) */
export function ledgerDate(s: string, year?: number): string {
  const d = parseLooseDate(s);
  if (!d) return s;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return year === undefined || d.getFullYear() === year ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`;
}

/** 금액을 비율대로 나눈다 — 끝자리 오차는 마지막 몫에 몰아 합계를 보존한다 */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === weights.length - 1 ? total : 0));
  const out = weights.map((w) => Math.floor((total * w) / sum));
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
  return out;
}

const normalizeKey = (s: string) => s.replace(/\s+/g, "");

export function computeLedger(input: Ledger): LedgerResult {
  const ledger = LedgerSchema.parse(input);
  const checks: Check[] = [];

  // 예산 줄의 열쇠는 (세부사업, 세목) — 같은 세목이 세부사업마다 따로 있을 수 있다
  const keyOf = (세부사업: string | undefined, 세목: string) => `${normalizeKey(세부사업 ?? "")}|${normalizeKey(세목)}`;
  const label = (세부사업: string | undefined, 세목: string) => (세부사업 ? `${세부사업}·${세목}` : 세목);
  const lineByKey = new Map<string, LineTotal>();
  for (const b of ledger.예산) {
    const key = keyOf(b.세부사업, b.세목);
    if (lineByKey.has(key)) checks.push({ level: "error", message: `예산에 '${label(b.세부사업, b.세목)}' 이 두 번 있습니다` });
    lineByKey.set(key, { 비목군: b.비목군, 세부사업: b.세부사업, 세목: b.세목, 당초예산: b.당초예산 ?? b.예산, 예산: b.예산, 집행: 0, 잔액: 0, 잔액사유: b.잔액사유 });
  }
  for (const e of ledger.집행) {
    let line = lineByKey.get(keyOf(e.세부사업, e.세목));
    if (!line && !e.세부사업) {
      // 세부사업을 적지 않은 지출 — 그 세목이 예산에 한 줄뿐이면 그 줄로 본다(여럿이면 어느 것인지 모른다)
      const same = [...lineByKey.values()].filter((l) => normalizeKey(l.세목) === normalizeKey(e.세목));
      if (same.length === 1) line = same[0];
      else if (same.length > 1) {
        checks.push({ level: "error", message: `집행 ${e.일자} ${thousands(e.금액)}원의 세목 '${e.세목}' 이 여러 세부사업에 있습니다 — 세부사업을 적어야 합니다(${same.map((l) => l.세부사업 ?? "(없음)").join(", ")})` });
        continue;
      }
    }
    if (!line) {
      checks.push({ level: "error", message: `집행 ${e.일자} ${thousands(e.금액)}원의 '${label(e.세부사업, e.세목)}' 이 예산에 없습니다` });
      continue;
    }
    line.집행 += e.금액;
  }
  const groups: GroupTotal[] = [];
  for (const g of 비목군_순서) {
    const lines = [...lineByKey.values()].filter((l) => l.비목군 === g);
    if (!lines.length) continue;
    for (const l of lines) {
      l.잔액 = l.예산 - l.집행;
      if (l.잔액 < 0) checks.push({ level: "warn", message: `${label(l.세부사업, l.세목)}: 집행액(${thousands(l.집행)})이 예산(${thousands(l.예산)})을 넘습니다` });
    }
    const sum = (k: "당초예산" | "예산" | "집행" | "잔액") => lines.reduce((a, l) => a + l[k], 0);
    groups.push({ 비목군: g, 당초예산: sum("당초예산"), 예산: sum("예산"), 집행: sum("집행"), 잔액: sum("잔액"), lines });
  }

  const 예산 = groups.reduce((a, g) => a + g.예산, 0);
  const 집행 = groups.reduce((a, g) => a + g.집행, 0);
  const 잔액 = 예산 - 집행;
  const 재원합 = ledger.재원.reduce((a, s) => a + s.예산, 0);
  if (재원합 !== 예산) checks.push({ level: "error", message: `재원 합계(${thousands(재원합)})와 세목 예산 합계(${thousands(예산)})가 다릅니다` });
  const 이자 = ledger.이자.reduce((a, i) => a + i.금액, 0) - ledger.결산세;
  let 반납액 = 잔액 + 이자;
  if (ledger.반납원단위절사) 반납액 = Math.floor(반납액 / 10) * 10;
  if (ledger.통장최종잔액 !== undefined && ledger.통장최종잔액 !== 잔액 + 이자) {
    checks.push({ level: "error", message: `통장 최종잔액(${thousands(ledger.통장최종잔액)})이 집행잔액+이자(${thousands(잔액 + 이자)})와 다릅니다 — 누락·중복된 거래가 있는지 확인하세요` });
  }
  if (집행 > 예산) checks.push({ level: "warn", message: `총 집행액이 예산을 넘습니다(집행률 ${executionRate(집행, 예산)}%)` });

  const from = ledger.시작일 ? parseLooseDate(ledger.시작일) : null;
  const to = ledger.종료일 ? parseLooseDate(ledger.종료일) : null;
  if (from || to) {
    for (const e of ledger.집행) {
      const d = parseLooseDate(e.일자);
      if (!d) {
        checks.push({ level: "warn", message: `날짜를 읽을 수 없습니다: '${e.일자}' (${e.내역})` });
        continue;
      }
      // 정산 직전의 대행수수료·회계검토 지출은 기간 밖이어도 정상이다(§3.3 규칙 6) — 경고만 한다
      if ((from && d < from) || (to && d > to)) checks.push({ level: "warn", message: `사업기간 밖의 지출: ${e.일자} ${thousands(e.금액)}원 ${e.내역}` });
    }
  }

  const weights = ledger.재원.map((s) => s.예산);
  const 집행몫 = apportion(집행, weights);
  const 이자몫 = apportion(이자, weights);
  const 재원 = ledger.재원.map((s, i) => {
    const 잔 = s.예산 - 집행몫[i];
    return { 이름: s.이름, 예산: s.예산, 집행: 집행몫[i], 잔액: 잔, 이자: 이자몫[i], 반납액: 잔 + 이자몫[i] };
  });

  return { ledger, groups, 예산, 집행, 잔액, 이자, 반납액, 집행률: executionRate(집행, 예산), 재원, checks };
}

/** 본문에 끼워 넣는 값 — `{{정산:예산액한글}}` 처럼 줄 안에서 쓴다 */
export function ledgerValues(r: LedgerResult): Record<string, string> {
  return {
    사업명: r.ledger.사업명,
    사업기간: r.ledger.사업기간,
    재원명: r.ledger.재원명,
    예산액: thousands(r.예산),
    예산액한글: koreanAmount(r.예산),
    예산액천원: `${thousands(Math.round(r.예산 / 1000))}천원`,
    집행액: thousands(r.집행),
    집행액한글: koreanAmount(r.집행),
    집행률: `${r.집행률}%`,
    집행잔액: thousands(r.잔액),
    이자: thousands(r.이자),
    반납액: thousands(r.반납액),
    반납액한글: koreanAmount(r.반납액),
  };
}
export const LEDGER_VALUE_NAMES = ["사업명", "사업기간", "재원명", "예산액", "예산액한글", "예산액천원", "집행액", "집행액한글", "집행률", "집행잔액", "이자", "반납액", "반납액한글"] as const;
