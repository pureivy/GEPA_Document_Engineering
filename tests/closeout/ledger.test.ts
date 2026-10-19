import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeLedger, executionRate, LedgerSchema, ledgerDate, ledgerValues, type Ledger } from "../../lib/closeout/ledger";
import { expandLedgerMacros, LEDGER_TABLE_NAMES } from "../../lib/closeout/macros";
import { ledgerSummaryMarkdown } from "../../lib/closeout/summary";
import { parseDsl } from "../../lib/docmodel/dsl";

/** ESG·기업지원팀-1024 「2025년 서비스산업 투자유치협의체」 정산보고 — 통장 대조로 검산을 마친 실문서(349,800 → 329,800 오기 정정) */
const esg1024 = (): Ledger => LedgerSchema.parse(JSON.parse(readFileSync(join(__dirname, "../fixtures/closeout/esg1024.ledger.json"), "utf8")));

describe("computeLedger — ESG-1024 실문서 재현", () => {
  const r = computeLedger(esg1024());
  it("총괄 수치가 원문과 같다", () => {
    expect(r.예산).toBe(20_000_000);
    expect(r.집행).toBe(18_319_100);
    expect(r.집행률).toBe("91.59");
    expect(r.잔액).toBe(1_680_900);
    expect(r.이자).toBe(10_357);
    expect(r.반납액).toBe(1_691_257);
  });
  it("비목군 소계가 원문 항목별 집행현황과 같다", () => {
    expect(r.groups.map((g) => [g.비목군, g.예산, g.집행, g.잔액])).toEqual([
      ["사업비", 17_581_600, 15_977_500, 1_604_100],
      ["운영비", 778_400, 701_600, 76_800],
      ["수수료", 1_640_000, 1_640_000, 0],
    ]);
  });
  it("검증 경고가 없다(통장 최종잔액과 일치)", () => {
    expect(r.checks).toEqual([]);
  });
  it("원문의 오기(349,800)를 넣으면 통장잔액 대조에서 잡는다", () => {
    const l = esg1024();
    l.집행 = l.집행.map((e) => (e.금액 === 329_800 ? { ...e, 금액: 349_800 } : e));
    const bad = computeLedger(l);
    expect(bad.checks.some((c) => c.level === "error" && c.message.includes("통장 최종잔액"))).toBe(true);
  });
  it("예산에 없는 세목의 지출은 오류다", () => {
    const l = esg1024();
    l.집행.push({ 일자: "2025-12-30", 금액: 1000, 세목: "홍보비", 내역: "", 지급처: "", 지급방법: "" });
    expect(computeLedger(l).checks.some((c) => c.message.includes("'홍보비'"))).toBe(true);
  });
});

describe("표기 규칙", () => {
  it("집행률은 둘째자리 절사 — 미집행 사업이 100%로 보이지 않는다", () => {
    expect(executionRate(18_319_100, 20_000_000)).toBe("91.59");
    expect(executionRate(99_990, 100_000)).toBe("99.99");
    expect(executionRate(999_999, 1_000_000)).toBe("99.99");
    expect(executionRate(1, 0)).toBe("-");
  });
  it("세부내역 날짜는 같은 해면 MM-DD", () => {
    expect(ledgerDate("2025-04-07", 2025)).toBe("04-07");
    expect(ledgerDate("2026. 1. 5.", 2025)).toBe("2026-01-05");
  });
  it("본문 값은 회계 한글 병기", () => {
    expect(ledgerValues(computeLedger(esg1024())).예산액한글).toBe("금20,000,000원(금이천만원)");
  });
});

describe("재원 안분(도비·시군비)", () => {
  it("이자를 예산 비율로 나누고 끝자리는 마지막 재원에 둔다 — 체인지업 실례 9,007 → 2,702 / 6,305", () => {
    const r = computeLedger({
      ...esg1024(),
      재원: [
        { 이름: "도비", 예산: 6_000_000 },
        { 이름: "시군비", 예산: 14_000_000 },
      ],
      이자: [{ 금액: 9_007 }],
      통장최종잔액: undefined,
    });
    expect(r.재원.map((s) => s.이자)).toEqual([2_702, 6_305]);
    expect(r.재원.reduce((a, s) => a + s.집행, 0)).toBe(r.집행);
  });
});

describe("expandLedgerMacros", () => {
  const dsl = [
    "---",
    "family: plan",
    "제목: 위탁사업 추진실적 및 정산보고서",
    "numbering: arabic",
    "---",
    "□ 사업비: {{정산:예산액한글}}",
    // 기업별은 지원금 지급이 있는 원장에서 본다(tests/closeout/amounts.test.ts) — ESG-1024 는 행사 사업이다
    ...LEDGER_TABLE_NAMES.filter((n) => n !== "기업별").map((n) => `{{정산:${n}}}`),
  ].join("\n");

  it("모든 표 매크로가 경고 없이 표로 파싱된다", () => {
    const { text, warnings } = expandLedgerMacros(dsl, esg1024());
    expect(warnings).toEqual([]);
    expect(text).not.toContain("{{정산");
    expect(text).toContain("□ 사업비: 금20,000,000원(금이천만원)");
    const parsed = parseDsl(text);
    expect(parsed.warnings).toEqual([]);
    const tables = parsed.doc.blocks.filter((b) => b.k === "table");
    // 세부내역은 예산 줄(집행이 있는 것)마다 표 하나 — ESG-1024 는 4줄이라 표 4개
    expect(tables).toHaveLength(LEDGER_TABLE_NAMES.length - 2 + 4); // 세부내역(4개로 펼침)·기업별(뺌)
  });

  it("집행현황은 시간순, 계 행은 원장 합계, 비목은 비목군(세목)", () => {
    const { text } = expandLedgerMacros("{{정산:집행현황}}", esg1024());
    expect(text).toContain("| 계 | 18,319,100 |");
    expect(text).toContain("| 04.07. | 4,250,000 | 사업비(행사운영비) |");
    expect(text).toContain("| 12.24. | 1,640,000 | 대행수수료 |");
  });

  it("세부내역은 예산 줄마다 ❍ 머리(집행액 계산)와 표", () => {
    const { text } = expandLedgerMacros("{{정산:세부내역}}", esg1024());
    expect(text).toContain("❍ (사업비) 행사운영비(집행액: 15,677,500원)");
    expect(text).toContain("❍ (운영비) 국내여비(집행액: 701,600원)");
    expect(text).toContain("{table role=generic font=10");
  });

  it("변경이 없으면 '해 당 없 음' 한 행", () => {
    expect(expandLedgerMacros("{{정산:변경내역}}", esg1024()).text).toContain("| 해 당 없 음 | < |");
  });

  it("모르는 매크로는 남기고 경고한다", () => {
    const { text, warnings } = expandLedgerMacros("□ {{정산:없는값}}", esg1024());
    expect(text).toBe("□ {{정산:없는값}}");
    expect(warnings).toHaveLength(1);
  });
});

describe("ledgerSummaryMarkdown", () => {
  it("검증 통과와 핵심 수치를 보여 준다", () => {
    const md = ledgerSummaryMarkdown(computeLedger(esg1024()));
    expect(md).toContain("모든 검증 통과");
    expect(md).toContain("| 반납액 | 1,691,257 |");
  });
});
