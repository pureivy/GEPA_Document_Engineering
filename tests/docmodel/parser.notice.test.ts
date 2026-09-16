import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { DocModelSchema, type Block } from "../../lib/docmodel/schema";
import { NOTICE_기타유의사항, NOTICE_참여제한대상, NOTICE_지급방법 } from "../../lib/docmodel/boilerplate";
import { fixture, kinds, paras, plain, tables } from "./helpers";

const { doc, warnings } = parseDsl(fixture("notice"));

describe("notice example (B.3)", () => {
  it("parses without warnings and validates against DocModelSchema", () => {
    expect(warnings).toEqual([]);
    expect(DocModelSchema.safeParse(doc).success).toBe(true);
    expect(doc.family).toBe("notice");
  });

  it("assigns sequential ids in document order", () => {
    expect(doc.blocks.map((b) => b.id)).toEqual(doc.blocks.map((_, i) => "b" + String(i + 1).padStart(3, "0")));
  });

  it("prepends the synthesized skeleton in the rule-13 order", () => {
    expect(kinds(doc).slice(0, 9)).toEqual(["noticeHeader", "infoBox", "image", "pageBreak", "sectionBar", "overviewTable", "sectionBar", "procedureFlow", "para"]);
    const bars = doc.blocks.filter((b): b is Extract<Block, { k: "sectionBar" }> => b.k === "sectionBar");
    expect(bars.map((b) => [b.number, b.title])).toEqual([
      [1, "모집개요"],
      [2, "지원절차"],
      [3, "사업목적"],
      [4, "사업기간"],
      [5, "신청자격"],
      [6, "신청방법"],
      [7, "선정절차"],
      [8, "지원내용"],
      [9, "기타 유의사항"],
    ]);
    const note = doc.blocks[8] as Extract<Block, { k: "para" }>;
    expect(note.role).toBe("note");
    expect(note.glyph).toBe("※");
    expect(plain(note)).toBe("상기 일정은 추진 상황에 따라 변경될 수 있음");
    const img = doc.blocks[2] as Extract<Block, { k: "image" }>;
    expect(img).toMatchObject({ asset: "logo", widthMm: 92.3, heightMm: 13.3, align: "center", position: "pageBottom" });
  });

  it("builds the 안내박스 from meta.접수 with the §8 wording", () => {
    const box = doc.blocks[1] as Extract<Block, { k: "infoBox" }>;
    expect(box.groups.map((g) => g.heading)).toEqual(["접수방법", "문의", "선정결과 통보"]);
    expect(box.groups[0].items[0]).toEqual([{ t: "text", text: "이메일 접수: gepa_north@naver.com" }]);
    expect(box.groups[0].items[1]).toEqual([{ t: "text", text: "우편(등기): 경상북도 안동시 북순환로 387, 2층 경상북도경제진흥원" }]);
    expect(box.groups[1].items[0]).toEqual([{ t: "text", text: "사업 및 신청서 작성 문의: " }, { t: "br" }, { t: "text", text: "북부지소 ☎ 054-900-3801 (E-mail) gepa_north@naver.com" }]);
    expect(box.groups[1].items).toHaveLength(1); // 이의제기 문구는 안내박스에서 제외(2026-09-16)
    expect(box.groups[2].items[0]).toEqual([{ t: "text", text: "기업별 개별통보(필요시 접수 홈페이지 공고)" }]);
  });

  it("builds 모집개요표 and 절차도 from meta", () => {
    const ov = doc.blocks[5] as Extract<Block, { k: "overviewTable" }>;
    expect(ov.rows).toHaveLength(11);
    expect(ov.rows[0]).toEqual({ label: "사업명", value: [{ t: "text", text: "2026년 안동시 수출기업 역량강화 지원사업(수출매뉴얼 지원)" }] });
    expect(ov.rows[5]).toMatchObject({ label: "대상자별지원금액", bullet: false });
    expect(ov.rows[8]).toBe("spacer");
    const flow = doc.blocks[7] as Extract<Block, { k: "procedureFlow" }>;
    expect(flow.stages).toEqual([
      { name: "모집공고", when: "’26. 07. 01." },
      { name: "신청·접수", when: "’26. 07. 01. ~ 07. 15." },
      { name: "평가(서면)", when: "8월 중순" },
    ]);
  });

  it("maps glyphs to roles and ignores leading spaces", () => {
    const ps = paras(doc);
    const byText = (t: string) => ps.find((p) => plain(p).startsWith(t))!;
    expect(byText("안동시 수출 중소기업")).toMatchObject({ role: "body1", glyph: "□" });
    expect(byText("「중소기업기본법」")).toMatchObject({ role: "body2", glyph: "ㅇ" });
    expect(byText("한국표준산업분류 대분류(C)")).toMatchObject({ role: "note", glyph: "※" });
    expect(byText("가족친화인증기업")).toMatchObject({ role: "body3", glyph: "-" });
    expect(byText("건축물관리대장")).toMatchObject({ role: "footnote", glyph: "*" });
    expect(byText("휴업 중인 기업")).toMatchObject({ role: "body2", glyph: "◦" });
    const indented = parseDsl("---\nfamily: press\n배포일: x\n담당부서: x\n담당자: x\n연락처: x\n제목: t\n---\n    ㅇ 들여쓴 줄\n").doc;
    expect(paras(indented).at(-1)).toMatchObject({ role: "body2", glyph: "ㅇ", inlines: [{ t: "text", text: "들여쓴 줄" }] });
  });

  it("parses bold labels and colour marks", () => {
    const p = paras(doc).find((p) => plain(p).startsWith("(사업기간)"))!;
    expect(p.inlines).toEqual([
      { t: "text", text: "(사업기간)", bold: true },
      { t: "text", text: " 선정일로부터 ~ 10. 31.까지" },
    ]);
    const red = paras(doc).find((p) => plain(p).startsWith("동점시"))!;
    expect(red.inlines).toEqual([
      { t: "text", text: "동점시 " },
      { t: "text", text: "수출실적, 매출성장률", color: "#ff0000" },
      { t: "text", text: " 순으로 참여기업 우선 선정" },
    ]);
  });

  it("expands macros verbatim (참여제한대상, 예산상황, 기업부담금, 지급방법 with 기업게좌, 기타유의사항 with link)", () => {
    const texts = paras(doc).map((p) => (p.glyph ? p.glyph + " " : "") + plain(p));
    // 참여제한대상: heading + 7 ◦ items, in order
    const start = texts.indexOf("□ (참여제한대상)");
    expect(start).toBeGreaterThan(0);
    expect(texts.slice(start + 1, start + 8)).toEqual(NOTICE_참여제한대상.slice(1));
    expect(texts).toContain("※ 예산상황에 따라 선정기업은 변동될 수 있음");
    expect(texts).toContain("※ 최대 지원한도에 따라 기업부담금 증가할 수 있음");
    // 지급방법 keeps the 기업게좌 typo
    expect(texts).toContain("□ 지원금 지급 방법");
    expect(texts).toContain(NOTICE_지급방법[1]);
    expect(texts.some((t) => t.includes("기업게좌"))).toBe(true);
    expect(texts.some((t) => t.includes("기업계좌"))).toBe(false);
    // 기타유의사항: 6 ㅇ lines with 주관기관 substituted and www.gepa.kr as a link
    const sec9 = doc.blocks.findIndex((b) => b.k === "sectionBar" && b.number === 9);
    const items = doc.blocks.slice(sec9 + 1, sec9 + 7) as Extract<Block, { k: "para" }>[];
    expect(items.every((p) => p.k === "para" && p.glyph === "ㅇ" && p.role === "body2")).toBe(true);
    expect(plain(items[4])).toContain("안동시 또는 경상북도경제진흥원의 해석에 따름");
    expect(plain(items[4])).toBe(NOTICE_기타유의사항[4].replace("ㅇ ", "").replace("{{주관기관}}", "안동시"));
    const link = items[5].inlines.find((i) => i.t === "link");
    expect(link).toEqual({ t: "link", text: "www.gepa.kr", href: "http://www.gepa.kr" });
    expect(plain(items[5])).toBe("본 공고문은 사정에 의하여 변경될 수 있으며, 변경된 사항은 (재)경상북도경제진흥원 홈페이지(www.gepa.kr)에 공고 예정");
  });

  it("parses tables with attributes, rowSpan (^), colSpan (<), <br>, header and total rows", () => {
    const [docs, support, evalT] = tables(doc);
    expect(docs).toMatchObject({ role: "docs", widthsPt: [30, 213.7, 55.3, 185.7], headerRows: 1 });
    expect(docs.rows[0].isHeader).toBe(true);
    expect(docs.rows[0].cells.map((c) => plain({ k: "para", id: "", role: "plain", inlines: c.inlines }))).toEqual(["No", "제 출 서 류", "제출부수", "비 고 사 항"]);
    expect(docs.rows[1].cells[3]).toEqual({ inlines: [{ t: "text", text: "[서식집] 양식 사용" }], rowSpan: 2 });
    expect(docs.rows[2].cells[3]).toEqual({ inlines: [], covered: true });
    expect(docs.rows[3].cells[3]).toEqual({ inlines: [{ t: "text", text: "발급 3개월 이내" }] });

    expect(support).toMatchObject({ role: "support", style: { padding: "tight", fontPt: 10 } });
    expect(support.rows[1].cells[0]).toMatchObject({ rowSpan: 2 });
    expect(support.rows[1].cells[2].inlines).toEqual([
      { t: "text", text: "3백만원 한도" },
      { t: "br" },
      { t: "text", text: "공급가액의" },
      { t: "br" },
      { t: "text", text: "최대 80%" },
      { t: "br" },
      { t: "text", text: "(VAT 제외)" },
    ]);
    expect(support.rows[1].cells[2].rowSpan).toBe(2);
    expect(support.rows[2].cells[0].covered).toBe(true);
    expect(support.rows[2].cells[2].covered).toBe(true);
    expect(support.rows[2].cells[1].inlines).toEqual([{ t: "text", text: "홍보영상" }]);

    expect(evalT.role).toBe("evalCriteria");
    const total = evalT.rows[2];
    expect(total.isTotal).toBe(true);
    expect(total.cells[0]).toEqual({ inlines: [{ t: "text", text: "합 계" }], colSpan: 2 });
    expect(total.cells[1]).toEqual({ inlines: [], covered: true });
    expect(total.cells[2].inlines).toEqual([{ t: "text", text: "100" }]);
  });

  it("handles <pagebreak>, [별첨] headings and collapses blank lines", () => {
    const i = doc.blocks.findIndex((b, idx) => b.k === "pageBreak" && idx > 4); // skip the cover page break (index 3)
    expect(i).toBeGreaterThan(0);
    expect(doc.blocks[i + 1]).toMatchObject({ k: "para", role: "attachmentHeading", inlines: [{ t: "text", text: "[별첨1]정량평가 기준" }] });
    for (let j = 1; j < doc.blocks.length; j++) expect(doc.blocks[j].k === "blank" && doc.blocks[j - 1].k === "blank").toBe(false);
  });

  it("treats `##` in a notice as a bold body1 line", () => {
    const d = parseDsl("---\nfamily: notice\n공고번호: 1\n사업명: x\n주관기관: y\n지역: z\n공고연월: w\n접수: { 이메일: a, 우편주소: b, 부서명: c, 전화: d }\n모집개요: []\n절차도: []\n---\n## 신청·접수\n").doc;
    expect(paras(d).at(-1)).toMatchObject({ role: "body1", glyph: "□", inlines: [{ t: "text", text: "신청·접수", bold: true }] });
  });
});
