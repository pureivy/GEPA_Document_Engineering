/**
 * 관련 문서 여러 개 → base-plan.md 하나(referenceMarkdownMulti).
 * 파일이 하나면 예전 문자열 그대로여야 한다(얼어붙은 세 family 와 단일 파일 테스트가 읽는 문자열).
 */
import { describe, it, expect } from "vitest";
import { referenceMarkdown, referenceMarkdownMulti, REFERENCE_TOTAL_MAX_CHARS } from "../../lib/reference/extract";

describe("referenceMarkdownMulti", () => {
  it("파일이 하나면 referenceMarkdown 과 글자 하나 다르지 않다", () => {
    expect(referenceMarkdownMulti([{ fileName: "plan.hwp", text: "본문" }], "2027년으로 변경")).toBe(referenceMarkdown("plan.hwp", "2027년으로 변경", "본문"));
    expect(referenceMarkdownMulti([{ fileName: "서식.hwp", text: "본문" }], "", "붙임")).toBe(referenceMarkdown("서식.hwp", "", "본문", "붙임"));
  });

  it("사업계획서 갱신(용도 없음): 첫 파일이 기존 계획서, 나머지는 함께 올린 참고 문서로 절을 나눈다", () => {
    const md = referenceMarkdownMulti(
      [
        { fileName: "2026 계획서.hwpx", text: "계획서 본문" },
        { fileName: "결과보고.pdf", text: "결과 본문" },
        { fileName: "메모.txt", text: "메모 본문" },
      ],
      "연도 2027",
    );
    expect(md).toContain("# 기존 사업계획서 — 2026 계획서.hwpx (함께 올린 참고 문서 2건: 결과보고.pdf, 메모.txt)");
    expect(md).toContain("## 이번 프로젝트에서 바뀌는 내용\n\n연도 2027");
    expect(md).toContain("## 기존 사업계획서 원문 — 2026 계획서.hwpx\n\n계획서 본문");
    expect(md).toContain("## 함께 올린 참고 문서 2/3 원문 — 결과보고.pdf\n\n결과 본문");
    expect(md).toContain("## 함께 올린 참고 문서 3/3 원문 — 메모.txt\n\n메모 본문");
    // 순서가 곧 역할이다 — 계획서 절이 참고 문서 절보다 앞에 온다
    expect(md.indexOf("기존 사업계획서 원문")).toBeLessThan(md.indexOf("함께 올린 참고 문서 2/3"));
  });

  it("용도가 있으면 모든 파일이 그 용도로 소개되고, 적어 둔 내용은 한 번만 실린다", () => {
    const md = referenceMarkdownMulti(
      [
        { fileName: "a.hwp", text: "A 본문" },
        { fileName: "b.pdf", text: "B 본문" },
      ],
      "둘 다 회신 근거",
      "근거자료",
    );
    expect(md).toContain("# 참고 문서 2건 — a.hwp, b.pdf");
    expect(md.match(/## 이 문서에서 쓸 내용/g)).toHaveLength(1);
    expect(md).toContain("## 참고 문서 1/2 원문 — a.hwp\n\nA 본문");
    expect(md).toContain("## 참고 문서 2/2 원문 — b.pdf\n\nB 본문");
    expect(md).not.toContain("기존 사업계획서");
    // 적어 둔 내용이 없으면 절 자체가 없다(단일 파일과 같은 규칙)
    expect(referenceMarkdownMulti([{ fileName: "a.hwp", text: "A" }, { fileName: "b.pdf", text: "B" }], "  ", "붙임")).not.toContain("붙임에 적을 이름");
  });

  it("전체 분량을 묶어 제한한다 — 뒤 파일부터 잘리고, 다 찬 뒤의 파일은 생략 표시만 남는다", () => {
    const big = "가".repeat(REFERENCE_TOTAL_MAX_CHARS - 10);
    const md = referenceMarkdownMulti(
      [
        { fileName: "a.txt", text: big },
        { fileName: "b.txt", text: "나".repeat(100) },
        { fileName: "c.txt", text: "다".repeat(100) },
      ],
      "",
      "근거자료",
    );
    expect(md).toContain("[… 이하 생략 …]");
    expect(md).toContain("## 참고 문서 3/3 원문 — c.txt\n\n[… 전체 분량 제한으로 생략 …]");
    expect(md.length).toBeLessThan(REFERENCE_TOTAL_MAX_CHARS + 1000);
  });

  it("빈 목록은 거부한다", () => {
    expect(() => referenceMarkdownMulti([], "")).toThrow();
  });
});
