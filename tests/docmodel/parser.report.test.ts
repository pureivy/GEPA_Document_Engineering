import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { toDsl } from "../../lib/docmodel/serialize/toDsl";
import { DocModelSchema, type Block } from "../../lib/docmodel/schema";

const REPORT_FM = "---\nfamily: report\n제목: 2026년 주요업무보고\n---\n";

const bands = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { k: "chapterBand" }> => b.k === "chapterBand");
const chips = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { k: "sectionChip" }> => b.k === "sectionChip");

describe("업무보고서 제목 문법", () => {
  const { doc, warnings } = parseDsl(REPORT_FM + "# 일반현황\n## 설립목적\nㅇ 경북 중소기업 지원\n# 2026년 추진방향\n## 비전\n");

  it("경고 없이 파싱되고 스키마를 통과한다", () => {
    expect(warnings).toEqual([]);
    expect(DocModelSchema.safeParse(doc).success).toBe(true);
  });

  it("`#` 은 간지(chapterBand)가 되고 번호는 로마자다", () => {
    // headingStyle 이 "none" 이면 parser.ts:510 이 먼저 끊어 굵은 문단으로 떨어진다.
    expect(bands(doc.blocks).map((b) => [b.numeral, b.title])).toEqual([
      ["Ⅰ", "일반현황"],
      ["Ⅱ", "2026년 추진방향"],
    ]);
  });

  it("`##` 은 소제목 칩이 되고 간지마다 번호가 1 로 돌아간다", () => {
    expect(chips(doc.blocks).map((c) => [c.label, c.title])).toEqual([
      ["1", "설립목적"],
      ["1", "비전"],
    ]);
  });

  it("직렬화가 파서와 같은 로마자를 쓴다(왕복)", () => {
    // toDsl 이 family 를 직접 보고 판단하면 업무보고만 `# 1.` 로 나가 파서의 Ⅰ 과 어긋난다.
    const body = toDsl(doc).split("---\n")[2];
    expect(body).toContain("# Ⅰ. 일반현황");
    expect(body).toContain("# Ⅱ. 2026년 추진방향");
    expect(bands(parseDsl(toDsl(doc)).doc.blocks).map((b) => b.numeral)).toEqual(["Ⅰ", "Ⅱ"]);
  });
});
