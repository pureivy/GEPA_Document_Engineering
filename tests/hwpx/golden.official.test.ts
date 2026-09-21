import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";

const dir = join(process.cwd(), "templates", "official");
const norm = (s: string) => s.replace(/\s+/g, "").trim();

/**
 * 공문서 골든은 press 와 달리 **줄 순서로 비교하지 않는다** — `rhwp export-text` 가
 * 표 밖 문단(본문)을 먼저 쓰고 표 안 내용(두문·결문)을 뒤에 붙이는데, 문서에서 두문은
 * 맨 앞이다(templates/official/reference.text.txt 참조). 그래서 여기서는 참고 문서의
 * 각 값이 **들어 있는지**만 본다(순서 무관), `norm` 으로 공백을 지운 뒤 비교한다.
 *
 * 참고 문서와 일부러 다르게 만드는 값(시행 일련번호·시행일·★ 전결 표식·기본 홈페이지)은
 * task-6-report.md 에 근거와 함께 남기고, 여기서는 그 값을 기대하지 않는다.
 */
const dsl = readFileSync(join(dir, "golden", "2026-08-05-경영평가.dsl.md"), "utf8");

describe("golden: 2026.08.05 경영평가 대응 공문 reproduced from DSL", () => {
  const { doc, warnings } = parseDsl(dsl);

  it("parses without warnings; family official, 2 tables(두문·결문)", () => {
    expect(warnings).toEqual([]);
    expect(doc.family).toBe("official");
  });

  const { bytes, report } = buildHwpx(doc, { now: new Date("2026-08-05T00:00:00Z") });

  it("빌드 경고 없이 두문·결문 표 두 개를 만든다", () => {
    expect(report.warnings).toEqual([]);
    expect(report.tables).toBe(2);
  });

  it("@rhwp/core 검증을 contentLoss 0, 오류 없음으로 통과한다", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.contentLoss?.count).toBe(0);
  }, 60_000);

  it("두문: 기관명·수신·제목이 들어간다", async () => {
    const text = norm(await extractText(bytes));
    expect(text).toContain(norm("(재)경상북도경제진흥원"));
    expect(text).toContain(norm("수신자 참조"));
    expect(text).toContain(norm("경영평가 대응을 위한 2026년 사업 추진 현황 제출 요청"));
  }, 60_000);

  it("본문: 참고 문서의 다섯 항목과 붙임·끝. 줄이 모두 들어간다", async () => {
    const text = norm(await extractText(bytes));
    const items = [
      "1. 작성대상: 2026년 각 팀에서 운영하고 있는 전체 사업",
      "2. 작성기준: 전월 말일 기준 사업별 예산 집행액 및 지원 현황",
      "3. 제출방법: 대내 공문 발송",
      "4. 제출기한: 매월 5일까지   ※ 7월 현항 제출 기한: 2026. 8. 10.(월) 14:00까지",
      "5. 문의처: 전략기획팀 권하경(내선번호527)",
    ];
    for (const item of items) expect(text).toContain(norm(item));
    expect(text).toContain(norm("붙임  (양식) 2026년 사업 추진 현황_팀명 1부.  끝."));
  }, 60_000);

  it("결문: 발신명의·결재란 직위(전결)·연락처가 들어간다", async () => {
    const text = norm(await extractText(bytes));
    expect(text).toContain(norm("경영기획실장")); // 발신명의
    // 결재라인을 [과장, 팀장, 실장]로 명시했다 — 참고 문서의 "★과장 / 팀장 / 실장"(실장 전결)을
    // 재현한다. ★ 표식 자체는 스키마에 없어 옮기지 않는다(task-6-report.md 참조).
    expect(text).toContain("과장");
    expect(text).toContain("팀장");
    expect(text).toContain("실장");
    expect(text).toContain(norm("054-470-8527")); // 전화
    expect(text).toContain(norm("054-472-2989")); // 전송
    expect(text).toContain(norm("nancy.kwon@gepa.kr")); // 이메일
  }, 60_000);

  /**
   * 시행 칸은 `<처리과>-` 까지만 찍고 일련번호를 만들지 않는다 — 전자결재가 기안 후 채번한다
   * (lib/hwpx/writers/official.ts). 참고 문서는 "전략기획팀-485"(시행 일련번호 485)이지만,
   * 이 규칙(스키마·작성기·페르소나·프롬프트·검토관에 이은 여섯 번째 방어선)을 실제 문서로
   * 증명하는 것이 이 골든의 목적이므로 숫자가 없다는 것을 직접 확인한다.
   */
  it("시행 칸은 <처리과>- 뿐이고 뒤에 숫자가 없다", async () => {
    const text = await extractText(bytes);
    expect(text).toContain("전략기획팀-");
    expect(text).not.toMatch(/전략기획팀-\d/);
  }, 60_000);
});
