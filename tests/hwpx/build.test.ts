import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";
import { noticeFixture, planFixture, pressFixture } from "../fixtures/docs";

const NOW = new Date("2026-09-15T00:00:00Z");

function leadingSpaceSeq(text: string): number[] {
  return text.split("\n").filter((l) => /^ *[□ㅇ○◦\-·※*]/.test(l)).map((l) => l.length - l.trimStart().length);
}

describe("buildHwpx — notice", () => {
  const { bytes, report } = buildHwpx(noticeFixture(), { now: NOW });
  it("zip layout: mimetype first and stored", () => {
    const names = Object.keys(unzipSync(bytes));
    expect(names[0]).toBe("mimetype");
    expect(names).toContain("Contents/header.xml");
    expect(names).toContain("Contents/section0.xml");
    expect(names).toContain("BinData/image1.png");
    expect(names).not.toContain("META-INF/rhwp-hwp5-origin");
    // stored (method 0) → local header bytes 8-9 are 0
    expect(bytes[8]).toBe(0);
    expect(bytes[9]).toBe(0);
  });
  it("is deterministic", () => {
    const again = buildHwpx(noticeFixture(), { now: NOW }).bytes;
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });
  it("validates through @rhwp/core with zero content loss", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.pageCount).toBeGreaterThanOrEqual(3);
    expect(v.contentLoss?.count).toBe(0);
  }, 60_000);
  it("keeps the glyph ladder as literal leading spaces (□0 ㅇ1 -3 ※2 *1)", async () => {
    const text = await extractText(bytes);
    const body = text.slice(text.indexOf("3. 사업목적"));
    expect(leadingSpaceSeq(body).slice(0, 5)).toEqual([0, 0, 1, 3, 1]);
    expect(text).toContain("(재)경상북도경제진흥원 공고 제2026070000호");
    expect(text).toContain("www.gepa.kr");
    expect(text).toContain("1. 모집개요");
    expect(text).toContain("※ 상기 일정은 추진 상황에 따라 변경될 수 있음");
  });
  it("uses only catalogued reference styles except hanging-indent paraPr variants", () => {
    expect(report.appendedStyles.filter((a) => a.kind === "charPr")).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.tables).toBeGreaterThanOrEqual(7);
    expect(report.pictures).toBe(3); // logo + 2 chevrons
  });
  it("section bar keeps the reference geometry (48190 wide, 3330 tall, gradient strip)", () => {
    const sec = new TextDecoder().decode(unzipSync(bytes)["Contents/section0.xml"]);
    expect(sec).toMatch(/<hp:sz width="48190" widthRelTo="ABSOLUTE" height="3330"/);
    const head = new TextDecoder().decode(unzipSync(bytes)["Contents/header.xml"]);
    expect(head).toContain('<hc:color value="#47B0BB"/><hc:color value="#D0EAED"/>');
    expect(sec).toContain('borderFillIDRef="13"'); // the reference gradient fill id was reused
  });
});

describe("buildHwpx — plan", () => {
  const { bytes, report } = buildHwpx(planFixture(), { now: NOW });
  it("approval line follows the department (lib/org.ts) and can be overridden", async () => {
    // fixture 부서 = 북부지소 → 지역산업지원단: 담당·지소장·단장·본부장·원장
    const text = await extractText(bytes);
    for (const l of ["담  당", "지소장", "단장", "본부장", "원장"]) expect(text).toContain(l);
    expect(text).not.toContain("팀장");
    // unknown department → institution default 담당·팀장·실장·본부장·원장
    const other = planFixture();
    (other.meta as { 부서?: string }).부서 = "미지의부서";
    const otherText = await extractText(buildHwpx(other, { now: NOW }).bytes);
    for (const l of ["팀장", "실장", "본부장"]) expect(otherText).toContain(l);
    expect(otherText).not.toContain("지소장");
    // 경영기획실 team → 4 steps, no 본부장
    const hq = planFixture();
    (hq.meta as { 부서?: string }).부서 = "전략기획팀";
    const hqText = await extractText(buildHwpx(hq, { now: NOW }).bytes);
    expect(hqText).toContain("실장");
    expect(hqText).not.toContain("본부장");
    // explicit 결재.라인 wins
    const doc = planFixture();
    (doc.meta as { 결재?: Record<string, unknown> }).결재 = { ...(doc.meta as { 결재?: Record<string, unknown> }).결재, 라인: ["담당", "팀장", "실장", "원장"] };
    expect(await extractText(buildHwpx(doc, { now: NOW }).bytes)).toContain("팀장");
  });
  it("validates and keeps the chapter band widths", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    const sec = new TextDecoder().decode(unzipSync(bytes)["Contents/section0.xml"]);
    expect(sec).toMatch(/<hp:cellSz width="2986" height="3074"\/>/);
    expect(sec).toMatch(/<hp:cellSz width="44557" height="3074"\/>/);
    expect(report.warnings).toEqual([]);
  }, 60_000);
  it("carries section-scoped controls exactly once (Hancom refuses a second secPr — the approval block clones the reference's first paragraph)", () => {
    const sec = new TextDecoder().decode(unzipSync(bytes)["Contents/section0.xml"]);
    expect(sec.match(/<hp:secPr /g)?.length).toBe(1);
    expect(sec.match(/<hp:colPr /g)?.length).toBe(1);
    expect(sec.match(/<hp:pageNum /g)?.length).toBe(1);
    expect(sec.match(/<hp:pageHiding /g)?.length).toBe(1);
    // secPr run first, then the page-number run, in paragraph 0
    const p0 = sec.slice(sec.indexOf("<hp:p "), sec.indexOf("</hp:p>"));
    expect(p0.indexOf("<hp:secPr ")).toBeLessThan(p0.indexOf("<hp:pageNum "));
    expect(sec).not.toMatch(/<hp:run charPrIDRef="\d+"><\/hp:run>/);
  });
  it("ladder for plan defaults to the 편람 2타 ladder □0 ㅇ2 -4 ·6 (※ two more than the item it annotates)", async () => {
    const text = await extractText(bytes);
    const body = text.slice(text.indexOf("□ 추진배경") - 1);
    expect(leadingSpaceSeq(body).slice(0, 5)).toEqual([0, 2, 4, 6, 8]);
  });
  it("ladder: gepa keeps the reference habit □1 ㅇ2 -3 ·4 ※1", async () => {
    const doc = planFixture();
    (doc.meta as { ladder?: string }).ladder = "gepa";
    const text = await extractText(buildHwpx(doc, { now: NOW }).bytes);
    const body = text.split("\n").filter((l) => /^ *[□ㅇ○\-·※]/.test(l)).join("\n");
    expect(leadingSpaceSeq(body).slice(0, 5)).toEqual([1, 2, 3, 4, 1]);
    expect(text).toContain("끝.");
  });
});

describe("buildHwpx — press", () => {
  it("validates", async () => {
    const { bytes, report } = buildHwpx(pressFixture(), { now: NOW });
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    const text = await extractText(bytes);
    // "보도자료" is the reference logotype image; the 머리표 text starts with the date and labels
    expect(text).toContain("【26. 7. 1(수)】");
    for (const s of ["담당부서", "북부지소", "작 성 자", "실장", "김OO", "팀장", "김OO (gepa_north@naver.com)", "연 락 처", "054-900-3801"]) expect(text).toContain(s);
    expect(text).toContain("- 7월 15일까지 접수… 기업당 최대 300만원 지원 -");
    expect(text).toContain("□ 지원내용"); // □ heading inside the grey box (bold), ㅇ items become •
    expect(text).toContain("  • 수출용 홍보물 제작 등 4개 분야 11개 사업");
    expect(text).toContain("붙임  사업 공고문 1부  끝.");
    expect(report.tables).toBe(3); // 머리표 + 제목 box + grey bullet box
    expect(report.pictures).toBe(2); // GEPA 로고 + 보도자료 로고타입
    expect(v.pageCount).toBe(1);
  }, 60_000);
});
