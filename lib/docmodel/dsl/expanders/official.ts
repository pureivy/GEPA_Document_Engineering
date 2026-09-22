/**
 * 공문서 expander (grammar 규칙 13): officialHeader → 본문 → officialFooter.
 * 두문·결문은 작성자가 쓰지 않고 작성기가 meta 에서 펼친다.
 * `#` 제목 문법은 쓰지 않는다 — 공문서 본문은 1. 가. 항목으로만 구성된다.
 *
 * 결문(officialFooter)은 prelude 에 넣지 않는다. prelude 는 본문 **앞**에 붙고 결문은 맨 뒤에
 * 와야 하므로, 작성기(lib/hwpx/writers/official.ts)가 본문을 다 쓴 뒤에 붙인다.
 */
import type { BlockInput, FamilyContext } from "./types";

/**
 * 다른 family 와 달리 meta 를 받지 않는다. 공고문·보도자료는 제목·부제를 meta 에서 읽어
 * prelude 문단으로 펼치지만, 공문서의 두문 값(수신·경유·제목)은 문단이 아니라 참고 문서 표의
 * 칸에 들어간다 — 작성기가 HWPX 를 쓸 때 meta 에서 채운다.
 */
export function officialPrelude(): BlockInput[] {
  return [{ k: "officialHeader" }];
}

export function officialContext(): FamilyContext {
  return { prelude: officialPrelude(), firstSectionNumber: 1, plainRole: "plain", allowHeadings: false };
}
