import { describe, expect, it } from "vitest";
import { findPageSplits } from "@/lib/hwpx/pageSplit";

// 한글이 읽어 준 쪽별 글: 문단마다 한 줄, 표만 든 문단(장 띠·절 칩·표)은 빈 줄
describe("장·절이 애매하게 쪼개진 쪽(findPageSplits)", () => {
  it("앞 장의 끝 두 문단만 넘어오고 그 아래 띠 다음에 □ 가 시작하면 잡는다 (결과보고서 3쪽, 담당자 2026-10-21)", () => {
    const pages = ["표지", "「2025년 시험 사업」 결과보고\n\n  ○ (사 업 명) 시험", "  ○ (지급방법) 과업 완료 후 지급\n    ※ 근거: 사업계획\n\n□ 세부사업별 계획 대비 실적\n"];
    expect(findPageSplits(pages)).toEqual([{ page: 3, spilled: 2, head: "○ (지급방법) 과업 완료 후 지급" }]);
  });

  it("절의 끝이 넘어오고 다음 절 칩 아래 (계 획) 이 시작하면 잡는다", () => {
    const pages = ["앞", "  - (수여식) 11. 26. 수여\n  ※ 목표 초과 달성\n\n  ○ (계    획) 20명 정도"];
    expect(findPageSplits(pages).map((s) => s.spilled)).toEqual([2]);
  });

  it("본문이 표로 이어지는 넘김, 문서 제목, 쪽 첫머리의 새 □ 는 잡지 않는다", () => {
    expect(findPageSplits(["앞", "  - (서류심사) 3개사 제외\n  - (현장실사) 3개사 포기\n\n  ○ (추진실적) 4개사"])).toEqual([]);
    expect(findPageSplits(["표지", "「2025년 시험 사업」 결과보고\n\n□ 사업개요"])).toEqual([]);
    expect(findPageSplits(["앞", "□ 주요 성과\n  ㅇ 4개사 지정"])).toEqual([]);
  });

  it("네 문단 이상 넘어왔으면 쪼개진 것으로 보지 않는다", () => {
    expect(findPageSplits(["앞", "  - 가\n  - 나\n  - 다\n  - 라\n\n□ 다음"])).toEqual([]);
  });
});
