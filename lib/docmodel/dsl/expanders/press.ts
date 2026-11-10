/**
 * 보도자료 expander (grammar rule 13): pressHeader → pressTitle → pressSubtitle → body.
 * Body lines without a glyph become `pressBody`; `#` 소제목은 sectionBar 로 받아 작성기가 `■  소제목` 줄로 낸다
 * (2026년 서식 — docs/design-system/press.md). `##` 은 굵은 `□` 줄.
 */
import type { PressMeta } from "../../schema";
import { parseInlines } from "../inline";
import type { BlockInput, FamilyContext } from "./types";

export function pressPrelude(meta: PressMeta): BlockInput[] {
  const blocks: BlockInput[] = [{ k: "pressHeader" }, { k: "para", role: "pressTitle", inlines: parseInlines(meta.제목).inlines }];
  if (meta.부제) blocks.push({ k: "para", role: "pressSubtitle", inlines: parseInlines(meta.부제).inlines });
  return blocks;
}

export function pressContext(meta: PressMeta): FamilyContext {
  // headingStyle "sectionBar" 와 짝: `#` → sectionBar(번호는 작성기가 쓰지 않는다). numeralStyle 은 chapterChip 가족만 읽는다.
  return { prelude: pressPrelude(meta), firstSectionNumber: 1, plainRole: "pressBody", allowHeadings: true, numeralStyle: "roman" };
}
