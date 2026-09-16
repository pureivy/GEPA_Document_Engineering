import { describe, expect, it } from "vitest";
import { BOILERPLATE_NAMES, expandBoilerplate, NOTICE_기타유의사항, NOTICE_지급방법, NOTICE_지급방법_기관, NOTICE_참여제한대상, NOTICE_참여제한대상_기관, NOTICE_이의제기, PLAN_정산문구 } from "../../lib/docmodel/boilerplate";
import { parseDsl } from "../../lib/docmodel/dsl";
import { paras, plain } from "./helpers";

describe("expandBoilerplate", () => {
  it("knows every macro named in the grammar", () => {
    for (const name of BOILERPLATE_NAMES) expect(expandBoilerplate(name, { 주관기관: "안동시" }), name).toBeDefined();
    expect(expandBoilerplate("없는매크로")).toBeUndefined();
  });
  it("returns the fixed sentences byte-for-byte", () => {
    expect(expandBoilerplate("일정변경")).toEqual(["※ 상기 일정은 추진 상황에 따라 변경될 수 있음"]);
    expect(expandBoilerplate("예산상황")).toEqual(["※ 예산상황에 따라 선정기업은 변동될 수 있음"]);
    expect(expandBoilerplate("기업부담금")).toEqual(["※ 최대 지원한도에 따라 기업부담금 증가할 수 있음"]);
    expect(expandBoilerplate("정산문구")).toEqual([`※ ${PLAN_정산문구}`]);
    expect(expandBoilerplate("이의제기")).toEqual([`○ ${NOTICE_이의제기}`]);
    expect(expandBoilerplate("끝")).toEqual(["끝."]);
    expect(expandBoilerplate("참여제한대상")).toEqual([...NOTICE_참여제한대상]);
    expect(NOTICE_참여제한대상).toHaveLength(8);
    expect(NOTICE_참여제한대상.slice(1).every((l) => l.startsWith("◦ "))).toBe(true);
  });
  it("지급방법 keeps the 기업게좌 typo and ignores the 이메일 argument", () => {
    const lines = expandBoilerplate("지급방법", { 이메일: "x@y.z" })!;
    expect(lines).toEqual([...NOTICE_지급방법]);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("ㅇ 선정기업 개별 비용 선 결제 후 제출한 결과보고서와 청구서를 검토하여 증빙서류 확인 후 인정금액 기업게좌로 직접 송금");
    expect(lines.join("\n")).not.toContain("x@y.z");
  });
  it("기타유의사항 substitutes 주관기관 and links www.gepa.kr", () => {
    const lines = expandBoilerplate("기타유의사항", { 주관기관: "영양군" })!;
    expect(lines).toHaveLength(6);
    expect(lines[4]).toContain("영양군 또는 경상북도경제진흥원의 해석에 따름");
    expect(lines[5]).toContain("[www.gepa.kr](http://www.gepa.kr)");
    expect(NOTICE_기타유의사항[4]).toContain("{{주관기관}}");
  });
  it("macros with an unknown name degrade to a plain paragraph with a warning", () => {
    const r = parseDsl("---\nfamily: plan\n제목: t\n---\n{{boilerplate:없음 a=1}}\n");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].line).toBe(5);
    expect(plain(paras(r.doc).at(-1)!)).toBe("{{boilerplate:없음 a=1}}");
  });
});

describe("institutional variants (대상=기관)", () => {
  it("swaps the 기업 sentences for the 기관 ones and leaves everything else identical", () => {
    const inst = { 대상: "기관", 주관기관: "경상북도" };
    expect(expandBoilerplate("참여제한대상", inst)).toEqual([...NOTICE_참여제한대상_기관]);
    expect(NOTICE_참여제한대상_기관[0]).toBe(NOTICE_참여제한대상[0]);
    expect(NOTICE_참여제한대상_기관.join("\n")).not.toMatch(/기업/);
    expect(expandBoilerplate("지급방법", inst)).toEqual([...NOTICE_지급방법_기관]);
    expect(NOTICE_지급방법_기관.join("\n")).not.toContain("기업게좌");
    expect(expandBoilerplate("예산상황", inst)).toEqual(["※ 예산상황에 따라 선정 기관 수 및 기관별 지원 규모는 변동될 수 있음"]);
    expect(expandBoilerplate("기업부담금", inst)).toEqual(["※ 최대 지원한도에 따라 선정 기관의 지방비 부담이 증가할 수 있음"]);
    const other = expandBoilerplate("기타유의사항", inst)!;
    expect(other).toHaveLength(NOTICE_기타유의사항.length);
    expect(other[0]).toBe("ㅇ 신청 기관은 자격요건 등이 적합한지를 정확히 확인한 후 신청");
    expect(other[4]).toContain("책임은 신청 기관에 있으며");
    expect(other[4]).toContain("경상북도 또는 경상북도경제진흥원의 해석에 따름");
    expect(other.slice(1, 4)).toEqual(NOTICE_기타유의사항.slice(1, 4));
  });
  it("any other 대상 value (or none) keeps the 기업 text", () => {
    expect(expandBoilerplate("지급방법", { 대상: "기업" })).toEqual([...NOTICE_지급방법]);
    expect(expandBoilerplate("참여제한대상", {})).toEqual([...NOTICE_참여제한대상]);
  });
  it("parses through the DSL like the 기업 macros", () => {
    const r = parseDsl("---\nfamily: notice\n공고번호: 2026090001\n사업명: t\n---\n# 지원내용\n{{boilerplate:지급방법 대상=기관}}\n");
    const texts = paras(r.doc).map(plain);
    expect(texts).toContain("사업비 교부 및 정산"); // plain() drops the glyph
    expect(texts.some((t) => t.includes("지방보조금 관리 조례"))).toBe(true);
    expect(r.warnings.filter((w) => /boilerplate/.test(w.message))).toHaveLength(0);
  });
});
