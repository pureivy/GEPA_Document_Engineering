import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { toDsl } from "../../lib/docmodel/serialize/toDsl";
import { DocModelSchema, type Block, type DocModel } from "../../lib/docmodel/schema";
import { fixture } from "./helpers";

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

/**
 * 간지 번호를 로마자로 쓰는 family 는 `headingStyle: "chapterChip"` 인 것뿐이다.
 *
 * `numeralStyle` 값 자체는 공고문·보도자료·공문서도 "roman" 을 들고 있다(확장기가 모두
 * 그렇게 채운다) — 그 셋의 파서는 `numeralStyle` 에 닿지 않으니 값이 무엇이든 상관없기
 * 때문이다. 그래서 toDsl 이 `numeralStyle` 만 보면, 그 셋의 DocModel 에 chapterBand 가
 * 들어 있을 때(파서는 만들지 않지만 저장된 doc.json·편집기 왕복은 만들 수 있다)
 * `# 1.` 이던 줄이 조용히 `# Ⅰ.` 로 바뀐다. 두 갈래를 여기 나란히 못 박는다.
 */
describe("chapterBand 직렬화 — 로마자는 chapterChip family 만", () => {
  const FRONT_MATTER: Record<string, string> = {
    report: REPORT_FM,
    notice: fixture("notice"),
    press: "---\nfamily: press\n배포일: x\n담당부서: x\n담당자: x\n연락처: x\n제목: 제목입니다\n---\n",
    official: "---\nfamily: official\n제목: 공문 제목\n처리과: 전략기획팀\n수신유형: 내부결재\n---\n",
  };
  // 파서가 만들지 않는 조합이므로 블록을 손으로 붙인다
  const probe = (family: string): string => {
    const { doc: base } = parseDsl(FRONT_MATTER[family]);
    const band = { id: "probe", k: "chapterBand", numeral: "1", title: "탐침" } as Extract<Block, { k: "chapterBand" }>;
    const line = toDsl({ ...base, blocks: [...base.blocks, band] } as DocModel).split("\n").find((l) => l.includes("탐침"));
    return line ?? "";
  };

  it("업무보고(chapterChip)는 로마자다", () => {
    expect(probe("report")).toBe("# Ⅰ. 탐침");
  });

  it.each(["notice", "press", "official"])("%s 는 아라비아 숫자 그대로다", (family) => {
    expect(probe(family)).toBe("# 1. 탐침");
  });
});
