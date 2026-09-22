/**
 * 편람 §3 글 번호 사다리 — `1.` → `가.` → `1)` → `가)` → `(1)` → `(가)` → `①` → `㉮` 가
 * 한 단계마다 2타씩 오른쪽으로 간다(사용자 2026-09-22: 참고 문서의 관행 4타가 아니라 편람 2타).
 * 기호 사다리(leadingSpaces)와 값은 같지만 담기는 곳이 달라 따로 둔다 — glyph 가 아니라 본문 글자다.
 */
import { describe, expect, it } from "vitest";
import { glyphRole, leadingSpaces, manualMarkerIndent } from "../../lib/docmodel/indent";
import type { Glyph, ParaRole } from "../../lib/docmodel/schema";

describe("manualMarkerIndent — 편람 번호 표지의 단계별 들여쓰기", () => {
  const ladder: [string, number][] = [
    ["1. 작성대상: 전체 사업", 0],
    ["12. 열두 번째 항목", 0],
    ["가. 둘째 단계", 2],
    ["하. 열넷째 글자도 표지다", 2],
    ["1) 셋째 단계", 4],
    ["가) 넷째 단계", 6],
    ["(1) 다섯째 단계", 8],
    ["(가) 여섯째 단계", 10],
    ["① 일곱째 단계", 12],
    ["⑳ 스무 번째 동그라미", 12],
    ["㉮ 여덟째 단계", 14],
    ["㉻ 마지막 동그라미 한글", 14],
  ];
  for (const [text, indent] of ladder) {
    it(`"${text.slice(0, 6)}…" → ${indent}타`, () => {
      expect(manualMarkerIndent(text)).toBe(indent);
    });
  }

  it("표지만 있고 내용이 없는 줄도 단계를 알아본다", () => {
    expect(manualMarkerIndent("가.")).toBe(2);
    expect(manualMarkerIndent("(1)")).toBe(8);
  });

  it("표지가 없는 문단은 undefined — 들여쓰기를 건드리지 않는다", () => {
    expect(manualMarkerIndent("경영평가 상시대응체계 구축을 위해 …")).toBeUndefined();
    expect(manualMarkerIndent("붙임  (양식) 2026년 사업 추진 현황 1부.  끝.")).toBeUndefined();
    expect(manualMarkerIndent("")).toBeUndefined();
  });

  /** 표지 뒤에는 1타가 온다(편람 §3-3) — 숫자·글자에 붙은 글은 항목이 아니다 */
  it("표지 뒤에 공백이 없으면 항목이 아니다", () => {
    expect(manualMarkerIndent("1.5배로 늘린다")).toBeUndefined();
    expect(manualMarkerIndent("2026. 8. 10.(월)까지")).toBe(0); // 앞이 `2026.` + 공백 — 0타라 들여쓰기는 그대로다
    expect(manualMarkerIndent("(1)번을 고른다")).toBeUndefined();
  });

  /** 편람이 쓰는 14 글자 밖의 한글은 표지가 아니다 — 보통 문장이 항목으로 둔갑하지 않게 한다 */
  it("가나다…하 밖의 한글은 표지가 아니다", () => {
    expect(manualMarkerIndent("나. 두 번째")).toBe(2);
    expect(manualMarkerIndent("전. 이런 글자는 항목 기호가 아니다")).toBeUndefined();
    expect(manualMarkerIndent("각) 이것도 아니다")).toBeUndefined();
  });
});

/**
 * 업무보고 사다리 — 요약문(무표식) → 소제목 → `● ` → `   - `(공백 3 + 하이픈).
 *
 * 타수는 **들여쓰기가 실제로 사는 자리**에서 본다. 쪽을 그린 XML 에 대고 보면 표지 한 글자를
 * 알아보려고 판독기·글꼴·쪽 나눔까지 함께 걸리는데, 그것들은 이 규칙과 상관없이 깨질 수 있다.
 */
describe("leadingSpaces — 업무보고(report) 기호 사다리", () => {
  const ladder: [Glyph, ParaRole, number][] = [
    ["ㅇ", "body2", 0], // 일반현황의 평평한 목록 — 0타
    ["●", "body2", 0],
    ["-", "body3", 3],
    ["·", "body4", 3],
  ];
  for (const [glyph, role, indent] of ladder) {
    it(`\`${glyph}\` → ${indent}타`, () => {
      expect(leadingSpaces("report", glyph, role)).toBe(indent);
    });
  }

  it("소제목 `□` 는 0타 — 기호 자리를 도형 칩이 대신한다", () => {
    // 작성기(lib/hwpx/writers/report.ts:ladderPara)가 `□` 를 글자로 내지 않고 인라인
    // `hp:container` 칩으로 바꾼다. 그 칩이 글줄 맨 앞에 서므로 앞 공백이 없어야 한다.
    expect(leadingSpaces("report", "□", "body1")).toBe(0);
  });

  it("기호가 가리키는 역할은 family 를 타지 않는다", () => {
    expect(glyphRole("ㅇ")).toBe("body2");
    expect(glyphRole("●")).toBe("body2"); // `-` 보다 한 칸 얕다
    expect(glyphRole("□")).toBe("body1");
    expect(glyphRole("-")).toBe("body3");
  });
});
