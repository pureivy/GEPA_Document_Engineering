import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { DocModelSchema } from "../../lib/docmodel/schema";
import { fixture, kinds, paras, plain } from "./helpers";

const { doc, warnings } = parseDsl(fixture("press"));
const PRESS_FM = "---\nfamily: press\n배포일: x\n담당부서: x\n담당자: x\n연락처: x\n제목: 제목입니다\n---\n";

describe("press example (B.5)", () => {
  it("parses without warnings and validates", () => {
    expect(warnings).toEqual([]);
    expect(DocModelSchema.safeParse(doc).success).toBe(true);
  });

  it("prepends pressHeader, pressTitle and pressSubtitle from meta", () => {
    expect(kinds(doc).slice(0, 3)).toEqual(["pressHeader", "para", "para"]);
    expect(doc.blocks[1]).toMatchObject({ role: "pressTitle", inlines: [{ t: "text", text: "경북경제진흥원, 안동시 수출기업 역량강화 지원사업 참여기업 모집" }] });
    expect(doc.blocks[2]).toMatchObject({ role: "pressSubtitle", inlines: [{ t: "text", text: "7월 15일까지 접수… 기업당 최대 300만원 수출매뉴얼 지원" }] });
    const noSub = parseDsl(PRESS_FM + "본문\n").doc;
    expect(kinds(noSub)).toEqual(["pressHeader", "para", "para"]);
    expect(paras(noSub).map((p) => p.role)).toEqual(["pressTitle", "pressBody"]);
  });

  it("makes glyph-less lines pressBody and keeps glyph lines on the body ladder", () => {
    const ps = paras(doc).slice(2);
    expect(ps.map((p) => p.role)).toEqual(["pressBody", "pressBody", "body1", "body2", "pressBody"]);
    expect(plain(ps[0])).toBe("(재)경상북도경제진흥원(원장 ○○○)은 안동시와 함께 …를 7월 1일부터 15일까지 모집한다고 밝혔다.");
    // `○○○ 원장은` starts with a repeated glyph character → text, not a bullet
    expect(ps[4].glyph).toBeUndefined();
    expect(plain(ps[4])).toBe('○○○ 원장은 "…"라고 말했다.');
  });

  it("degrades # headings to bold paragraphs with a warning", () => {
    const r = parseDsl(PRESS_FM + "# 지원내용\n본문\n");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].line).toBe(9);
    expect(paras(r.doc).at(-2)).toMatchObject({ role: "pressBody", inlines: [{ t: "text", text: "지원내용", bold: true }] });
  });
});
