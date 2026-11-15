import { describe, expect, it } from "vitest";
import { hangulSplitWords } from "../../lib/hwpx/keepPass";

/**
 * 한글로 다시 저장한 파일의 줄 시작 위치(lineseg textpos)로 줄 끝에서 쪼개진 단어를 찾는다(2026-11-10:
 * 요지 상자 「…기업의 채 / 용 경쟁력을…」). 우리 파일과 한글 파일의 문단을 순서·글로 짝짓는다.
 */
const TEXT = "중소기업 근로환경 개선 지원은 근로자의 근속 여건을 높이고 기업의 채용 경쟁력을 키우는 사업";
const para = (id: string, text: string, starts?: number[]) =>
  `<hp:p id="${id}" paraPrIDRef="1"><hp:run charPrIDRef="1"><hp:t>${text}</hp:t></hp:run>${
    starts ? `<hp:linesegarray>${starts.map((s) => `<hp:lineseg textpos="${s}"/>`).join("")}</hp:linesegarray>` : ""
  }</hp:p>`;
const sec = (...ps: string[]) => `<?xml version="1.0"?><hs:sec>${ps.join("")}</hs:sec>`;
const box = (inner: string) => `<hp:p id="9"><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList>${inner}</hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>`;

describe("hangulSplitWords", () => {
  const cut = TEXT.indexOf("채용") + 1; // "채 / 용"
  const whole = TEXT.indexOf("채용"); // "채용" 이 통째로 다음 줄
  it("줄 끝에서 쪼개진 단어가 있는 문단과, 끌어올릴 자간 어림을 돌려준다", () => {
    const r = hangulSplitWords(sec(box(para("63", TEXT))), sec(box(para("1", TEXT, [0, cut]))));
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("63");
    expect(r[0].need).toBeGreaterThan(0);
    expect(r[0].need).toBeLessThanOrEqual(6);
  });
  it("단어가 통째로 넘어갔으면 없다", () => {
    expect(hangulSplitWords(sec(para("5", TEXT)), sec(para("1", TEXT, [0, whole])))).toEqual([]);
  });
  it("문단 글이 다르면 짝짓지 않는다", () => {
    expect(hangulSplitWords(sec(para("5", TEXT)), sec(para("1", TEXT + "x", [0, cut])))).toEqual([]);
  });
});
