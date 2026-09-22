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
  /**
   * `#` 장 띠(chapterBand)의 번호를 Ⅰ·Ⅱ·Ⅲ 로 쓸지 1·2·3 으로 쓸지.
   *
   * 예전에는 parser.ts 가 `this.meta` 를 사업계획서 meta 로 캐스팅해 `.numbering` 을 읽었다.
   * 그 칸이 없는 family(업무보고)는 `undefined !== "arabic"` 이 참이라 **우연히** 로마자로
   * 떨어졌다 — 맞는 값이 맞는 이유로 나온 것이 아니었다. 각 확장기가 제 meta 에서 채우고
   * 파서는 이것만 읽는다. 인터페이스이므로 확장기 하나를 빠뜨리면 컴파일이 깨진다.
   */
  numeralStyle: "roman" | "arabic";
}
