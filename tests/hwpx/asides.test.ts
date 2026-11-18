import { describe, expect, it } from "vitest";
import { shrinkAsides } from "../../lib/hwpx/writers/asides";

/** 담당자 2026-11-18: 앞말을 설명하는 괄호(공감플러스(경북 안동시))는 본문보다 2pt 작게, 머리말·요일은 그대로 */
describe("설명 괄호 줄이기", () => {
  it("앞말에 붙은 설명 괄호만 작게 하고, 머리말·요일·(안)은 그대로 둔다", () => {
    const out = shrinkAsides(
      [
        { t: "text", text: "(제작 계약)", bold: true },
        { t: "text", text: " 공감플러스(경북 안동시), 기간 11. 11.(수)~12. 31.(목), 일정(안), 금19,450,000원(부가가치세 포함)" },
      ],
      12,
    );
    const small = out.filter((i) => i.t === "text" && i.size === 12).map((i) => (i.t === "text" ? i.text : ""));
    expect(small).toEqual(["(경북 안동시)", "(부가가치세 포함)"]);
    expect(out.map((i) => (i.t === "text" ? i.text : "")).join("")).toBe("(제작 계약) 공감플러스(경북 안동시), 기간 11. 11.(수)~12. 31.(목), 일정(안), 금19,450,000원(부가가치세 포함)");
  });
  it("줄 머리의 괄호(앞이 빈칸)는 설명이 아니다", () => {
    const out = shrinkAsides([{ t: "text", text: " (시안 확정) 컨펌 전" }], 12);
    expect(out).toEqual([{ t: "text", text: " (시안 확정) 컨펌 전" }]);
  });
});
