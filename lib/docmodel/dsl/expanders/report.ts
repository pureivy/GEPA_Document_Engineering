/**
 * 주요업무보고 expander (grammar 규칙 13). 스펙 §5.3.
 *
 * prelude 가 비어 있다. 다른 family 는 meta 의 제목·부제를 문단으로 펼치지만, 업무보고의
 * 표지(제목·보고일·부서)는 참고본에서 문단이 아니라 표지 쪽의 도형·문단 묶음이다 —
 * 공문서의 두문과 같이 작성기(lib/hwpx/writers/report.ts, Task 3)가 meta 에서 직접 쓴다.
 *
 * `allowHeadings: true` 는 DOC_FAMILIES.report.headingStyle 이 "chapterChip" 인 것과 짝이다.
 * 업무보고의 간지 Ⅰ·Ⅱ·Ⅲ 은 본문 **중간에 되풀이**되므로 "어디에" 를 DSL 에서 받아야 한다 —
 * 공문서의 두문·결문처럼 고정된 자리가 아니라서 작성기가 혼자 놓을 수 없다. 그래서 `#` 문법을
 * 연다(`headingStyle: "none"` 이면 parser.ts:510 이 먼저 끊어 `#` 이 굵은 문단으로 떨어진다).
 */
import type { BlockInput, FamilyContext } from "./types";

export function reportPrelude(): BlockInput[] {
  return [];
}

export function reportContext(): FamilyContext {
  // 참고본의 간지는 Ⅰ·Ⅱ·Ⅲ 이다. `##` 절 칩의 1·2·3 은 chipCounter 가 따로 센다.
  return { prelude: reportPrelude(), firstSectionNumber: 1, plainRole: "plain", allowHeadings: true, numeralStyle: "roman" };
}
