/**
 * 주요업무보고 expander (grammar 규칙 13). 스펙 §5.3.
 *
 * prelude 가 비어 있다. 다른 family 는 meta 의 제목·부제를 문단으로 펼치지만, 업무보고의
 * 표지(제목·보고일·부서)는 참고본에서 문단이 아니라 표지 쪽의 도형·문단 묶음이다 —
 * 공문서의 두문과 같이 작성기(lib/hwpx/writers/report.ts, Task 3)가 meta 에서 직접 쓴다.
 *
 * `allowHeadings: false` 는 DOC_FAMILIES.report.headingStyle 이 "none" 인 것과 짝이다
 * (families.ts:34 — 어긋나면 `#` 이 조용히 공고문 섹션바로 펼쳐진다).
 */
import type { BlockInput, FamilyContext } from "./types";

export function reportPrelude(): BlockInput[] {
  return [];
}

export function reportContext(): FamilyContext {
  return { prelude: reportPrelude(), firstSectionNumber: 1, plainRole: "plain", allowHeadings: false };
}
