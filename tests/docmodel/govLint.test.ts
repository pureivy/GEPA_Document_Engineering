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
