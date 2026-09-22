import { describe, it, expect } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { lintGovStyle } from "../../lib/docmodel/govLint";

const FM = `---\nfamily: plan\n제목: 테스트 계획(안)\n---\n`;
const rules = (dsl: string) => lintGovStyle(parseDsl(FM + dsl).doc).map((i) => i.rule);

describe("lintGovStyle — 행정업무운영 편람 작성 기준", () => {
  it("passes a compliant document", () => {
    const dsl = `# 사업개요\n□ 사업개요\nㅇ (사업기간) 2026. 7. 1.~12. 31.\nㅇ (사 업 비) 금60,000,000원(금육천만원)\nㅇ 접수 마감: 2026. 7. 15.(수) 18:00\n# 기대효과\nㅇ 수출 확대\nㅇ 일자리 창출  끝.\n`;
    expect(rules(dsl)).toEqual([]);
  });
  it("flags dates without a space / trailing period / zero padding", () => {
    expect(rules(`□ 가\nㅇ 2021.12.12. 시행\nㅇ 2023. 6. 27(화) 접수\nㅇ 1985. 09. 06. 개정  끝.\n`)).toEqual(expect.arrayContaining(["날짜 띄어쓰기", "날짜 마침표", "날짜 0 생략"]));
    const fix = lintGovStyle(parseDsl(FM + `□ 가\nㅇ 2021.12.12. 시행  끝.\nㅇ 나\n`).doc).find((i) => i.rule === "날짜 띄어쓰기");
    expect(fix?.fix).toBe("2021. 12. 12.");
  });
  it("flags colon / tilde spacing, Korean time, amount without 한글 병기", () => {
    const r = rules(`□ 가\nㅇ 원장 : 김갑동\nㅇ 4. 23. ~ 6. 15.\nㅇ 오후 3시 20분 개회\nㅇ 금113,560원 지급  끝.\n`);
    expect(r).toEqual(expect.arrayContaining(["쌍점", "물결표", "시간 표기", "금액 한글 병기"]));
  });
  it("flags a lone sub-item and a skipped level", () => {
    expect(rules(`□ 가\nㅇ 하나뿐인 항목\n□ 나\nㅇ 둘\nㅇ 셋  끝.\n`)).toContain("항목 하나");
    expect(rules(`□ 가\n- 단계 건너뜀\n- 둘  끝.\n`)).toContain("항목 위계");
  });
  it("flags a missing 끝 and a 붙임 line without two spaces", () => {
    expect(rules(`□ 가\nㅇ 둘\nㅇ 셋\n`)).toContain("끝 표시");
    expect(rules(`□ 가\nㅇ 둘\nㅇ 셋 끝.\n`)).toContain("끝 표시 간격");
    expect(rules(`□ 가\nㅇ 둘\nㅇ 셋\n붙임 사업계획서 1부.  끝.\n`)).toContain("붙임 표기");
  });
});

/**
 * 공문서는 `끝.` 을 본문 블록이 아니라 작성기가 만드는 붙임 줄에 찍는다(meta.붙임 → attachment
 * 문단). 다른 family 는 전부 `attachmentList` 블록으로 내므로 govLint:96 의 면제가 걸리지만
 * 공문서만 걸리지 않아, 붙임 있는 모든 공문서에서 "끝 표시" 경고가 헛울렸다.
 */
describe("lintGovStyle — 공문서의 끝 표시", () => {
  const official = (fm: string, body: string) => lintGovStyle(parseDsl(`---\nfamily: official\n수신유형: 내부결재\n제목: 가\n처리과: 마케팅팀\n${fm}---\n${body}`).doc).map((i) => i.rule);

  it("meta.붙임 이 있으면 끝 표시를 요구하지 않는다 — 작성기가 붙임 줄에 찍는다", () => {
    expect(official(`붙임: ["계획서 1부."]\n`, `1. 자료를 제출하여 주시기 바랍니다.\n`)).not.toContain("끝 표시");
  });

  it("붙임이 없으면 여전히 끝 표시를 요구한다 — 그때는 작성기도 찍지 않는다", () => {
    expect(official("", `1. 자료를 제출하여 주시기 바랍니다.\n`)).toContain("끝 표시");
  });
});
