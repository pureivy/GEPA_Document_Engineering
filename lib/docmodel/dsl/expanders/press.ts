/**
 * 보도자료 expander (grammar rule 13): pressHeader → pressTitle → pressSubtitle → body.
 * Body lines without a glyph become `pressBody`; `#` headings are not part of the press grammar.
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
  return { prelude: pressPrelude(meta), firstSectionNumber: 1, plainRole: "pressBody", allowHeadings: false };
}
