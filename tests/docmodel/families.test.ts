import { describe, expect, it } from "vitest";
import { DOC_FAMILIES } from "../../lib/docmodel/families";
import { leadingSpaces, noteIndentUnder } from "../../lib/docmodel/indent";
import { FamilySchema } from "../../lib/docmodel/schema";
import type { DocModel } from "../../lib/docmodel/schema";
import { fallbackMeta } from "../../lib/docmodel/dsl/frontmatter";
import { familyContext } from "../../lib/docmodel/dsl/expanders";

describe("DOC_FAMILIES", () => {
  it("has an entry for every family in the schema", () => {
    expect(Object.keys(DOC_FAMILIES).sort()).toEqual([...FamilySchema.options].sort());
  });

  it("keeps the reference ladders byte-for-byte", () => {
    expect(DOC_FAMILIES.notice.indent).toEqual({ "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 1 });
    expect(DOC_FAMILIES.plan.indent).toEqual({ "□": 1, "ㅇ": 2, "○": 2, "◦": 2, "-": 3, "·": 4, "※": 1, "*": 2 });
    expect(DOC_FAMILIES.press.indent).toEqual({ "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 2 });
    // 업무보고는 참고본 실측 사다리다 — 편람 2타(공문)도 사업계획서 사다리도 아니다
    expect(DOC_FAMILIES.report.indent).toEqual({ "●": 1, "-": 3, "ㅇ": 1, "·": 3 });
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

describe("DOC_FAMILIES.exportBaseName", () => {
  it("업무보고서는 제목에 _주요업무보고 를 붙인다", () => {
    const meta = { ...(fallbackMeta("report") as Record<string, unknown>), 제목: "2026년 주요업무보고" };
    const doc = { version: 1, family: "report", meta, blocks: [] } as unknown as DocModel;
    expect(DOC_FAMILIES.report.docTitle(doc)).toBe("2026년 주요업무보고");
    expect(DOC_FAMILIES.report.exportBaseName(doc)).toBe("2026년 주요업무보고_주요업무보고");
  });
});

describe("DOC_FAMILIES.headingStyle", () => {
  it("사업계획서는 장 띠, 공고문은 섹션바, 보도자료는 제목을 쓰지 않는다", () => {
    expect(DOC_FAMILIES.plan.headingStyle).toBe("chapterChip");
    expect(DOC_FAMILIES.notice.headingStyle).toBe("sectionBar");
    expect(DOC_FAMILIES.press.headingStyle).toBe("none");
  });
  it("업무보고서는 사업계획서와 같은 장 띠·절 칩을 쓴다", () => {
    // 간지 Ⅰ·Ⅱ·Ⅲ 은 본문 중간에 되풀이되므로 `#` 으로 위치를 받아야 한다.
    expect(DOC_FAMILIES.report.headingStyle).toBe("chapterChip");
    expect(familyContext("report", fallbackMeta("report")).allowHeadings).toBe(true);
  });
  it("headingStyle=none 인 family 는 제목 문법을 끄고 있어야 한다", () => {
    // press 는 expanders/press.ts 의 allowHeadings:false 로 parser.ts:509 에서 먼저 끊긴다.
    // 둘이 어긋나면 `#` 이 조용히 공고문 섹션바로 펼쳐진다. 미래 family도 지키도록 전수 검사한다.
    for (const f of FamilySchema.options) {
      const ctx = familyContext(f, fallbackMeta(f));
      if (DOC_FAMILIES[f].headingStyle === "none") expect(ctx.allowHeadings, f).toBe(false);
    }
  });
});

describe("FamilyContext.numeralStyle", () => {
  // 예전에는 parser.ts 가 this.meta 를 사업계획서 meta 로 캐스팅해 .numbering 을 읽었다.
  // 그 칸이 없는 family 는 `undefined !== "arabic"` 으로 **우연히** 로마자가 됐다.
  // 이제는 확장기가 제 meta 에서 채운다 — 값이 맞는 이유로 맞아야 한다.
  it("사업계획서는 제 meta 의 numbering 에서 정한다", () => {
    const roman = { ...(fallbackMeta("plan") as Record<string, unknown>), numbering: "roman" };
    const arabic = { ...(fallbackMeta("plan") as Record<string, unknown>), numbering: "arabic" };
    expect(familyContext("plan", roman as never).numeralStyle).toBe("roman");
    expect(familyContext("plan", arabic as never).numeralStyle).toBe("arabic");
  });
  it("업무보고서는 참고본대로 로마자다", () => {
    expect(familyContext("report", fallbackMeta("report")).numeralStyle).toBe("roman");
  });
  it("모든 family 가 값을 갖는다", () => {
    for (const f of FamilySchema.options) expect(["roman", "arabic"], f).toContain(familyContext(f, fallbackMeta(f)).numeralStyle);
  });
});

describe("DOC_FAMILIES.requiresClosingMark", () => {
  it("계획서·공고문은 끝 표기를 요구하고 보도자료는 아니다", () => {
    expect(DOC_FAMILIES.plan.requiresClosingMark).toBe(true);
    expect(DOC_FAMILIES.notice.requiresClosingMark).toBe(true);
    expect(DOC_FAMILIES.press.requiresClosingMark).toBe(false);
  });
  it("업무보고서는 끝 표기를 요구하지 않는다", () => {
    // `끝.` 은 시행규칙 제4조제5항이 공문서에 요구하는 것이고 업무보고에는 그런 규정이 없다.
    expect(DOC_FAMILIES.report.requiresClosingMark).toBe(false);
  });
});
