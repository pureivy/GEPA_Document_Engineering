/**
 * `{{정산:…}}` 매크로 — 정산 원장 계산 결과를 DSL 로 펼친다.
 *
 *   한 줄 단독 `{{정산:총괄표}}`        → 단위 캡션 + 표(+ 서식 각주)
 *   줄 안      `{{정산:예산액한글}}`    → 값 문자열(금20,000,000원(금이천만원))
 *
 * 펼치는 시점은 에이전트 초안을 저장할 때다(lib/stages/service.ts saveStageDsl). 그래서 문서에 남는 것은
 * 계산된 숫자이고, 사람이 편집기에서 고친 값은 그대로 저장된다. 표 모양은
 * docs/design-system/closeout-settlement.md §2(V1 「위탁사업 추진실적 및 정산보고서」)를 따른다.
 */
import { parseLooseDate, thousands } from "../docmodel/format";
import { computeLedger, ledgerDate, ledgerValues, money, executionRate, type Ledger, type LedgerResult } from "./ledger";

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const row = (cells: string[]) => `| ${cells.join(" | ")} |`;

/** 사업연도 — 세부내역 날짜를 MM-DD 로 줄일 기준. 시작일이 없으면 가장 많은 해 */
function baseYear(l: Ledger): number | undefined {
  const start = l.시작일 ? parseLooseDate(l.시작일) : null;
  if (start) return start.getFullYear();
  const count = new Map<number, number>();
  for (const e of l.집행) {
    const d = parseLooseDate(e.일자);
    if (d) count.set(d.getFullYear(), (count.get(d.getFullYear()) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function 총괄표(r: LedgerResult): string[] {
  const lines = [
    "(단위 : 원, %)",
    "{table role=budget header-rows=2 widths=66,74,74,42,68,62,68,28}",
    row(["구 분", "예 산 액", "지 출 액", "<", "집행잔액", "이 자<br>발생액", "반 납 액", "비고"]),
    row(["^", "^", "금 액", "비 율", "^", "^", "^", "^"]),
    row(["계", money(r.예산), money(r.집행), r.집행률, money(r.잔액), money(r.이자), money(r.반납액), ""]),
  ];
  for (const s of r.재원) {
    const name = r.재원.length === 1 ? r.ledger.재원명 : s.이름;
    lines.push(row([esc(name), money(s.예산), money(s.집행), executionRate(s.집행, s.예산), money(s.잔액), money(s.이자), money(s.반납액), ""]));
  }
  const 자 = r.ledger.자부담;
  lines.push(row(["자부담", money(자), "-", "-", "-", "-", "-", ""]));
  return lines;
}

function 항목별(r: LedgerResult): string[] {
  const out = ["(단위 : 원)", "{table role=budget widths=70,110,76,76,76,74}", row(["구 분", "항 목", "예 산 액", "집 행 액", "집행잔액", "비 고"])];
  for (const g of r.groups) {
    g.lines.forEach((l, i) => out.push(row([i === 0 ? g.비목군 : "^", esc(l.세목), money(l.예산), money(l.집행), money(l.잔액), ""])));
    if (g.lines.length > 1) out.push(row(["^", "소 계", money(g.예산), money(g.집행), money(g.잔액), ""]));
  }
  out.push(row(["합 계", "<", money(r.예산), money(r.집행), money(r.잔액), ""]));
  return out;
}

function 세부내역(r: LedgerResult): string[] {
  const year = baseYear(r.ledger);
  const sorted = [...r.ledger.집행].sort((a, b) => (parseLooseDate(a.일자)?.getTime() ?? 0) - (parseLooseDate(b.일자)?.getTime() ?? 0));
  const out = ["(단위 : 원)", "{table role=generic font=9 header-font=9 widths=44,62,66,130,90,32,58}", row(["일 자", "인 출 액", "비 목", "내 역", "지 급 처", "번호", "지급방법"])];
  for (const e of sorted) {
    out.push(row([ledgerDate(e.일자, year), thousands(e.금액), esc(e.세목), esc(e.내역), esc(e.지급처), esc(e.지출번호 === undefined ? "" : String(e.지출번호)), esc(e.지급방법)]));
  }
  out.push(row(["계", thousands(r.집행), "", "", "", "", ""]));
  out.push("※ 내부품의서, 지출결의서, 각종 영수증, 회계장부, 통장 등 세부증빙자료는 별도 편철 제출");
  return out;
}

function 변경내역(r: LedgerResult): string[] {
  const changed = r.ledger.예산.filter((b) => b.당초예산 !== undefined && b.당초예산 !== b.예산);
  const out = ["(단위 : 원)", "{table role=generic widths=90,60,70,70,130,62}", row(["세 부 내 용", "비 목", "당초예산", "변경예산", "주요 변경사유", "승인여부"])];
  if (!changed.length) out.push(row(["해 당 없 음", "<", "<", "<", "<", "<"]));
  for (const b of changed) out.push(row([esc(b.세목), b.비목군, money(b.당초예산 ?? 0), money(b.예산), esc(b.변경사유 ?? ""), esc(b.승인 ?? "")]));
  out.push("※ 승인여부 : 위탁기관 승인, 자체변경(내부 결재문서 사본 첨부)으로 구분 기재");
  return out;
}

function 잔액사유(r: LedgerResult): string[] {
  const out = ["(단위 : 원)", "{table role=generic widths=92,72,72,72,68,106}", row(["구 분", "세부사업<br>내용", "예 산 액", "지 출 액", "집행잔액", "발 생 사 유"])];
  out.push(row(["합 계", "<", money(r.예산), money(r.집행), money(r.잔액), ""]));
  r.groups.forEach((g, i) => {
    const reasons = [...new Set(g.lines.map((l) => l.잔액사유?.trim()).filter((s): s is string => !!s))];
    const reason = g.잔액 === 0 ? "-" : reasons.length ? reasons.join(", ") : "집행잔액";
    out.push(row([i === 0 ? esc(r.ledger.사업명) : "^", g.비목군, money(g.예산), money(g.집행), money(g.잔액), esc(reason)]));
  });
  out.push("※ 발생사유 : 사업계획변경, 사업취소, 지급사유 미발생, 집행잔액, 이자 등 기재");
  return out;
}

/**
 * 공문 본문의 정산내역 표. 마지막 열 이름은 받는 곳에 따라 갈린다(closeout-cover.md §2.6):
 * 도 수신은 "통장잔액"(반납은 도의 정산확정 통보를 기다린다), 시군 수신은 "반납액"이 기본이다.
 */
function 공문표(r: LedgerResult, args: MacroArgs = {}): string[] {
  const last = args.열 === "통장잔액" ? "통장잔액" : "반납액";
  const head = ["교부금(A)", "집행액(B)", "사업비 잔액<br>(C)=(A)-(B)", "예금이자<br>(D)", `${last}<br>(C)+(D)`, "비 고"];
  if (r.재원.length === 1) {
    return ["(단위 : 원)", "{table role=budget}", row(head), row([money(r.예산), money(r.집행), money(r.잔액), money(r.이자), money(r.반납액), ""])];
  }
  const out = ["(단위 : 원)", "{table role=budget}", row(["구 분", ...head]), row(["합 계", money(r.예산), money(r.집행), money(r.잔액), money(r.이자), money(r.반납액), ""])];
  for (const s of r.재원) out.push(row([esc(s.이름), money(s.예산), money(s.집행), money(s.잔액), money(s.이자), money(s.반납액), ""]));
  return out;
}

export type MacroArgs = Record<string, string>;
export const LEDGER_TABLES: Record<string, (r: LedgerResult, args?: MacroArgs) => string[]> = { 총괄표, 항목별, 세부내역, 변경내역, 잔액사유, 공문표 };
export const LEDGER_TABLE_NAMES = Object.keys(LEDGER_TABLES);

const LINE_RE = /^\s*\{\{\s*정산\s*:\s*([^\s}]+)((?:\s+[^\s=}]+=[^\s}]+)*)\s*\}\}\s*$/;
const INLINE_RE = /\{\{\s*정산\s*:\s*([^\s}]+)\s*\}\}/g;

function parseArgs(s: string | undefined): MacroArgs {
  const out: MacroArgs = {};
  for (const m of (s ?? "").matchAll(/([^\s=}]+)=([^\s}]+)/g)) out[m[1]] = m[2];
  return out;
}

export function hasLedgerMacro(text: string): boolean {
  return /\{\{\s*정산\s*:/.test(text);
}

/**
 * DSL 안의 `{{정산:…}}` 를 펼친다. 모르는 이름은 그대로 두고 경고한다(파서가 일반 글로 남긴다 —
 * 조용히 지우면 표가 빠진 문서가 결재에 올라간다).
 */
export function expandLedgerMacros(dsl: string, ledger: Ledger): { text: string; warnings: string[]; result: LedgerResult } {
  const result = computeLedger(ledger);
  const values = ledgerValues(result);
  const warnings: string[] = [];
  const out: string[] = [];
  for (const line of dsl.split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (m && LEDGER_TABLES[m[1]]) {
      out.push(...LEDGER_TABLES[m[1]](result, parseArgs(m[2])));
      continue;
    }
    out.push(
      line.replace(INLINE_RE, (whole, name: string) => {
        if (name in values) return values[name];
        warnings.push(`알 수 없는 정산 매크로: ${name}`);
        return whole;
      }),
    );
  }
  return { text: out.join("\n"), warnings, result };
}
