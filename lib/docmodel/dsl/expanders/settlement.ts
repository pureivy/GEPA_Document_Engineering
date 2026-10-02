/**
 * 정산보고서 expander. 표지 제목만 meta 에서 펼친다(참고본 첫 문단: HY헤드라인M 22pt 가운데).
 * 사업명 줄·총괄표·제출자·연락처 상자는 본문(DSL)이 쓴다 — 매크로와 서식 틀이 그 자리를 채운다.
 * `#` 는 "1. │ 제목" 장 띠, `##` 는 󰊱 절 제목이다(참고본 그대로 아라비아 숫자).
 */
import type { SettlementMeta } from "../../schema";
import type { BlockInput, FamilyContext } from "./types";

export function settlementPrelude(meta: SettlementMeta): BlockInput[] {
  return [{ k: "coverTitle", inlines: [{ t: "text", text: meta.제목 }] }];
}

export function settlementContext(meta: SettlementMeta): FamilyContext {
  return { prelude: settlementPrelude(meta), firstSectionNumber: 1, plainRole: "plain", allowHeadings: true, numeralStyle: "arabic" };
}
