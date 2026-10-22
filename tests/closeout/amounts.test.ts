/**
 * 세 문서가 같은 원장의 숫자만 쓰는가 — 기업별 지원 현황 매크로와 문서 금액 대조.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeLedger, LedgerSchema, type Ledger } from "../../lib/closeout/ledger";
import { expandLedgerMacros } from "../../lib/closeout/macros";
import { findUnledgeredAmounts, sourceAmounts } from "../../lib/closeout/amountCheck";
import { parseDsl } from "../../lib/docmodel/dsl";

const hyangto = (): Ledger => LedgerSchema.parse(JSON.parse(readFileSync(join(__dirname, "../fixtures/closeout/hyangto.ledger.json"), "utf8")));

describe("{{정산:기업별}}", () => {
  it("세부사업의 지원금 지급을 지급처별로 묶고(추가 지급은 더해) 합계를 계산한다", () => {
    const l = hyangto();
    const first = l.집행.find((e) => e.세부사업 === "기술혁신 역량 강화 지원사업")!;
    first.지원항목 = "사업화(R&D)";
    first.지원내용 = "생면 생산 자동화 공급 로봇 도입";
    const { text, warnings } = expandLedgerMacros('{{정산:기업별 세부사업="기술혁신 역량 강화 지원사업"}}', l);
    expect(warnings).toEqual([]);
    const rows = text.split("\n").filter((s) => s.startsWith("| "));
    expect(rows[0]).toBe("| 연번 | 기업명 | 지원항목 | 지원내용 | 지원금액 |");
    const spent = computeLedger(l).groups.flatMap((g) => g.lines).find((x) => x.세부사업 === "기술혁신 역량 강화 지원사업")!.집행;
    expect(rows.at(-1)).toBe(`| 합 계 | < | < | < | ${spent.toLocaleString("en-US")} |`);
    // 같은 지급처는 한 줄 — 지급처 수만큼 행
    const payees = new Set(l.집행.filter((e) => e.세부사업 === "기술혁신 역량 강화 지원사업").map((e) => e.지급처));
    expect(rows.length).toBe(payees.size + 2);
    expect(text).toContain("생면 생산 자동화 공급 로봇 도입");
    expect(text).toContain("| ○○ |"); // 지원내용을 옮기지 않은 기업
    expect(parseDsl(`---
family: plan
제목: 시험
---
${text}`).warnings).toEqual([]);
  });

  it("세부사업 이름이 원장에 없으면 경고한다", () => {
    const { warnings } = expandLedgerMacros('{{정산:기업별 세부사업="없는 사업"}}', hyangto());
    expect(warnings.join()).toMatch(/지원금 지급 건이 없습니다/);
  });
});

describe("문서 금액 대조", () => {
  const r = computeLedger(hyangto());

  it("원장의 집행 건·합계·천원 값은 통과하고, 직접 더한 금액은 잡는다", () => {
    const total = r.집행.toLocaleString("en-US");
    const dsl = [`ㅇ 사업비 중 ${total}원 집행`, `ㅇ 집행잔액 ${r.잔액.toLocaleString("en-US")}원`, "ㅇ 10개사에 93,700천원 지원", "{table role=generic widths=32,118,84,170,78}", "ㅇ 참가자 1,200명"].join("\n");
    const found = findUnledgeredAmounts(dsl, r);
    expect(found.map((f) => f.amount)).toEqual(["93,700"]);
    expect(found[0].line).toBe(3);
  });

  it("결과보고서 본보기는 매크로를 펼친 뒤 원장 밖 금액이 계획 문서의 값뿐이다", () => {
    const { text, warnings } = expandLedgerMacros(readFileSync(join(__dirname, "../fixtures/closeout/result-hyangto.dsl.md"), "utf8"), hyangto());
    // 본보기의 세부사업 이름 중 원장과 다른 것은 경고로 드러난다(신규선정·맞춤형은 본보기에 표가 없다)
    expect(warnings).toEqual([]);
    const outside = findUnledgeredAmounts(text, r).map((f) => f.amount);
    // 계획 예산(계획서) 값만 남는다 — 합·차를 손으로 낸 금액(93,659 등)은 없다
    expect(outside).not.toContain("93,659");
    expect(outside).not.toContain("24,981,810");
  });

  it("올린 자료에 그대로 적힌 금액(원·천원)은 통과하고, 자료에도 없는 합계만 잡는다", () => {
    const src = sourceAmounts(["| 라이브커머스 방송 중 매출 | 38,620,000원 |", "현장 판매 7,450,000원(현장 4,920,000원, 현장 방송 2,530,000원)"]);
    const dsl = ["ㅇ 방송 매출 38,620,000원, 현장 판매 7,450천원", "ㅇ 총 매출 46,070,000원"].join("\n");
    expect(findUnledgeredAmounts(dsl, r, src).map((f) => f.amount)).toEqual(["46,070,000"]);
  });
});
