import type { Block, ParaRole } from "../../schema";

/** A block before the parser assigns its id. */
export type BlockInput = Block extends infer B ? (B extends { id: string } ? Omit<B, "id"> : never) : never;

export interface FamilyContext {
  /** blocks synthesized from meta, prepended before the body (grammar rule 13) */
  prelude: BlockInput[];
  /** number given to the first auto-numbered `#` heading (notice: 3, since 1·2 are synthesized) */
  firstSectionNumber: number;
  /** role of a body line without a glyph */
  plainRole: ParaRole;
  /** whether `#` / `##` headings are part of the family grammar */
  allowHeadings: boolean;
}
