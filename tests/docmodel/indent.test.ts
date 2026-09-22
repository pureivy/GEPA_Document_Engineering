/**
 * 편람 §3 글 번호 사다리 — `1.` → `가.` → `1)` → `가)` → `(1)` → `(가)` → `①` → `㉮` 가
 * 한 단계마다 2타씩 오른쪽으로 간다(사용자 2026-09-22: 참고 문서의 관행 4타가 아니라 편람 2타).
 * 기호 사다리(leadingSpaces)와 값은 같지만 담기는 곳이 달라 따로 둔다 — glyph 가 아니라 본문 글자다.
 */
import { describe, expect, it } from "vitest";
import { manualMarkerIndent } from "../../lib/docmodel/indent";

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
