import { describe, expect, it } from "vitest";
import { expandLedgerMacros } from "../../lib/closeout/macros";
import { LedgerSchema } from "../../lib/closeout/ledger";
import { greetingFor } from "../../lib/agents/prompts/closeout";

const base = {
  사업명: "2025년 고령군 지역발전 우수기업 환경개선사업",
  재원: [{ 이름: "위탁사업비", 예산: 1_000_000 }],
  예산: [
    { 비목군: "사업비", 세목: "민간사업지원금", 예산: 800_000 },
    { 비목군: "운영비", 세목: "국내여비", 예산: 200_000 },
  ],
  집행: [
    { 일자: "2025-07-24", 금액: 800_000, 세목: "민간사업지원금", 내역: "지원금 지급", 지급처: "㈜가", 지급방법: "계좌이체" },
    { 일자: "2025-08-28", 금액: 69_400, 세목: "국내여비", 내역: "8월 여비", 지급처: "권하경", 지급방법: "계좌이체" },
  ],
};

describe("정산 표기 — 사업계획서 예산표의 비목 이름", () => {
  it("비목군명칭·비목칸이 있으면 표에 그 이름으로 나간다(고령군 2025: 직접비·간접비, 통계목)", () => {
    const ledger = LedgerSchema.parse({ ...base, 비목군명칭: { 사업비: "직접비", 운영비: "간접비" }, 비목칸: "통계목" });
    const { text } = expandLedgerMacros("{{정산:항목별}}\n{{정산:집행현황}}", ledger);
    expect(text).toContain("| 직접비 |");
    expect(text).toContain("| 간접비 |");
    expect(text).toContain("| 통계목 |");
    expect(text).toContain("| 민간사업지원금 |");
    expect(text).not.toContain("사업비(민간사업지원금)");
  });
  it("없으면 지금까지처럼 사업비·운영비(세목)", () => {
    const { text } = expandLedgerMacros("{{정산:집행현황}}", LedgerSchema.parse(base));
    expect(text).toContain("사업비(민간사업지원금)");
    expect(text).toContain("| 비목 |");
  });
});

describe("제출 공문 인사말", () => {
  it("수신에 따라 고른다", () => {
    expect(greetingFor("경상북도지사(기업지원과장)")).toBe("경상북도의 무궁한 발전을 기원합니다.");
    expect(greetingFor("고령군수(투자유치과장)")).toBe("귀 군의 무궁한 발전을 기원합니다.");
    expect(greetingFor("포항시장(일자리경제과장)")).toBe("귀 시의 무궁한 발전을 기원합니다.");
    expect(greetingFor("한국산업단지공단 경북지역본부장")).toBe("귀 기관의 무궁한 발전을 기원합니다.");
  });
});
