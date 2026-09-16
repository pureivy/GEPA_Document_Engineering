import { describe, it, expect } from "vitest";
import { parseScoreLine } from "../../lib/hwpx/writers/common";

describe("parseScoreLine", () => {
  it("recognises the 구분: form, a lead + ranges form and bare ranges", () => {
    expect(parseScoreLine("구분: 30%이상 30 / 30%미만 24 / 20%미만 18 / 10%미만 12 / 5%이하 6")).toEqual({
      items: [["30%이상", "30"], ["30%미만", "24"], ["20%미만", "18"], ["10%미만", "12"], ["5%이하", "6"]],
    });
    expect(parseScoreLine("1. 2025년 매출액 대비 수출액 비율: 30% 이상 30 / 30% 미만 24 / 20% 미만 18")).toEqual({
      lead: "1. 2025년 매출액 대비 수출액 비율",
      items: [["30% 이상", "30"], ["30% 미만", "24"], ["20% 미만", "18"]],
    });
    expect(parseScoreLine("200% 이상 20 / 200% 미만 16 / 100% 미만 12 / 50% 미만 8 / 0% 이하 4")?.items.length).toBe(5);
  });
  it("leaves ordinary text alone", () => {
    expect(parseScoreLine("※ 평가기준: 25년 부가가치세 과세표준증명원 및 수출실적증명서")).toBeNull();
    expect(parseScoreLine("구분: 2023년 / 2024년")).toBeNull(); // no scores
    expect(parseScoreLine("가 1 / 나 2")).toBeNull(); // bare form needs ≥ 3 items
    expect(parseScoreLine("이메일 접수: gepa_north@naver.com")).toBeNull();
  });
});
