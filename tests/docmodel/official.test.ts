import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OfficialMetaSchema, officialMetaProblems } from "../../lib/docmodel/schema";

const BASE = {
  수신유형: "수신자참조" as const,
  수신자: ["경영지원팀장", "마케팅팀장"],
  제목: "경영평가 대응을 위한 2026년 사업 추진 현황 제출 요청",
  처리과: "전략기획팀",
};

describe("OfficialMetaSchema", () => {
  it("세 가지 수신유형이 모두 파싱된다", () => {
    expect(OfficialMetaSchema.safeParse(BASE).success).toBe(true);
    expect(OfficialMetaSchema.safeParse({ 수신유형: "수신자", 수신: "경영기획실장(경영지원팀장)", 제목: "가", 처리과: "마케팅팀" }).success).toBe(true);
    expect(OfficialMetaSchema.safeParse({ 수신유형: "내부결재", 제목: "지원금 지급(6차)", 처리과: "마케팅팀" }).success).toBe(true);
  });

  it("평범한 ZodObject 여야 한다 — frontmatter 의 미지 키 검사가 shape 를 읽는다", () => {
    // superRefine 으로 감싸도 여전히 ZodObject·shape 는 살아 있다(zod 4.6.5 실측) — 그래서
    // officialMetaProblems 를 스키마 refine 으로 넣지 않는 이유는 이게 아니라, 파싱 자체를
    // 실패시키지 않고 문서를 경고와 함께 만들어 내야 하기 때문이다(schema.ts officialMetaProblems 참조).
    expect(OfficialMetaSchema).toBeInstanceOf(z.ZodObject);
    expect(Object.keys(OfficialMetaSchema.shape)).toContain("수신유형");
  });

  it("기본값: 공개구분=공개, 시행일·경유는 빈 문자열, 붙임·협조자는 빈 배열", () => {
    const m = OfficialMetaSchema.parse(BASE);
    expect(m.공개구분).toBe("공개");
    expect(m.시행일).toBe("");
    expect(m.경유).toBe("");
    expect(m.붙임).toEqual([]);
    expect(m.협조자).toEqual([]);
  });

  it("시행번호 키를 받지 않는다 — 일련번호는 전자결재가 채번한다", () => {
    const parsed = OfficialMetaSchema.parse({ ...BASE, 시행번호: "전략기획팀-485" } as Record<string, unknown>);
    expect("시행번호" in parsed).toBe(false);
  });
});

describe("officialMetaProblems", () => {
  it("수신유형=수신자참조 인데 수신자가 비면 문제를 낸다", () => {
    expect(officialMetaProblems(OfficialMetaSchema.parse(BASE))).toEqual([]);
    const empty = OfficialMetaSchema.parse({ ...BASE, 수신자: [] });
    expect(officialMetaProblems(empty)).toHaveLength(1);
    expect(officialMetaProblems(empty)[0]).toContain("수신자");
  });

  it("수신유형=수신자 인데 수신이 비면 문제를 낸다", () => {
    const m = OfficialMetaSchema.parse({ 수신유형: "수신자", 제목: "가", 처리과: "마케팅팀" });
    expect(officialMetaProblems(m)).toHaveLength(1);
    expect(officialMetaProblems(m)[0]).toContain("수신");
  });

  it("내부결재 는 수신·수신자 없이도 문제가 없다", () => {
    const m = OfficialMetaSchema.parse({ 수신유형: "내부결재", 제목: "가", 처리과: "마케팅팀" });
    expect(officialMetaProblems(m)).toEqual([]);
  });

  // 내부결재는 받는 곳이 없다. 폼은 이 상태를 못 만드니 값이 있으면 에이전트가 지어낸 것이다.
  it("내부결재 인데 수신이 있으면 문제를 낸다", () => {
    const m = OfficialMetaSchema.parse({ 수신유형: "내부결재", 수신: "경상북도지사", 제목: "가", 처리과: "마케팅팀" });
    expect(officialMetaProblems(m)).toHaveLength(1);
    expect(officialMetaProblems(m)[0]).toContain("내부결재");
    expect(officialMetaProblems(m)[0]).toContain("수신");
  });

  it("내부결재 인데 수신자가 있으면 문제를 낸다", () => {
    const m = OfficialMetaSchema.parse({ 수신유형: "내부결재", 수신자: ["마케팅팀장"], 제목: "가", 처리과: "마케팅팀" });
    expect(officialMetaProblems(m)).toHaveLength(1);
    expect(officialMetaProblems(m)[0]).toContain("수신자");
  });

  it("내부결재 인데 둘 다 있으면 각각을 지적한다", () => {
    const m = OfficialMetaSchema.parse({ 수신유형: "내부결재", 수신: "경상북도지사", 수신자: ["마케팅팀장"], 제목: "가", 처리과: "마케팅팀" });
    expect(officialMetaProblems(m)).toHaveLength(2);
  });

  it("빈 문자열·빈 배열은 값이 아니다 — 내부결재에서 문제가 되지 않는다", () => {
    const m = OfficialMetaSchema.parse({ 수신유형: "내부결재", 수신: "  ", 수신자: [], 제목: "가", 처리과: "마케팅팀" });
    expect(officialMetaProblems(m)).toEqual([]);
  });
});
