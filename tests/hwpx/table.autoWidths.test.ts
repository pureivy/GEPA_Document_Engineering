import { describe, expect, it } from "vitest";
import { buildHwpx } from "../../lib/hwpx/build";
import { parseDsl } from "../../lib/docmodel/dsl";
import { findAll, parseXml } from "../../lib/hwpx/xml";

/**
 * 너비를 주지 않은 표는 칸을 똑같이 나누지 않고 글 길이에 맞춘다(담당자 2026-11-10: 「참고 1」 업종별 기준표가
 * "왼쪽 너무 여백 많고 오른쪽 촘촘"). 숫자만 나란히 든 칸들은 같은 너비로 맞춘다.
 */
const head = "---\nfamily: report\n형태: 간략\n제목: x\n부서: y\n---\n";
const widthsOf = (dsl: string) => {
  const out = buildHwpx(parseDsl(head + dsl).doc, { now: new Date("2026-11-10T00:00:00Z") });
  const tbl = findAll(parseXml(out.sectionXml), "hp:tbl").at(-1)!;
  const row = findAll(tbl, "hp:tr")[0];
  return findAll(row, "hp:cellSz").map((n) => Number(n.attrs.width));
};

describe("표 칸 너비 — 글 길이에 맞춤", () => {
  it("짧은 기준 칸은 좁게, 긴 업종 나열 칸이 남는 폭을 가진다", () => {
    const w = widthsOf(`| 규모 기준 | 해당 업종 |
|---|---|
| 1,800 이하 | 펄프·종이, 1차 금속, 전기장비 제조업 |
| 1,000 이하 | 건설업, 도매 및 소매업, 농업·임업·어업, 광업, 섬유(의복 제외), 목재, 코크스·석유정제, 전자부품·컴퓨터, 기타 제품 제조업, 전기·가스, 수도업, 운수 및 창고업, 정보통신업, 담배 제조업 |
`);
    expect(w).toHaveLength(2);
    expect(w[1]).toBeGreaterThan(w[0] * 3);
    // 「1,800 이하」는 한 줄에 들어갈 폭(11pt × 약 5em + 여백)
    expect(w[0]).toBeGreaterThan(11 * 100 * 5);
  });

  it("숫자만 든 비교 칸은 같은 너비, 글 칸은 따로", () => {
    const w = widthsOf(`| 구분 | 전국 | 경북 | 경북 비중 |
|---|---|---|---|
| 전체 기업 | 8,511,712 | 418,095 | 4.9 |
| 소상공인 | 8,109,650 | 401,605 | 5.0 |
`);
    expect(w).toHaveLength(4);
    expect(Math.abs(w[1] - w[2])).toBeLessThanOrEqual(5);
    expect(Math.abs(w[2] - w[3])).toBeLessThanOrEqual(5);
  });
});
