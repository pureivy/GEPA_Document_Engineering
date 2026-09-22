/**
 * 사업계획서 expander (grammar rule 13):
 *   approvalBlock → coverTitle(meta.제목 [+ br + 부제]) → optional 요약 chips → body.
 *
 * The optional `<사업계획 요약>` page (file 5 style) is expressed as three `sectionChip`
 * blocks — the chip's grey cell carries 사업개요 / 추진일정 / 기대효과 (label '' = empty navy
 * sliver, exactly like the reference) — each followed by a `coverSummary` paragraph.
 */
import type { Inline, PlanMeta } from "../../schema";
import { parseInlines } from "../inline";
import type { BlockInput, FamilyContext } from "./types";

export const PLAN_SUMMARY_SECTIONS = ["사업개요", "추진일정", "기대효과"] as const;

export function planCoverTitle(meta: PlanMeta): Extract<BlockInput, { k: "coverTitle" }> {
  const inlines: Inline[] = [{ t: "text", text: meta.제목 }];
  if (meta.부제) inlines.push({ t: "br" }, { t: "text", text: meta.부제 });
  return { k: "coverTitle", inlines };
}

export function planPrelude(meta: PlanMeta): BlockInput[] {
  const blocks: BlockInput[] = [{ k: "approvalBlock" }, planCoverTitle(meta)];
  if (meta.요약) {
    for (const name of PLAN_SUMMARY_SECTIONS) {
      blocks.push({ k: "sectionChip", label: "", title: name });
      blocks.push({ k: "para", role: "coverSummary", inlines: parseInlines(meta.요약[name]).inlines });
    }
  }
  return blocks;
}

export function planContext(meta: PlanMeta): FamilyContext {
  return { prelude: planPrelude(meta), firstSectionNumber: 1, plainRole: "plain", allowHeadings: true, numeralStyle: meta.numbering === "arabic" ? "arabic" : "roman" };
}
