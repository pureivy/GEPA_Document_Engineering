import { describe, expect, it } from "vitest";
import { findPriorCopies, priorCopyWarnings } from "@/lib/closeout/priorCopy";

// 지난해 결과보고서(prior/text/*.md) — 성과·총평 문장이 올해 Ⅳ 로 옮겨지면 잡는다(담당자 2026-10-22)
const prior = [
  "# 자료 — 2024 결과보고.pdf\n\nㅇ (추진절차) 공고 및 수요기업 모집, 기업선정 및 통보, 협약 체결\nㅇ 체험 프로그램 참가자 만족도가 높게 나타나 향토뿌리기업 인지도 제고에 기여\nㅇ 신청 기업이 적었으므로, 차년도에는 모집 시기를 3월로 앞당길 필요",
];

describe("전년 문장 옮겨 쓰기(findPriorCopies)", () => {
  it("Ⅳ 성과 및 총평의 문장이 지난해 보고서에 그대로 있으면 잡는다 — 띄어쓰기·쉼표가 달라도", () => {
    const dsl = ["# 사업개요", "ㅇ (추진절차) 공고 및 수요기업 모집, 기업선정 및 통보, 협약 체결", "# 성과 및 총평", "□ 주요 성과", "ㅇ 향토뿌리기업 4개사 신규지정", "ㅇ 체험 프로그램 참가자 만족도가 높게 나타나  향토뿌리기업 인지도 제고에 기여"].join("\n");
    expect(findPriorCopies(dsl, prior)).toEqual([{ line: 6, text: "체험 프로그램 참가자 만족도가 높게 나타나  향토뿌리기업 인지도 제고에 기여" }]);
  });

  it("Ⅰ 의 계획서 문장(추진절차)과 짧은 문장, 표 줄은 보지 않는다", () => {
    const dsl = ["# 사업개요", "ㅇ (추진절차) 공고 및 수요기업 모집, 기업선정 및 통보, 협약 체결", "# 성과 및 총평", "ㅇ 협약 체결", "| 신청 기업이 적었으므로, 차년도에는 모집 시기를 3월로 앞당길 필요 |"].join("\n");
    expect(findPriorCopies(dsl, prior)).toEqual([]);
  });

  it("전년도 자료가 없으면 아무것도 잡지 않고, 경고에는 행과 앞부분을 담는다", () => {
    const dsl = "# 성과 및 총평\nㅇ 신청 기업이 적었으므로, 차년도에는 모집 시기를 3월로 앞당길 필요";
    expect(findPriorCopies(dsl, [])).toEqual([]);
    expect(priorCopyWarnings(dsl, prior)[0]).toMatch(/^\[전년 문장\] 2행 "신청 기업이 적었으므로/);
  });
});
