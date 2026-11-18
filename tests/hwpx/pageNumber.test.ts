import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { dropPageNumber } from "../../lib/hwpx/pageNumber";

/** 담당자 2026-11-18: 한 장짜리 보고자료에는 쪽번호(- 1 -)를 넣지 않는다 */
describe("한 장 문서 쪽번호 빼기", () => {
  const sec = `<hs:sec><hp:p><hp:run><hp:secPr/></hp:run><hp:run><hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl></hp:run><hp:run><hp:t>본문</hp:t></hp:run></hp:p></hs:sec>`;
  const hwpx = (s: string) => zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }], "Contents/section0.xml": strToU8(s) });

  it("쪽번호 컨트롤만 빼고 본문·구역 설정은 그대로 둔다", () => {
    const r = dropPageNumber(hwpx(sec));
    expect(r.removed).toBe(true);
    const out = unzipSync(r.bytes);
    expect(Object.keys(out)[0]).toBe("mimetype");
    const xml = strFromU8(out["Contents/section0.xml"]);
    expect(xml).not.toContain("hp:pageNum");
    expect(xml).toContain("<hp:secPr/>");
    expect(xml).toContain("<hp:t>본문</hp:t>");
  });

  it("쪽번호가 없으면 바이트를 그대로 돌려준다", () => {
    const b = hwpx("<hs:sec><hp:p><hp:run><hp:t>x</hp:t></hp:run></hp:p></hs:sec>");
    const r = dropPageNumber(b);
    expect(r.removed).toBe(false);
    expect(r.bytes).toBe(b);
  });
});
