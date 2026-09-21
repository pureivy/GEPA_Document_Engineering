import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";
import { parseDsl } from "../../lib/docmodel/dsl";

const NOW = new Date("2026-09-21T00:00:00Z");

/** 단계 9(한글에서 직접 열기)가 쓰는 것과 같은 DSL — 한 곳에서만 고친다. */
const DSL = readFileSync(join(process.cwd(), "tests/fixtures/official-sample.dsl.md"), "utf8");

describe("buildHwpx — official", () => {
  const { doc, warnings } = parseDsl(DSL);
  const errors = warnings.filter((w) => w.severity === "error");
  it("DSL 이 오류 없이 파싱된다", () => {
    expect(errors).toEqual([]);
    expect(doc.family).toBe("official");
  });

  const { bytes } = buildHwpx(doc, { now: NOW });

  it("@rhwp/core 검증을 contentLoss 0 으로 통과한다", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.contentLoss?.count).toBe(0);
  }, 60_000);

  it("두문·본문·결문의 값이 문서에 들어간다", async () => {
    const text = await extractText(bytes);
    expect(text).toContain("(재)경상북도경제진흥원");
    expect(text).toContain("수신자 참조");
    expect(text).toContain("경영평가 대응을 위한 2026년 사업 추진 현황 제출 요청");
    expect(text).toContain("1. 작성대상: 2026년 각 팀에서 운영하고 있는 전체 사업");
    expect(text).toContain("경영기획실장");
    expect(text).toContain("054-470-8527");
    expect(text).toContain("공개");
  }, 60_000);

  it("시행 칸은 처리과 뒤 하이픈까지만 찍고 일련번호를 만들지 않는다", async () => {
    const text = await extractText(bytes);
    expect(text).toContain("전략기획팀-");
    expect(text).not.toMatch(/전략기획팀-\d/);
  }, 60_000);

  it("붙임과 끝 표시가 들어간다", async () => {
    const text = await extractText(bytes);
    expect(text).toContain("붙임  (양식) 2026년 사업 추진 현황_팀명 1부.  끝.");
  }, 60_000);

  /**
   * 참고 문서의 값이 새 문서에 새지 않는지 본다. t00 조각은 두문 표 **뒤에** 참고 문서의 도입
   * 문장(과 CLICK_HERE 누름틀)을 같은 문단 안에 달고 있고, t01 조각의 칸에는 참고 문서의
   * 시행번호·전송번호·결재 직위가 남아 있다. 위 다섯 검사는 전부 `toContain` 이라 값이 새도
   * 통과한다 — 도입 문장은 시료 DSL 본문과 글자까지 같기 때문이다.
   */
  it("참고 문서의 값이 남지 않는다", async () => {
    const text = await extractText(bytes);
    expect(text.split("경영평가 상시대응체계").length - 1).toBe(1);
    expect(text).not.toContain("485"); // 시행 일련번호
    expect(text).not.toContain("054-472-2989"); // 전송번호 (시료에 없다)
    expect(text).not.toContain("★과장"); // 결재란 직위
    expect(text).not.toContain("ESG·기업지원팀장"); // 수신자 목록
  }, 60_000);
});
