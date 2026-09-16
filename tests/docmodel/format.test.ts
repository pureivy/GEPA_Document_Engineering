import { describe, it, expect } from "vitest";
import { greetingScope, koreanAmount, koreanNumber, govDate, govPeriod, deltaText, thousandWon, millionWon, triangleNegative } from "../../lib/docmodel/format";

describe("공문 표기 유틸 (범피스 관행)", () => {
  it("금액 한글화", () => {
    expect(koreanAmount(12340)).toBe("금12,340원(금일만이천삼백사십원)");
    expect(koreanAmount(60_000_000)).toBe("금60,000,000원(금육천만원)");
    expect(koreanAmount(1_234_567_890)).toBe("금1,234,567,890원(금일십이억삼천사백오십육만칠천팔백구십원)");
    expect(koreanNumber(100_000_000)).toBe("일억");
  });
  it("단위 변환", () => {
    expect(thousandWon(12_340_000)).toBe("12,340천원");
    expect(millionWon(60_000_000)).toBe("60백만원");
    expect(triangleNegative(-30)).toBe("△30");
  });
  it("날짜", () => {
    expect(govDate("2026-01-01")).toBe("2026. 1. 1.(목)");
    expect(govDate("20260101")).toBe("2026. 1. 1.(목)");
    expect(govDate("2025년 6월 27일")).toBe("2025. 6. 27.(금)");
    expect(govDate("2026. 7. 14.", { weekday: false })).toBe("2026. 7. 14.");
    expect(govPeriod("2026-07-01", "2026-07-15")).toBe("2026. 7. 1. ~ 7. 15.");
  });
  it("증감", () => {
    expect(deltaText(30, 40, "명")).toBe("30명→40명으로 33% 증가(10명↑)");
    expect(deltaText(68.7, 73.1, "kg")).toBe("68.7kg→73.1kg으로 6.4% 증가(4.4kg↑)");
  });
});

describe("greetingScope", () => {
  it("prefixes the region unless the target already carries a scope", () => {
    expect(greetingScope("경상북도", "수출 중소기업")).toBe("경상북도 내 수출 중소기업");
    expect(greetingScope("경상북도", "도내 22개 시군")).toBe("도내 22개 시군");
    expect(greetingScope("안동시", "관내 소상공인")).toBe("관내 소상공인");
    expect(greetingScope("경상북도", "경상북도 내 기업")).toBe("경상북도 내 기업");
  });
});
