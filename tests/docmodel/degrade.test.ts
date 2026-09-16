import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { DocModelSchema, type Block } from "../../lib/docmodel/schema";
import { paras, plain, tables } from "./helpers";

const FM = "---\nfamily: plan\n제목: t\n---\n";

describe("graceful degradation (never throw)", () => {
  it("normalizes look-alike bullets with a warning", () => {
    const r = parseDsl(FM + "• 점\nㆍ 가운뎃점\n– 대시\nㅁ 미음\n");
    expect(paras(r.doc).map((p) => p.glyph)).toEqual(["·", "·", "-", "□"]);
    expect(r.warnings).toHaveLength(4);
    expect(r.warnings.map((w) => w.line)).toEqual([5, 6, 7, 8]);
  });
  it("keeps `**bold**`, `---` and negative numbers as text, not bullets", () => {
    const r = parseDsl(FM + "**굵게** 시작\n---\n-4% 감소\n");
    const ps = paras(r.doc);
    expect(ps.map((p) => p.glyph)).toEqual([undefined, undefined, undefined]);
    expect(ps[0].inlines[0]).toEqual({ t: "text", text: "굵게", bold: true });
    expect(plain(ps[1])).toBe("---");
    expect(plain(ps[2])).toBe("-4% 감소");
  });
  it("### headings become bold paragraphs with a warning", () => {
    const r = parseDsl(FM + "### 소제목\n");
    expect(r.warnings[0].message).toContain("###");
    expect(paras(r.doc).at(-1)).toMatchObject({ role: "plain", inlines: [{ t: "text", text: "소제목", bold: true }] });
  });
  it("invalid merges are kept as literal text with warnings", () => {
    const r = parseDsl(FM + "| ^ | a |\n|---|---|\n| < | b |\n| a | b |\n| ^ | < |\n");
    const t = tables(r.doc)[0];
    expect(plain({ k: "para", id: "", role: "plain", inlines: t.rows[0].cells[0].inlines })).toBe("^");
    expect(plain({ k: "para", id: "", role: "plain", inlines: t.rows[1].cells[0].inlines })).toBe("<");
    expect(t.rows[3].cells[0]).toEqual({ inlines: [], covered: true });
    expect(t.rows[2].cells[0]).toMatchObject({ rowSpan: 2 });
    // `<` next to a cell merged from above (anchor does not span this column) is invalid
    expect(t.rows[3].cells[1].inlines).toEqual([{ t: "text", text: "<" }]);
    expect(r.warnings.length).toBe(3);
    expect(DocModelSchema.safeParse(r.doc).success).toBe(true);
  });
  it("a 2×2 merge and a covered-region overlap", () => {
    const r = parseDsl(FM + "| A | < | C |\n|---|---|---|\n| ^ | ^ | d |\n| ^ | 겹침 | e |\n");
    const t = tables(r.doc)[0];
    expect(t.rows[0].cells[0]).toEqual({ inlines: [{ t: "text", text: "A" }], colSpan: 2, rowSpan: 3 });
    expect(t.rows[1].cells[1].covered).toBe(true);
    expect(t.rows[2].cells[1].covered).toBe(true);
    expect(r.warnings.some((w) => w.message.includes("겹치는"))).toBe(true);
  });
  it("rows shorter than the header are padded; longer rows warn", () => {
    const r = parseDsl(FM + "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n");
    const t = tables(r.doc)[0];
    expect(t.rows[1].cells).toHaveLength(3);
    expect(t.rows[2].cells).toHaveLength(4);
    expect(r.warnings.some((w) => w.message.includes("열 수"))).toBe(true);
  });
  it("orphan {table} attribute lines and unknown attributes warn", () => {
    const r = parseDsl(FM + "{table role=nope colour=red}\n본문\n");
    expect(r.warnings.map((w) => w.message)).toEqual([expect.stringContaining("role"), expect.stringContaining("colour"), expect.stringContaining("속성")]);
    expect(paras(r.doc).at(-1)?.inlines).toEqual([{ t: "text", text: "본문" }]);
  });
  it("unknown fence names are ignored and their content parsed normally", () => {
    const r = parseDsl(FM + "```markdown\nㅇ 안\n```\nㅇ 밖\n");
    expect(r.warnings).toHaveLength(1);
    expect(paras(r.doc).map((p) => plain(p))).toEqual(["안", "밖"]);
  });
  it("an unclosed ```image is closed automatically", () => {
    const r = parseDsl(FM + "```image logo\nㅇ 다음 줄\n");
    expect(r.doc.blocks.map((b) => b.k)).toEqual(["approvalBlock", "coverTitle", "image", "para"]);
    expect(r.warnings).toHaveLength(1);
  });
  it("unterminated fences and tables at EOF are closed", () => {
    const r = parseDsl(FM + "| a |\n|---|\n| 1 |");
    expect(tables(r.doc)[0].rows).toHaveLength(2);
    const f = parseDsl(FM + "```box\n❖ 내용");
    expect((f.doc.blocks.at(-1) as Extract<Block, { k: "summaryBox" }>).lines).toHaveLength(1);
    const c = parseDsl(FM + "이어짐 \\");
    expect(paras(c.doc).at(-1)?.inlines).toEqual([{ t: "text", text: "이어짐" }]);
  });
  it("continuation lines join with br and swallow following glyphs as text", () => {
    const r = parseDsl(FM + "□ 첫 줄 \\\n둘째 줄 \\\nㅇ 셋째 줄\nㅇ 새 문단\n");
    const ps = paras(r.doc);
    expect(ps).toHaveLength(2);
    expect(ps[0].inlines).toEqual([{ t: "text", text: "첫 줄" }, { t: "br" }, { t: "text", text: "둘째 줄" }, { t: "br" }, { t: "text", text: "ㅇ 셋째 줄" }]);
  });
  it("blank lines collapse, including at the very end", () => {
    const r = parseDsl(FM + "\n\n\nㅇ 가\n\n\n\nㅇ 나\n\n\n");
    expect(r.doc.blocks.map((b) => b.k)).toEqual(["approvalBlock", "coverTitle", "blank", "para", "blank", "para", "blank"]);
  });
});
