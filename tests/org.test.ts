import { describe, it, expect } from "vitest";
import { approvalLineFor, approvalLineUpTo, DEFAULT_DELEGATION, DELEGATION_LEVELS, departmentFullName, findUnit, INSTITUTION_HEAD_TITLE, orgSummary, senderTitleFor, unitHeadFor } from "../lib/org";

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

/**
 * 전결 단계 — 결재란을 어디서 끊고 발신명의를 무엇으로 쓸지 한 값으로 정한다
 * (user 2026-09-22). 본부가 있는 부서(마케팅팀 → 강소기업지원실)와 없는 부서
 * (전략기획팀 → 경영기획실, 원장 직속)를 함께 본다 — 본부 없는 부서의 본부장 전결이
 * `undefined장` 같은 값을 만들지 않아야 한다.
 */
describe("전결 단계 (user 2026-09-22)", () => {
  /**
   * 기본값은 글자로 고정한다(user 2026-09-22 결정): 기관 밖으로 나가는 공문은 기관장 명의로
   * 나가므로 안전한 쪽이 결재라인 전체이고, 전결은 그 사슬을 **낮추는** 선택이다. 기본을 낮추면
   * 그렇게 하자고 하지 않은 문서의 결재 사슬이 조용히 짧아진다.
   */
  it("전결을 적지 않은 문서는 원장까지 결재한다", () => {
    expect(DEFAULT_DELEGATION).toBe("원장");
    expect(DELEGATION_LEVELS).toContain(DEFAULT_DELEGATION);
  });

  it("결재라인을 전결 단계에서 끊는다 — 본부 있는 부서", () => {
    expect(approvalLineUpTo("마케팅팀", "실·단장")).toEqual(["담당", "팀장", "실장"]);
    expect(approvalLineUpTo("마케팅팀", "본부장")).toEqual(["담당", "팀장", "실장", "본부장"]);
    expect(approvalLineUpTo("마케팅팀", "원장")).toEqual(["담당", "팀장", "실장", "본부장", "원장"]);
  });

  it("실·단장은 단(單)의 단장도 찾는다 — 지역산업지원단은 실장이 없다", () => {
    expect(approvalLineUpTo("북부지소", "실·단장")).toEqual(["담당", "지소장", "단장"]);
    expect(approvalLineUpTo("북부지소", "원장")).toEqual(["담당", "지소장", "단장", "본부장", "원장"]);
  });

  it("본부 없는 부서에는 본부장 전결이 없다 — undefined 로 알린다", () => {
    expect(approvalLineUpTo("전략기획팀", "실·단장")).toEqual(["담당", "팀장", "실장"]);
    expect(approvalLineUpTo("전략기획팀", "원장")).toEqual(["담당", "팀장", "실장", "원장"]);
    expect(approvalLineUpTo("전략기획팀", "본부장")).toBeUndefined();
  });

  it("발신명의는 결재라인의 마지막 직위에서 나온다", () => {
    expect(senderTitleFor("실장", "전략기획팀")).toBe("경영기획실장");
    expect(senderTitleFor("실장", "마케팅팀")).toBe("강소기업지원실장");
    expect(senderTitleFor("단장", "북부지소")).toBe("지역산업지원단장");
    expect(senderTitleFor("본부장", "마케팅팀")).toBe("강소기업육성본부장");
    expect(senderTitleFor("원장", "마케팅팀")).toBe(INSTITUTION_HEAD_TITLE);
    expect(senderTitleFor("원장", "알수없는부서")).toBe("(재)경상북도경제진흥원장");
  });

  it("규칙이 이름 붙이지 않은 직위·모르는 부서는 undefined — 호출처가 경고와 함께 정한다", () => {
    expect(senderTitleFor("본부장", "전략기획팀")).toBeUndefined(); // 경영기획실은 본부가 없다
    expect(senderTitleFor("팀장", "마케팅팀")).toBeUndefined();
    expect(senderTitleFor("지소장", "북부지소")).toBeUndefined();
    expect(senderTitleFor("실장", "알수없는부서")).toBeUndefined();
    expect(senderTitleFor(undefined, "마케팅팀")).toBeUndefined();
  });
});
