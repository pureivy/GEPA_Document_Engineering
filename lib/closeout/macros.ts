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
import { computeLedger, ledgerValues, money, executionRate, type Ledger, type LedgerResult } from "./ledger";

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

/**
 * 표 모양과 열 이름은 담당자가 실제로 낸 정산보고서(ESG·기업지원팀, 2025 향토뿌리기업 육성 사업)를 따른다.
 * 너비는 참고본 칸 너비(HWPUNIT ÷ 100 = pt)다.
 */

/** 세부내역 날짜: 같은 해면 "05.20.", 아니면 "2026.01.05." (참고본 표기) */
export function dotDate(s: string, year?: number): string {
  const d = parseLooseDate(s);
  if (!d) return s;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return year === undefined || d.getFullYear() === year ? `${mm}.${dd}.` : `${d.getFullYear()}.${mm}.${dd}.`;
}

/** 비목군의 표기 이름 — 원장의 비목군명칭(예: 사업비→직접비)이 있으면 그것 */
function 군명(r: LedgerResult, 군: string): string {
  return r.ledger.비목군명칭?.[군] ?? 군;
}

/** 비목 칸: "사업비(민간사업지원금)" — 수수료는 세목만("대행수수료"), 칸 이름이 통계목이면 세목만 */
function 비목(r: LedgerResult, 군: string, 세목: string): string {
  return 군 === "수수료" || r.ledger.비목칸 === "통계목" ? 세목 : `${군명(r, 군)}(${세목})`;
}

/** 집행 건의 예산 줄 찾기(ledger.computeLedger 와 같은 규칙) */
function lineOf(r: LedgerResult, e: Ledger["집행"][number]) {
  const k = (s?: string) => (s ?? "").replace(/\s+/g, "");
  const all = r.groups.flatMap((g) => g.lines);
  return all.find((l) => k(l.세부사업) === k(e.세부사업) && k(l.세목) === k(e.세목)) ?? (!e.세부사업 ? all.filter((l) => k(l.세목) === k(e.세목)).at(0) : undefined);
}

function sortedSpend(r: LedgerResult) {
  return [...r.ledger.집행].sort((a, b) => (parseLooseDate(a.일자)?.getTime() ?? 0) - (parseLooseDate(b.일자)?.getTime() ?? 0));
}

const spendHead = (r: LedgerResult) => row(["지출<br>일자", "지출액", r.ledger.비목칸 ?? "비목", "내역", "지급처", "지출<br>번호", "지급방법"]);
const SPEND_ATTR = "{table role=generic font=10 header-font=10 widths=38,60,112,88,94,32,58}";

function spendRow(r: LedgerResult, e: Ledger["집행"][number], year?: number): string {
  const l = lineOf(r, e);
  return row([dotDate(e.일자, year), thousands(e.금액), esc(비목(r, l?.비목군 ?? "", e.세목)), esc(e.내역), esc(e.지급처), esc(e.지출번호 === undefined ? "" : String(e.지출번호)), esc(e.지급방법)]);
}

function 총괄표(r: LedgerResult): string[] {
  const lines = [
    "(단위 : 원, %)",
    "{table role=budget header-rows=2 font=11 header-font=12 widths=72,82,82,48,66,66,66}",
    row(["구 분", "예 산 액", "지 출 액", "<", "집행잔액", "이 자<br>발생액", "비 고"]),
    row(["^", "^", "금액", "비율", "^", "^", "^"]),
    row(["계", money(r.예산), money(r.집행), r.집행률, money(r.잔액), money(r.이자), ""]),
  ];
  for (const s of r.재원) {
    const name = r.재원.length === 1 ? r.ledger.재원명 : s.이름;
    lines.push(row([esc(name), money(s.예산), money(s.집행), executionRate(s.집행, s.예산), money(s.잔액), money(s.이자), ""]));
  }
  // 자부담이 없으면 행을 두지 않는다(참고본)
  if (r.ledger.자부담) lines.push(row(["자부담", money(r.ledger.자부담), "-", "-", "-", "-", ""]));
  return lines;
}

/** 시간순 집행 현황 — 참고본 「② 위탁사업비 집행현황」 첫 표 */
function 집행현황(r: LedgerResult): string[] {
  const year = baseYear(r.ledger);
  return ["(단위: 원)", SPEND_ATTR, spendHead(r), ...sortedSpend(r).map((e) => spendRow(r, e, year)), row(["계", thousands(r.집행), "", "", "", "", ""])];
}

/** 항목별 집행 현황 — 비목군별 당초·최종 예산, 실제 집행액, 잔액 */
function 항목별(r: LedgerResult): string[] {
  const out = ["(단위: 원)", "{table role=budget font=11 header-font=11 widths=75,104,104,104,95}", row(["항목", "당초예산(변경전)", "최종예산(변경후)", "실제 집행액", "잔 액"])];
  for (const g of r.groups) out.push(row([군명(r, g.비목군), money(g.당초예산), money(g.예산), money(g.집행), money(g.잔액)]));
  out.push(row(["합계", money(r.groups.reduce((a, g) => a + g.당초예산, 0)), money(r.예산), money(r.집행), money(r.잔액)]));
  return out;
}

/**
 * 집행 세부내역 — 예산 줄(세부사업·세목)마다 "❍ (비목군) 이름(집행액: N원)" 머리와 표를 둔다.
 * 집행이 없는 줄은 건너뛴다. 참고본은 이 머리를 손으로 적다가 금액을 틀렸다("38.677.110원") — 여기서는 계산한다.
 */
function 세부내역(r: LedgerResult): string[] {
  const year = baseYear(r.ledger);
  const spend = sortedSpend(r);
  const out: string[] = [];
  for (const g of r.groups) {
    for (const l of g.lines) {
      const mine = spend.filter((e) => lineOf(r, e) === l);
      if (!mine.length) continue;
      out.push(`❍ (${군명(r, g.비목군)}) ${esc(l.세부사업 ?? l.세목)}(집행액: ${thousands(l.집행)}원)`);
      out.push("(단위: 원)", SPEND_ATTR, spendHead(r), ...mine.map((e) => spendRow(r, e, year)));
    }
  }
  return out;
}

/**
 * 세부사업별 집행 — 결과보고서 Ⅲ. 사업계획서 「소요예산」 표의 줄(세부사업)과 같은 단위로 당초·최종 예산과
 * 집행액을 나란히 둔다. 결과보고는 계획서의 세부사업 순서를 그대로 따르므로 예산도 그 단위로 보여 준다.
 */
function 세부사업별(r: LedgerResult): string[] {
  const out = ["(단위: 원)", "{table role=budget font=11 header-font=11 widths=58,148,72,72,72,60}", row(["구 분", "세부사업", "당초예산", "최종예산", "집 행 액", "잔 액"])];
  for (const g of r.groups) {
    g.lines.forEach((l, i) => out.push(row([i === 0 ? 군명(r, g.비목군) : "^", esc(l.세부사업 ?? l.세목), money(l.당초예산), money(l.예산), money(l.집행), money(l.잔액)])));
  }
  out.push(row(["합 계", "<", money(r.groups.reduce((a, g) => a + g.당초예산, 0)), money(r.예산), money(r.집행), money(r.잔액)]));
  return out;
}

/** 사업 및 소요경비배분 변경내역 — 당초예산과 다른 줄만. 없으면 "해 당 없 음" */
function 변경내역(r: LedgerResult): string[] {
  const changed = r.ledger.예산.filter((b) => b.당초예산 !== undefined && b.당초예산 !== b.예산);
  const out = ["(단위: 원)", "{table role=generic font=11 header-font=11 widths=112,82,66,66,110,46}", row(["항목", r.ledger.비목칸 === "통계목" ? "통계목" : "비 목", "당초예산", "변경예산", "주요 변경사유", "승인<br>여부"])];
  if (!changed.length) out.push(row(["해 당 없 음", "<", "<", "<", "<", "<"]));
  for (const b of changed) out.push(row([esc(b.세부사업 ?? 군명(r, b.비목군)), esc(b.세목), money(b.당초예산 ?? 0), money(b.예산), esc(b.변경사유 ?? ""), esc(b.승인 ?? "여")]));
  return out;
}

function 잔액사유(r: LedgerResult): string[] {
  const out = ["(단위: 원)", "{table role=generic widths=92,72,72,72,68,106}", row(["구 분", "세부사업<br>내용", "예 산 액", "지 출 액", "집행잔액", "발 생 사 유"])];
  out.push(row(["합 계", "<", money(r.예산), money(r.집행), money(r.잔액), ""]));
  r.groups.forEach((g, i) => {
    const reasons = [...new Set(g.lines.map((l) => l.잔액사유?.trim()).filter((s): s is string => !!s))];
    const reason = g.잔액 === 0 ? "-" : reasons.length ? reasons.join(", ") : "집행잔액";
    out.push(row([i === 0 ? esc(r.ledger.사업명) : "^", 군명(r, g.비목군), money(g.예산), money(g.집행), money(g.잔액), esc(reason)]));
  });
  out.push("※ 발생사유 : 사업계획변경, 사업취소, 지급사유 미발생, 집행잔액, 이자 등 기재");
  return out;
}

/**
 * 공문 본문의 정산내역 표 — 담당자 공문(ESG·기업지원팀-3629·3630) 그대로 Ⓐ~Ⓓ 첨자, 마지막 열 "통장잔액".
 * `열=반납액` 을 주면 마지막 열 이름만 바꾼다(시군이 반납 의사를 요구할 때).
 */
function 공문표(r: LedgerResult, args: MacroArgs = {}): string[] {
  const last = args.열 === "반납액" ? "반납액" : "통장잔액";
  const head = ["교부금<br>Ⓐ", "집행액<br>Ⓑ", "사업비잔액<br>Ⓒ=Ⓐ-Ⓑ", "예금이자<br>Ⓓ", `${last}<br>Ⓒ+Ⓓ`];
  if (r.재원.length === 1) {
    return ["(단위: 원)", "{table role=budget}", row(head), row([money(r.예산), money(r.집행), money(r.잔액), money(r.이자), money(r.반납액)])];
  }
  const out = ["(단위: 원)", "{table role=budget}", row(["구 분", ...head]), row(["합 계", money(r.예산), money(r.집행), money(r.잔액), money(r.이자), money(r.반납액)])];
  for (const s of r.재원) out.push(row([esc(s.이름), money(s.예산), money(s.집행), money(s.잔액), money(s.이자), money(s.반납액)]));
  return out;
}

/**
 * 기업별 지원 현황 — 결과보고서 Ⅱ·정산보고서 「사업 추진 성과」의 기업 표. 에이전트가 지급 공문을 보고 금액을 치던
 * 표를 원장의 집행 건으로 만든다: 지급처별로 묶어(추가 지급은 더해) 첫 지급 순서로 늘어놓고, 합계는 계산한다.
 *
 *   {{정산:기업별 세부사업="기술혁신 역량 강화 지원사업"}}   그 세부사업의 지원금 지급만
 *   {{정산:기업별}}                                          세부사업이 없는 사업 — 지원금 세목 전체
 *   세목=사업화지원금                                         지원금 세목 이름이 "지원금"을 담지 않을 때
 *
 * 지원항목·지원내용 칸은 원장 집행 건의 같은 이름 값이다(정산자료 단계가 지급 공문에서 옮긴다). 없으면 ○○.
 */
function 기업별(r: LedgerResult, args: MacroArgs = {}): string[] {
  const k = (s?: string) => (s ?? "").replace(/\s+/g, "");
  const want세목 = args.세목 ? (s: string) => k(s) === k(args.세목) : (s: string) => /지원금/.test(s);
  const rows = new Map<string, { 지급처: string; 금액: number; 항목: string[]; 내용: string[] }>();
  for (const e of sortedSpend(r)) {
    if (!want세목(e.세목)) continue;
    if (args.세부사업 !== undefined && k(lineOf(r, e)?.세부사업 ?? e.세부사업) !== k(args.세부사업)) continue;
    const row0 = rows.get(e.지급처) ?? { 지급처: e.지급처, 금액: 0, 항목: [], 내용: [] };
    row0.금액 += e.금액;
    if (e.지원항목 && !row0.항목.includes(e.지원항목)) row0.항목.push(e.지원항목);
    if (e.지원내용 && !row0.내용.includes(e.지원내용)) row0.내용.push(e.지원내용);
    rows.set(e.지급처, row0);
  }
  const list = [...rows.values()];
  const with항목 = list.some((x) => x.항목.length);
  const out = ["(단위: 원)"];
  if (!list.length) return [`(기업별 지원 내역 없음${args.세부사업 ? ` — ${args.세부사업}` : ""})`];
  if (with항목) out.push("{table role=generic widths=32,118,84,170,78}", row(["연번", "기업명", "지원항목", "지원내용", "지원금액"]));
  else out.push("{table role=generic widths=32,130,230,90}", row(["연번", "기업명", "지원내용", "지원금액"]));
  list.forEach((x, i) => {
    const cells = [String(i + 1), esc(x.지급처), ...(with항목 ? [esc(x.항목.join(", ") || "○○")] : []), esc(x.내용.join("<br>") || "○○"), thousands(x.금액)];
    out.push(row(cells));
  });
  const total = list.reduce((a, x) => a + x.금액, 0);
  out.push(row(["합 계", "<", ...(with항목 ? ["<"] : []), "<", thousands(total)]));
  return out;
}

export type MacroArgs = Record<string, string>;
export const LEDGER_TABLES: Record<string, (r: LedgerResult, args?: MacroArgs) => string[]> = { 총괄표, 집행현황, 항목별, 세부사업별, 세부내역, 기업별, 변경내역, 잔액사유, 공문표 };
export const LEDGER_TABLE_NAMES = Object.keys(LEDGER_TABLES);

// 인자 값은 빈칸이 없으면 그대로, 있으면 따옴표로 감싼다: 세부사업="기술혁신 역량 강화 지원사업"
const ARG = String.raw`[^\s=}]+=(?:"[^"]*"|“[^”]*”|[^\s}"“]+)`;
const LINE_RE = new RegExp(String.raw`^\s*\{\{\s*정산\s*:\s*([^\s}]+)((?:\s+${ARG})*)\s*\}\}\s*$`);
const INLINE_RE = /\{\{\s*정산\s*:\s*([^\s}]+)\s*\}\}/g;

function parseArgs(s: string | undefined): MacroArgs {
  const out: MacroArgs = {};
  for (const m of (s ?? "").matchAll(/([^\s=}]+)=(?:"([^"]*)"|“([^”]*)”|([^\s}"“]+))/g)) out[m[1]] = m[2] ?? m[3] ?? m[4];
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
      const lines = LEDGER_TABLES[m[1]](result, parseArgs(m[2]));
      if (lines[0]?.startsWith("(기업별 지원 내역 없음")) warnings.push(`${line.trim()} — 원장에 맞는 지원금 지급 건이 없습니다(세부사업 이름이 원장과 같은지 확인)`);
      out.push(...lines);
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
