import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { DocModelSchema, type Block } from "../../lib/docmodel/schema";
import { PLAN_정산문구 } from "../../lib/docmodel/boilerplate";
import { fixture, kinds, paras, plain, tables } from "./helpers";

const { doc, warnings } = parseDsl(fixture("plan"));
const PLAN_FM = "---\nfamily: plan\n제목: t\n---\n";

describe("plan example (B.4)", () => {
  it("parses without warnings and validates", () => {
    expect(warnings).toEqual([]);
    expect(DocModelSchema.safeParse(doc).success).toBe(true);
  });

  it("prepends approvalBlock, coverTitle and the 요약 chips", () => {
    expect(kinds(doc).slice(0, 8)).toEqual(["approvalBlock", "coverTitle", "sectionChip", "para", "sectionChip", "para", "sectionChip", "para"]);
    expect(doc.blocks[1]).toMatchObject({ k: "coverTitle", inlines: [{ t: "text", text: "2026년 안동시 수출기업 역량강화 지원사업 사업계획(안)" }] });
    const chips = doc.blocks.filter((b): b is Extract<Block, { k: "sectionChip" }> => b.k === "sectionChip");
    expect(chips.slice(0, 3).map((c) => [c.label, c.title])).toEqual([
      ["", "사업개요"],
      ["", "추진일정"],
      ["", "기대효과"],
    ]);
    expect(doc.blocks[3]).toMatchObject({ k: "para", role: "coverSummary", inlines: [{ t: "text", text: "안동시 소재 수출 중소기업 20개사에 수출매뉴얼·수출직불금 지원" }] });
  });

  it("auto-numbers chapter bands Ⅰ…Ⅵ", () => {
    const bands = doc.blocks.filter((b): b is Extract<Block, { k: "chapterBand" }> => b.k === "chapterBand");
    expect(bands.map((b) => [b.numeral, b.title])).toEqual([
      ["Ⅰ", "추진배경 및 목적"],
      ["Ⅱ", "사업개요 및 추진절차"],
      ["Ⅲ", "세부 추진계획"],
      ["Ⅳ", "추진일정"],
      ["Ⅴ", "소요예산"],
      ["Ⅵ", "기대효과"],
    ]);
  });

  it("honours explicit numerals and arabic numbering", () => {
    const d = parseDsl(PLAN_FM + "# Ⅲ 세부\n# 다음\n# 7. 일곱\n# 다음2\n").doc;
    const bands = d.blocks.filter((b): b is Extract<Block, { k: "chapterBand" }> => b.k === "chapterBand");
    expect(bands.map((b) => b.numeral)).toEqual(["Ⅲ", "Ⅳ", "Ⅶ", "Ⅷ"]);
    const a = parseDsl("---\nfamily: plan\n제목: t\nnumbering: arabic\n---\n# 하나\n# 둘\n").doc;
    expect(a.blocks.filter((b) => b.k === "chapterBand").map((b) => (b as Extract<Block, { k: "chapterBand" }>).numeral)).toEqual(["1", "2"]);
  });

  it("parses ```box into summaryBox with the ❖ glyph", () => {
    const box = doc.blocks.find((b) => b.k === "summaryBox") as Extract<Block, { k: "summaryBox" }>;
    expect(box.glyph).toBe("❖");
    expect(box.lines).toEqual([[{ t: "text", text: "안동시 수출기업의 해외 판로개척 역량을 강화하여 지역경제 활성화에 기여" }]]);
    const noGlyph = parseDsl(PLAN_FM + "```box\n첫 줄\n둘째 **줄**\n```\n").doc.blocks.find((b) => b.k === "summaryBox") as Extract<Block, { k: "summaryBox" }>;
    expect(noGlyph.glyph).toBeUndefined();
    expect(noGlyph.lines).toHaveLength(2);
    expect(noGlyph.lines[1]).toEqual([{ t: "text", text: "둘째 " }, { t: "text", text: "줄", bold: true }]);
  });

  it("parses ```flow into procedureFlow", () => {
    const flow = doc.blocks.find((b) => b.k === "procedureFlow") as Extract<Block, { k: "procedureFlow" }>;
    expect(flow.stages).toEqual([
      { name: "모집공고", when: "7월" },
      { name: "신청·접수", when: "7월" },
      { name: "서류평가", when: "8월" },
      { name: "지원·정산", when: "9~12월" },
    ]);
  });

  it("parses `## 󰊱 제목` as a sectionChip with the given label and auto-labels otherwise", () => {
    const chip = doc.blocks.find((b) => b.k === "sectionChip" && b.title === "수출매뉴얼 지원") as Extract<Block, { k: "sectionChip" }>;
    expect(chip.label).toBe("󰊱");
    const d = parseDsl(PLAN_FM + "# 장\n## 첫째\n## 둘째\n## [사업개요] 셋째\n## 5. 다섯째\n## 여섯째\n# 장2\n## 다시 첫째\n").doc;
    const chips = d.blocks.filter((b): b is Extract<Block, { k: "sectionChip" }> => b.k === "sectionChip");
    expect(chips.map((c) => [c.label, c.title])).toEqual([
      ["1", "첫째"],
      ["2", "둘째"],
      ["사업개요", "셋째"],
      ["5", "다섯째"],
      ["6", "여섯째"],
      ["1", "다시 첫째"],
    ]);
  });

  it("parses (단위: 천원) as a right-aligned unitCaption before the budget table", () => {
    const cap = paras(doc).find((p) => p.role === "unitCaption")!;
    expect(cap).toMatchObject({ align: "right", inlines: [{ t: "text", text: "(단위: 천원)" }] });
    const idx = doc.blocks.indexOf(cap);
    expect(doc.blocks[idx + 1]).toMatchObject({ k: "table", role: "budget" });
    const alt = parseDsl(PLAN_FM + "(단위 : 백만원)\n").doc;
    expect(paras(alt).at(-1)?.role).toBe("unitCaption");
  });

  it("parses the budget table: header colSpan via <, body rowSpan via ^, total row via 합계", () => {
    const budget = tables(doc).find((t) => t.role === "budget")!;
    expect(budget.widthsPt).toEqual([50.1, 86.9, 218.7, 61.2, 61.2]);
    expect(budget.rows[0].cells[0]).toEqual({ inlines: [{ t: "text", text: "구 분" }], colSpan: 2 });
    expect(budget.rows[0].cells[1]).toEqual({ inlines: [], covered: true });
    expect(budget.rows[1].cells[0]).toMatchObject({ rowSpan: 2 });
    expect(budget.rows[2].cells[0]).toEqual({ inlines: [], covered: true });
    expect(budget.rows[3].isTotal).toBe(true);
    expect(budget.rows[3].cells[0]).toEqual({ inlines: [{ t: "text", text: "합계" }], colSpan: 3 });
    expect(budget.rows[3].cells[1].covered).toBe(true);
    expect(budget.rows[3].cells[2].covered).toBe(true);
    expect(budget.rows[3].cells[3].inlines).toEqual([{ t: "text", text: "60,000" }]);
  });

  it("expands 정산문구 and keeps the literal `.  끝.`", () => {
    const texts = paras(doc).map((p) => plain(p));
    expect(texts).toContain(PLAN_정산문구);
    expect(texts.at(-1)).toBe("지역 제조업 수출액 증대를 통한 지역경제 활성화.  끝.");
  });

  it("{{boilerplate:끝}} appends `.  끝.` to the previous paragraph, or emits `끝.` alone", () => {
    const a = parseDsl(PLAN_FM + "ㅇ 마지막 문장\n{{boilerplate:끝}}\n").doc;
    expect(plain(paras(a).at(-1)!)).toBe("마지막 문장.  끝.");
    const b = parseDsl(PLAN_FM + "ㅇ 마침표로 끝남.\n\n{{boilerplate:끝}}\n").doc;
    expect(plain(paras(b).at(-1)!)).toBe("마침표로 끝남.  끝.");
    const c = parseDsl(PLAN_FM + "ㅇ 이미 끝.  끝.\n{{boilerplate:끝}}\n").doc;
    expect(paras(c).filter((p) => plain(p).includes("끝."))).toHaveLength(1);
    const d = parseDsl(PLAN_FM + "{{boilerplate:끝}}\n").doc;
    expect(paras(d).at(-1)).toMatchObject({ role: "plain", inlines: [{ t: "text", text: "끝." }] });
  });

  it("parses ```toc, ```attach and ```image fences", () => {
    const d = parseDsl(PLAN_FM + "```toc\nⅠ. 추진배경 1\nⅡ. 사업개요 3\n```\n```attach\n붙임 1. 신청서\n동의서\n끝.\n```\n```image logo\n```\n```image chart1 width=120mm height=60mm align=center\n```\n").doc;
    const toc = paras(d).filter((p) => p.role === "tocLine");
    expect(toc.map((p) => plain(p))).toEqual(["Ⅰ. 추진배경 1", "Ⅱ. 사업개요 3"]);
    const attach = d.blocks.find((b) => b.k === "attachmentList") as Extract<Block, { k: "attachmentList" }>;
    expect(attach.items).toEqual(["붙임 1. 신청서", "동의서"]);
    const imgs = d.blocks.filter((b): b is Extract<Block, { k: "image" }> => b.k === "image");
    expect(imgs[0]).toMatchObject({ asset: "logo", widthMm: 92.3, heightMm: 13.3 });
    expect(imgs[1]).toMatchObject({ asset: "chart1", widthMm: 120, heightMm: 60, align: "center" });
  });
});
