import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { bodyPageCount, onePageWarnings } from "../../lib/hwpx/onePage";
import { fixableWarnings } from "../../lib/stages/runIntegration";

/**
 * 원페이지(간략) 업무보고는 본문이 한 쪽이어야 한다 — 뒷장 「참고 N」 쪽은 세지 않는다(담당자 2026-11-18, 장부 P3).
 * 쪽 글은 한글이 읽어 준 모양(hangul.ts): 문단마다 한 줄, 표 안 글은 나오지 않는다.
 */
const head = (형태: string) => `---
family: report
형태: ${형태}
제목: 도내 중소기업 및 소상공인 현황
부서: 전략기획팀
---
`;
const BODY = `## 중소기업의 정의
● **(중소기업)** 업종별 매출액 기준·자산총액·독립성 요건을 모두 갖춘 기업 ☞ 참고 1
- 3년 평균매출액등이 업종별 기준 이하
`;
const REF = `<참고 1 주된 업종별 중소기업 규모 기준>
## 평균매출액등 기준
| 규모 기준 | 해당 업종 |
|---|---|
| 1,800억원 이하 | 1차 금속 |
※ 출처: 「중소기업기본법 시행령」 [별표 1]
`;
const doc = (형태: string, ref = true) => parseDsl(head(형태) + BODY + (ref ? REF : "")).doc;

const page1 = "도내 중소기업 및 소상공인 현황\n□ 중소기업의 정의\nㅇ (중소기업) 업종별 매출액 기준·자산총액·독립성 요건을 모두 갖춘 기업 ☞ 참고 1";
const page2Body = "- 3년 평균매출액등이 업종별 기준 이하";
const refPage = "\n평균매출액등 기준\n\n※ 출처: 「중소기업기본법 시행령」 [별표 1]";

describe("원페이지 한 장 넘침", () => {
  it("본문 한 쪽 + 참고 한 쪽이면 경고하지 않는다(참고는 세지 않는다)", () => {
    expect(bodyPageCount(doc("간략"), [page1 + "\n" + page2Body, refPage])).toBe(1);
    expect(onePageWarnings(doc("간략"), [page1 + "\n" + page2Body, refPage])).toEqual([]);
  });

  it("본문이 두 쪽으로 넘치면 [한 장 넘침] 경고를 내고, 자동 다듬기 대상이다", () => {
    const w = onePageWarnings(doc("간략"), [page1, page2Body, refPage]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^\[한 장 넘침\] .*본문이 2쪽/);
    expect(w[0]).toContain("☞ 참고");
    expect(fixableWarnings(w)).toEqual(w);
  });

  it("참고가 없으면 전체 쪽 수가 본문이다", () => {
    expect(onePageWarnings(doc("간략", false), [page1, page2Body])).toHaveLength(1);
    expect(onePageWarnings(doc("간략", false), [page1 + "\n" + page2Body])).toEqual([]);
  });

  it("책자형은 쪽 수를 따지지 않는다", () => {
    expect(onePageWarnings(doc("책자", false), [page1, page2Body, "x"])).toEqual([]);
  });

  it("참고 시작 쪽을 못 찾으면 판정하지 않는다(틀린 경고를 내지 않는다)", () => {
    expect(bodyPageCount(doc("간략"), [page1, page2Body, "엉뚱한 쪽"])).toBeNull();
    expect(onePageWarnings(doc("간략"), [page1, page2Body, "엉뚱한 쪽"])).toEqual([]);
  });
});
