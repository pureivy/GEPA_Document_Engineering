import { describe, it, expect } from "vitest";
import { approvalLineFor, departmentFullName, findUnit, orgSummary, unitHeadFor } from "../lib/org";

describe("org table (user-stated 2026-09-16)", () => {
  it("maps teams, units, aliases and abbreviations to their 실/단", () => {
    expect(findUnit("전략기획팀")?.name).toBe("경영기획실");
    expect(findUnit("경영전략실")?.name).toBe("경영기획실");
    expect(findUnit("일자리민생")?.name).toBe("일자리민생경제지원실");
    expect(findUnit("민생경제지원팀")?.name).toBe("일자리민생경제지원실");
    expect(findUnit("북부지소")?.name).toBe("지역산업지원단");
    // 2026-09-22 정정: 경영기획실의 팀은 경영관리팀이 아니라 경영지원팀이다
    // (참고 문서 수신자 목록도 "경영지원팀장, ESG·기업지원팀장, 마케팅팀장 …" 이다)
    expect(findUnit("경영지원팀")?.name).toBe("경영기획실");
    // 옛 이름("경영관리팀")도 alias 로 계속 풀려야 한다 — 그 이름으로 만든 기존 사업계획서의
    // 결재란이 기관 기본값(5단계)으로 조용히 바뀌면 안 된다(byte-level 회귀 금지).
    expect(findUnit("경영관리팀")?.name).toBe("경영기획실");
    expect(approvalLineFor("경영관리팀")).toEqual(["담당", "팀장", "실장", "원장"]);
    expect(departmentFullName("경영관리팀")).toBe("경영기획실");
    expect(unitHeadFor("경영관리팀")).toBe("실장 남상범");
    // 기관 문서는 가운뎃점을 쓰고(`ESG·기업지원팀`) 사람은 빼고도 친다 — 네 표기 모두 붙어야 한다
    expect(findUnit("ESG·기업지원팀")?.name).toBe("강소기업지원실");
    expect(findUnit("ESG기업지원팀")?.name).toBe("강소기업지원실");
    expect(findUnit("esg기업지원팀")?.name).toBe("강소기업지원실");
    expect(findUnit("esg 기업지원팀")?.name).toBe("강소기업지원실");
    expect(findUnit("알수없는부서")).toBeNull();
  });
  it("gives each unit its 결재라인 and the institution default otherwise", () => {
    expect(approvalLineFor("경영지원팀")).toEqual(["담당", "팀장", "실장", "원장"]);
    expect(approvalLineFor("전략기획팀")).toEqual(["담당", "팀장", "실장", "원장"]);
    expect(approvalLineFor("마케팅팀")).toEqual(["담당", "팀장", "실장", "본부장", "원장"]);
    // 가운뎃점 표기도 5단계를 찾아야 한다 — 기관 기본값(우연히 같은 값)으로 떨어지면 안 된다
    expect(approvalLineFor("ESG·기업지원팀")).toEqual(["담당", "팀장", "실장", "본부장", "원장"]);
    expect(findUnit("ESG·기업지원팀")).not.toBeNull();
    expect(approvalLineFor("일자리종합지원팀")).toEqual(["담당", "팀장", "실장", "본부장", "원장"]);
    expect(approvalLineFor("동부지소")).toEqual(["담당", "지소장", "단장", "본부장", "원장"]);
    expect(approvalLineFor(undefined)).toEqual(["담당", "팀장", "실장", "본부장", "원장"]);
    expect(approvalLineFor("알수없는부서")).toEqual(["담당", "팀장", "실장", "본부장", "원장"]); // 기관 기본값
    expect(findUnit("알수없는부서")).toBeNull();
  });
  it("본부 소속을 빠짐없이 적는다 — 결재라인에 본부장이 있는 실·단은 본부 산하다", () => {
    // orgSummary() 가 에이전트 프롬프트에 들어간다(lib/org.ts:64) — division 이 비면 본부장에게
    // 결재를 받는 부서가 원장 직속인 것처럼 설명된다
    for (const team of ["마케팅팀", "일자리종합지원팀", "북부지소"]) {
      expect(findUnit(team)?.division, team).toBe("강소기업육성본부");
      expect(approvalLineFor(team), team).toContain("본부장");
    }
    expect(findUnit("전략기획팀")?.division).toBeUndefined(); // 경영기획실은 원장 직속
    expect(orgSummary()).toContain("일자리민생경제지원실(일자리종합지원팀·민생경제지원팀, 강소기업육성본부 산하");
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
