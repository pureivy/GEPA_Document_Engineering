/**
 * `ledger/summary.md` — 정산자료 단계가 끝나면 플랫폼이 원장을 계산해 쓰는 파일.
 * 담당자는 화면에서 이것으로 숫자와 검증 결과를 확인하고, 뒤 단계 에이전트는 서술에 쓸 수치를
 * 여기서 옮긴다(표는 `{{정산:…}}` 매크로로 넣으므로 옮기지 않는다).
 */
import { thousands } from "../docmodel/format";
import { LEDGER_VALUE_NAMES, ledgerValues, type LedgerResult } from "./ledger";
import { LEDGER_TABLES, LEDGER_TABLE_NAMES, type LedgerOpts } from "./macros";

/**
 * 매크로가 펼치는 것은 DSL 표다 — `<br>`(칸 안 줄바꿈)·`<`(왼쪽과 병합)·`^`(위와 병합)·`{table …}` 속성 줄은
 * 한글 문서에서만 뜻이 있고, 화면의 마크다운 미리보기에는 글자 그대로 찍힌다(2026-11-11 지적: "지출<br>번호").
 * 미리보기용으로 줄바꿈은 띄어쓰기로, 병합 표시는 빈칸으로 바꾸고 첫 행 아래 구분선을 넣는다.
 */
export function dslTableToMarkdown(lines: string[]): string[] {
  const out: string[] = [];
  const split = (line: string) =>
    line
      .trim()
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/<br\s*\/?>/gi, " "));
  const blank = (cells: string[]) => cells.map((c) => (c === "<" || c === "^" ? "" : c));
  const isRow = (line?: string) => !!line && /^\s*\|.*\|\s*$/.test(line);
  const src = lines.filter((l) => !l.startsWith("{table"));
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    if (!isRow(line)) {
      out.push(line.replace(/<br\s*\/?>/gi, " "));
      continue;
    }
    // 표 첫 행 — 다음 행이 `^` 를 담으면 두 줄 머리(예: 지 출 액 → 금액·비율)라 한 줄로 합친다
    let head = split(line);
    const next = isRow(src[i + 1]) ? split(src[i + 1]) : null;
    if (next && next.includes("^") && next.length === head.length) {
      head = head.map((c, j) => {
        const top = c === "<" ? head.slice(0, j).reverse().find((x) => x !== "<") ?? "" : c;
        return next[j] === "^" ? top : `${top} ${next[j]}`.trim();
      });
      i++;
    }
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push(`| ${blank(head).join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
    while (isRow(src[i + 1])) out.push(`| ${blank(split(src[++i])).join(" | ")} |`);
  }
  return out;
}

export function ledgerSummaryMarkdown(r: LedgerResult, opts: LedgerOpts = {}): string {
  const v = ledgerValues(r);
  const errors = r.checks.filter((c) => c.level === "error");
  const warns = r.checks.filter((c) => c.level === "warn");
  const lines = [
    `# 정산 요약 — ${r.ledger.사업명}`,
    "",
    "> 이 파일은 `ledger.json` 에서 **자동 계산**된 것입니다. 숫자를 고치려면 원장(ledger.json)을 고치고 정산자료 단계를 다시 실행하세요.",
    "",
    "## 검증",
    "",
    ...(r.checks.length ? [] : ["- ✅ 모든 검증 통과(세목 대응·재원 합계·통장잔액 대조·사업기간)"]),
    ...errors.map((c) => `- ❌ ${c.message}`),
    ...warns.map((c) => `- ⚠️ ${c.message}`),
    "",
    "## 핵심 수치",
    "",
    "| 항목 | 값 | 본문 매크로 |",
    "|---|---|---|",
    ...LEDGER_VALUE_NAMES.map((k) => `| ${k} | ${v[k].replace(/\|/g, "\\|")} | \`{{정산:${k}}}\` |`),
    "",
    `- 집행 건수 ${r.ledger.집행.length}건, 이자 ${r.ledger.이자.length}건${r.ledger.결산세 ? `(결산세 ${thousands(r.ledger.결산세)}원 공제)` : ""}`,
    "",
    "## 비목별",
    "",
    "| 비목군 | 세목 | 예산 | 집행 | 잔액 |",
    "|---|---|---|---|---|",
    ...r.groups.flatMap((g) => g.lines.map((l) => `| ${g.비목군} | ${l.세목} | ${thousands(l.예산)} | ${thousands(l.집행)} | ${thousands(l.잔액)} |`)),
    "",
    "## 문서에 넣는 표 매크로",
    "",
    "한 줄에 단독으로 쓰면 저장할 때 아래 표로 펼쳐집니다.",
    "",
    ...LEDGER_TABLE_NAMES.map((n) => `- \`{{정산:${n}}}\``),
    "",
    "## 표 미리보기(펼친 결과)",
    "",
    // 자체사업에는 제출 공문이 없다 — 공문표는 미리보기에서도 뺀다
    ...LEDGER_TABLE_NAMES.filter((n) => !(opts.자체 && n === "공문표")).flatMap((n) => [`### ${n}`, "", ...dslTableToMarkdown(LEDGER_TABLES[n](r, {}, opts)), ""]),
  ];
  if (r.ledger.메모.length) lines.push("## 원자료 메모", "", ...r.ledger.메모.map((m) => `- ${m}`), "");
  return lines.join("\n");
}
