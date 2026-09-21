import { describe, expect, it } from "vitest";
import { DOC_FAMILIES } from "../../lib/docmodel/families";
import { leadingSpaces, noteIndentUnder } from "../../lib/docmodel/indent";
import { FamilySchema } from "../../lib/docmodel/schema";
import type { DocModel } from "../../lib/docmodel/schema";
import { fallbackMeta } from "../../lib/docmodel/dsl/frontmatter";

describe("DOC_FAMILIES", () => {
  it("has an entry for every family in the schema", () => {
    expect(Object.keys(DOC_FAMILIES).sort()).toEqual([...FamilySchema.options].sort());
  });

  it("keeps the reference ladders byte-for-byte", () => {
    expect(DOC_FAMILIES.notice.indent).toEqual({ "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 1 });
    expect(DOC_FAMILIES.plan.indent).toEqual({ "□": 1, "ㅇ": 2, "○": 2, "◦": 2, "-": 3, "·": 4, "※": 1, "*": 2 });
    expect(DOC_FAMILIES.press.indent).toEqual({ "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 2 });
  });
});

describe("leadingSpaces (unchanged behaviour)", () => {
  it("reads the family ladder", () => {
    expect(leadingSpaces("plan", "□", "body1")).toBe(1);
    expect(leadingSpaces("notice", "□", "body1")).toBe(0);
    expect(leadingSpaces("press", "*", "footnote")).toBe(2);
    expect(leadingSpaces("notice", "*", "footnote")).toBe(1);
  });
  it("still applies the gov ladder regardless of family", () => {
    expect(leadingSpaces("plan", "-", "body3", "gov")).toBe(4);
    expect(leadingSpaces("notice", "·", "body4", "gov")).toBe(6);
  });
  it("still returns 2 for a 인사말 without a glyph", () => {
    expect(leadingSpaces("notice", undefined, "greeting")).toBe(2);
    expect(leadingSpaces("notice", undefined, "body1")).toBe(0);
  });
});

describe("noteIndentUnder (unchanged behaviour)", () => {
  it("uses 3 for plan and 4 for the others", () => {
    expect(noteIndentUnder("plan", "ㅇ")).toBe(3);
    expect(noteIndentUnder("notice", "ㅇ")).toBe(4);
    expect(noteIndentUnder("press", "-")).toBe(4);
  });
  it("adds 2 to the gov ladder", () => {
    expect(noteIndentUnder("plan", "ㅇ", "gov")).toBe(4);
    expect(noteIndentUnder("plan", "-", "gov")).toBe(6);
  });
  it("returns undefined without a previous glyph or for a top-level item", () => {
    expect(noteIndentUnder("plan", undefined)).toBeUndefined();
    expect(noteIndentUnder("plan", "□")).toBeUndefined();
  });
});

describe("DOC_FAMILIES.docTitle", () => {
  it("공고문은 사업명·모집대상으로 제목을 만든다", () => {
    const meta = { ...(fallbackMeta("notice") as Record<string, unknown>), 사업명: "수출바우처", 모집대상: "참여기업" };
    const doc = { version: 1, family: "notice", meta, blocks: [] } as unknown as DocModel;
    expect(DOC_FAMILIES.notice.docTitle(doc)).toBe("「수출바우처」 참여기업 모집 공고");
  });
  it("사업계획서·보도자료는 제목 메타를 그대로 쓴다", () => {
    const plan = { version: 1, family: "plan", meta: { ...(fallbackMeta("plan") as Record<string, unknown>), 제목: "안동시 지원사업" }, blocks: [] } as unknown as DocModel;
    expect(DOC_FAMILIES.plan.docTitle(plan)).toBe("안동시 지원사업");
    const press = { version: 1, family: "press", meta: { ...(fallbackMeta("press") as Record<string, unknown>), 제목: "경북도, 실라리안 육성" }, blocks: [] } as unknown as DocModel;
    expect(DOC_FAMILIES.press.docTitle(press)).toBe("경북도, 실라리안 육성");
  });
});
