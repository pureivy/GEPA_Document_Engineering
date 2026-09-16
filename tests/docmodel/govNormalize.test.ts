import { describe, it, expect } from "vitest";
import { normalizeDslText, normalizeDocMeta } from "../../lib/docmodel/govNormalize";
import { parseDsl } from "../../lib/docmodel/dsl";

describe("normalizeDslText — 편람 표기 자동 정규화", () => {
  it("attaches tildes, strips zero padding, adds the period before a weekday, spaces glued dates", () => {
    const { text, changes } = normalizeDslText("ㅇ (접수기간) 2026. 07. 01. ~ 07. 15. 18:00\nㅇ 2026.7.14. 개최, 2026. 7. 14(화) 발표\n");
    expect(text).toBe("ㅇ (접수기간) 2026. 7. 1.~7. 15. 18:00\nㅇ 2026. 7. 14. 개최, 2026. 7. 14.(화) 발표\n");
    expect(changes.map((c) => c.rule)).toEqual(expect.arrayContaining(["물결표", "날짜 0 생략", "날짜 띄어쓰기", "날짜 마침표"]));
  });
  it("fixes colon spacing, 끝. spacing and the director placeholder", () => {
    const { text } = normalizeDslText("ㅇ 원장 : 김갑동\nㅇ 지역경제 활성화 도모 끝.\n(재)경상북도경제진흥원(원장 ○○○)은 … ○○○ 원장은 말했다\n");
    expect(text).toContain("원장: 김갑동");
    expect(text).toContain("활성화 도모  끝.");
    expect(text).toContain("(원장 박성수)");
    expect(text).toContain("박성수 원장은");
  });
  it("leaves compliant text alone and also fixes fenced box text", () => {
    const src = "ㅇ 2026. 7. 1.~12. 31. 접수(07. 01.~07. 15.)  끝.\n";
    expect(normalizeDslText(src)).toEqual({ text: "ㅇ 2026. 7. 1.~12. 31. 접수(7. 1.~7. 15.)  끝.\n", changes: [{ rule: "날짜 0 생략", count: 3 }] });
    const ok = "ㅇ 2026. 7. 1.~12. 31.  끝.\n";
    expect(normalizeDslText(ok)).toEqual({ text: ok, changes: [] });
    expect(normalizeDslText("```box\n❖ 2026. 7. 1. ~ 12. 31.\n```\n").text).toContain("2026. 7. 1.~12. 31.");
  });
  it("normalizeDocMeta fills the press department full name and head from the org table", () => {
    const dsl = "---\nfamily: press\n배포일: 2026. 9. 21.(월)\n담당부서: 전략기획팀\n담당자: 박용식 과장\n연락처: 054-470-8500\n제목: 제목\n---\n본문\n";
    const { doc } = parseDsl(dsl);
    const { doc: out, changes } = normalizeDocMeta(doc);
    expect(out.family === "press" && out.meta.담당부서).toBe("경영기획실");
    expect(out.family === "press" && out.meta.책임자).toBe("실장 남상범");
    expect(changes.map((c) => c.rule)).toEqual(["담당부서 정식 명칭", "책임자 자동 채움"]);
  });
});
