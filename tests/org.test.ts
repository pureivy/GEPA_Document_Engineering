import { describe, it, expect } from "vitest";
import { approvalLineFor, departmentFullName, findUnit, orgSummary, unitHeadFor } from "../lib/org";

describe("org table (user-stated 2026-09-16)", () => {
  it("maps teams, units, aliases and abbreviations to their 실/단", () => {
    expect(findUnit("전략기획팀")?.name).toBe("경영기획실");
    expect(findUnit("경영전략실")?.name).toBe("경영기획실");
    expect(findUnit("일자리민생")?.name).toBe("일자리민생경제지원실");
    expect(findUnit("민생경제지원팀")?.name).toBe("일자리민생경제지원실");
    expect(findUnit("북부지소")?.name).toBe("지역산업지원단");
    expect(findUnit("ESG기업지원팀")?.name).toBe("강소기업지원실");
    expect(findUnit("esg 기업지원팀")?.name).toBe("강소기업지원실");
    expect(findUnit("알수없는부서")).toBeNull();
  });
  it("gives each unit its 결재라인 and the institution default otherwise", () => {
    expect(approvalLineFor("경영관리팀")).toEqual(["담당", "팀장", "실장", "원장"]);
    expect(approvalLineFor("마케팅팀")).toEqual(["담당", "팀장", "실장", "본부장", "원장"]);
    expect(approvalLineFor("일자리종합지원팀")).toEqual(["담당", "팀장", "실장", "본부장", "원장"]);
    expect(approvalLineFor("동부지소")).toEqual(["담당", "지소장", "단장", "본부장", "원장"]);
    expect(approvalLineFor(undefined)).toEqual(["담당", "팀장", "실장", "본부장", "원장"]);
  });
  it("resolves full names and heads", () => {
    expect(departmentFullName("일자리민생")).toBe("일자리민생경제지원실");
    expect(departmentFullName("기타")).toBe("기타");
    expect(unitHeadFor("전략기획팀")).toBe("실장 남상범");
    expect(unitHeadFor("북부지소")).toBe("단장 남상조");
    expect(orgSummary()).toContain("원장 박성수");
    expect(orgSummary()).toContain("본부장 송호준");
  });
});
