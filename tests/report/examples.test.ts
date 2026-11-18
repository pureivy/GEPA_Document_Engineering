import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardFromText, cleanName, exampleCopyWarnings, indexExamples } from "../../lib/report/examples";
import { fixableWarnings } from "../../lib/stages/runIntegration";

/** 업무보고 본보기 모음(담당자 2026-11-18) — 고정 양식 목록 대신 실제 보고서를 골라 따른다 */
const SAMPLE = `주 요 업 무 보 고

보 고 순 서
Ⅰ. 일반현황 1
Ⅱ. 2025년도 추진성과 5
  1. 성장 단계별 지원으로 글로벌 강소기업 육성 7

Ⅰ. 일반현황
1. 설립목적
□ 중소기업의 경쟁력 강화와 지역경제 활성화를 위해 설립된 출자출연기관
`;

describe("본보기 카드", () => {
  it("제목·장절 줄을 뽑고, 목차와 본문에 겹친 줄은 한 번만 싣는다", () => {
    const c = cardFromText("a.txt", "a.hwpx", SAMPLE, 3);
    expect(c.title).toBe("주 요 업 무 보 고");
    expect(c.outline.filter((l) => l.startsWith("Ⅰ."))).toHaveLength(1);
    expect(c.outline).toContain("1. 설립목적");
    expect(c.tables).toBe(3);
    expect(c.pagesApprox).toBeGreaterThanOrEqual(1);
  });

  it("원본/ 의 글 파일을 색인해 catalog.md 를 쓴다(docx·hwpx 등 — 여기선 글이 든 docx 대신 md 는 받지 않는다)", () => {
    const dir = mkdtempSync(join(tmpdir(), "gepa-ex-"));
    mkdirSync(join(dir, "원본"), { recursive: true });
    writeFileSync(join(dir, "원본", "메모.md"), SAMPLE); // 본보기 확장자가 아니라 건너뛴다
    const r = indexExamples(dir);
    expect(r.cards).toHaveLength(0);
    expect(existsSync(join(dir, "catalog.md"))).toBe(true);
    expect(readFileSync(join(dir, "catalog.md"), "utf8")).toContain("본보기 카드 (0건)");
  });

  it("이름에서 날짜·★(최종)·내려받기 사본 꼬리 (1) 를 뗀다", () => {
    expect(cleanName("2026.08.04_경영평가 대응 계획.hwpx")).toBe("경영평가 대응 계획");
    expect(cleanName("★(최종)2026년 행정사무감사 책자자료 통합본.hwpx")).toBe("2026년 행정사무감사 책자자료 통합본");
    expect(cleanName("언론브리핑(한장)_변경 (1).hwpx")).toBe("언론브리핑(한장)_변경");
  });
});

describe("본보기 문장 옮겨 쓰기", () => {
  const ex = ["□ 중소기업의 경쟁력 강화와 지역경제 활성화를 위해 설립된 출자출연기관"];
  it("본보기와 같은 문장이면 [본보기 문장] 경고, 자동 다듬기 대상이다", () => {
    const dsl = "---\nfamily: report\n---\n## 설립목적\n● 중소기업의 경쟁력 강화와 지역경제 활성화를 위해 설립된 출자출연기관\n";
    const w = exampleCopyWarnings(dsl, ex);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^\[본보기 문장\] 5행/);
    expect(fixableWarnings(w)).toEqual(w);
  });
  it("짧은 줄·표 줄·front-matter 는 보지 않는다", () => {
    const dsl = "---\n제목: 중소기업의 경쟁력 강화와 지역경제 활성화를 위해 설립된 출자출연기관\n---\n## 설립목적\n| 중소기업의 경쟁력 강화와 지역경제 활성화를 위해 설립된 출자출연기관 |\n● 설립목적\n";
    expect(exampleCopyWarnings(dsl, ex)).toEqual([]);
  });
});
