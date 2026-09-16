/**
 * DocModel — the typed intermediate representation shared by the DSL parser, the HWPX
 * writers and the browser editor. Every block has a stable `id` (assigned in document
 * order by the parser) used for streaming upserts and editor node mapping.
 */
import { z } from "zod";

export const FamilySchema = z.enum(["plan", "notice", "press"]);
export type Family = z.infer<typeof FamilySchema>;

export const GlyphSchema = z.enum(["□", "ㅇ", "○", "◦", "-", "·", "※", "*", "❖", "◇", "■", "✔", "❍", "▪", "∙", "❶", "❷", "❸", "❹", "none"]);
export type Glyph = z.infer<typeof GlyphSchema>;

export const AlignSchema = z.enum(["left", "center", "right", "both", "distribute"]);
export type Align = z.infer<typeof AlignSchema>;

export const InlineSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("text"),
    text: z.string(),
    bold: z.boolean().optional(),
    color: z.string().optional(), // #RRGGBB
    size: z.number().optional(), // pt override
    font: z.enum(["heading", "body", "note", "table"]).optional(),
  }),
  z.object({ t: z.literal("link"), text: z.string(), href: z.string() }),
  z.object({ t: z.literal("br") }),
]);
export type Inline = z.infer<typeof InlineSchema>;

export const ParaRoleSchema = z.enum([
  // shared body ladder
  "body1", // □
  "body2", // ㅇ ○ ◦
  "body3", // -
  "body4", // ·
  "note", // ※
  "footnote", // *
  "unitCaption", // (단위: 천원), right aligned
  "attachmentHeading", // [별첨1] …
  "plain",
  // notice cover
  "noticeNumber",
  "noticeTitle",
  "greeting",
  "noticeDate",
  "signer",
  // plan
  "coverTitle",
  "coverSummary",
  "tocLine",
  "annexHeading",
  // press
  "pressTitle",
  "pressSubtitle",
  "pressLead",
  "pressBody",
  "pressContact",
]);
export type ParaRole = z.infer<typeof ParaRoleSchema>;

export const TableRoleSchema = z.enum(["generic", "budget", "schedule", "roles", "docs", "support", "evalCriteria", "yearly", "flowDiagram"]);
export type TableRole = z.infer<typeof TableRoleSchema>;

export const BorderSpecSchema = z.object({
  type: z.enum(["none", "solid", "dash", "dot", "double"]).default("solid"),
  widthMm: z.number().default(0.12),
  color: z.string().default("#000000"),
});
export type BorderSpec = z.infer<typeof BorderSpecSchema>;

export const CellSchema = z.object({
  inlines: z.array(InlineSchema), // '\n' inside text or {t:'br'} = new paragraph in the cell
  colSpan: z.number().int().min(1).optional(),
  rowSpan: z.number().int().min(1).optional(),
  fill: z.string().optional(),
  align: AlignSchema.optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  bold: z.boolean().optional(),
  borders: z.object({ l: BorderSpecSchema.optional(), r: BorderSpecSchema.optional(), t: BorderSpecSchema.optional(), b: BorderSpecSchema.optional() }).optional(),
  /** true when this position is covered by a span anchor above/left (not emitted) */
  covered: z.boolean().optional(),
});
export type Cell = z.infer<typeof CellSchema>;

export const RowSchema = z.object({
  cells: z.array(CellSchema),
  heightPt: z.number().optional(),
  isHeader: z.boolean().optional(),
  isTotal: z.boolean().optional(),
});
export type Row = z.infer<typeof RowSchema>;

export const TableStyleSchema = z.object({
  headerFill: z.string().optional(), // default #D9D9D9 (plan) / #DFE6F7 (notice)
  totalFill: z.string().optional(),
  border: z.enum(["grid012", "grey012", "none"]).optional(),
  borderColor: z.string().optional(),
  padding: z.enum(["tight", "text"]).optional(),
  fontPt: z.number().optional(),
  headerFontPt: z.number().optional(),
  lineSpacing: z.number().optional(),
});
export type TableStyle = z.infer<typeof TableStyleSchema>;

const Base = { id: z.string() };

export const BlockSchema = z.discriminatedUnion("k", [
  z.object({
    ...Base,
    k: z.literal("para"),
    role: ParaRoleSchema,
    glyph: GlyphSchema.optional(),
    inlines: z.array(InlineSchema),
    align: AlignSchema.optional(),
    pageBreakBefore: z.boolean().optional(),
    /** leading spaces override (default from indent table for family/glyph) */
    indent: z.number().int().optional(),
  }),
  z.object({ ...Base, k: z.literal("blank"), role: z.enum(["blank", "blankSmall"]).optional() }),
  z.object({ ...Base, k: z.literal("pageBreak") }),
  z.object({ ...Base, k: z.literal("image"), asset: z.string(), widthMm: z.number().optional(), heightMm: z.number().optional(), align: z.enum(["left", "center"]).optional() }),
  z.object({
    ...Base,
    k: z.literal("table"),
    role: TableRoleSchema,
    caption: z.string().optional(),
    widthsPt: z.array(z.number()).optional(),
    rows: z.array(RowSchema),
    headerRows: z.number().int().optional(),
    style: TableStyleSchema.optional(),
  }),
  // ---- plan composites
  z.object({ ...Base, k: z.literal("chapterBand"), numeral: z.string(), title: z.string() }),
  z.object({ ...Base, k: z.literal("sectionChip"), label: z.string(), title: z.string() }),
  z.object({ ...Base, k: z.literal("summaryBox"), glyph: z.enum(["❖", "◇", "none"]).optional(), lines: z.array(z.array(InlineSchema)) }),
  z.object({ ...Base, k: z.literal("approvalBlock") }),
  z.object({ ...Base, k: z.literal("coverTitle"), inlines: z.array(InlineSchema), sizePt: z.number().optional() }),
  // ---- notice composites
  z.object({ ...Base, k: z.literal("sectionBar"), number: z.number().int(), title: z.string(), variant: z.enum(["tall", "short"]).optional() }),
  z.object({ ...Base, k: z.literal("infoBox"), groups: z.array(z.object({ heading: z.string(), items: z.array(z.array(InlineSchema)) })) }),
  z.object({
    ...Base,
    k: z.literal("overviewTable"),
    rows: z.array(z.union([z.literal("spacer"), z.object({ label: z.string(), value: z.array(InlineSchema), bullet: z.boolean().optional() })])),
  }),
  z.object({ ...Base, k: z.literal("procedureFlow"), stages: z.array(z.object({ name: z.string(), when: z.string() })) }),
  z.object({ ...Base, k: z.literal("noticeHeader") }),
  // ---- press composites
  z.object({ ...Base, k: z.literal("pressHeader") }),
  z.object({ ...Base, k: z.literal("attachmentList"), items: z.array(z.string()) }),
]);
export type Block = z.infer<typeof BlockSchema>;
export type BlockKind = Block["k"];

export const NoticeMetaSchema = z.object({
  공고번호: z.string(),
  사업명: z.string(),
  모집대상: z.string().default("참여기업"),
  부제: z.string().optional(),
  주관기관: z.string(),
  지역: z.string(),
  대상기업군: z.string().default("중소기업"),
  공고연월: z.string(),
  기관장: z.string().default("(재)경상북도경제진흥원장"),
  접수: z.object({
    이메일: z.string(),
    우편주소: z.string(),
    부서명: z.string(),
    전화: z.string(),
    선정결과통보: z.string().default("기업별 개별통보(필요시 접수 홈페이지 공고)"),
  }),
  모집개요: z.array(z.union([z.literal("spacer"), z.object({ 라벨: z.string(), 값: z.string(), 불릿: z.boolean().optional() })])),
  절차도: z.array(z.object({ 단계: z.string(), 일정: z.string() })),
  로고: z.boolean().default(true),
});
export type NoticeMeta = z.infer<typeof NoticeMetaSchema>;

export const PlanMetaSchema = z.object({
  제목: z.string(),
  부제: z.string().optional(),
  연도: z.string().optional(),
  부서: z.string().optional(),
  등록번호: z.string().optional(),
  결재: z
    .object({
      담당: z.string().optional(),
      팀장: z.string().optional(),
      실장: z.string().optional(),
      본부장: z.string().optional(),
      원장: z.string().optional(),
      등록일자: z.string().optional(),
      결재일자: z.string().optional(),
      공개구분: z.string().optional(),
      협조: z.string().optional(),
    })
    .optional(),
  요약: z.object({ 사업개요: z.string(), 추진일정: z.string(), 기대효과: z.string() }).optional(),
  numbering: z.enum(["roman", "arabic"]).default("roman"),
  lineSpacing: z.number().default(160),
  body1Font: z.enum(["humanMyeongjoBold", "hyHeadlineBold"]).default("humanMyeongjoBold"),
  /**
   * House style profile. "gepa" = 경상북도경제진흥원 reference documents (default).
   * "bumpis" = 범정부오피스(행정안전부 표준 보고서 서식): □ HY헤드라인M 16, ○ 휴먼명조 15,
   * ※/* 맑은 고딕 12, bottom margin 10mm, light-blue table headers with 0.5mm rules,
   * numbered navy section chips, boxed title. See docs/design-system/bumpis.md.
   */
  house: z.enum(["gepa", "bumpis"]).default("gepa"),
});
export type PlanMeta = z.infer<typeof PlanMetaSchema>;

export const PressMetaSchema = z.object({
  기관: z.string().default("(재)경상북도경제진흥원"),
  배포일: z.string(),
  보도시점: z.string().default("즉시"),
  담당부서: z.string(),
  /** 머리표 "작성자" 첫 줄 — 책임자(예: "실장 남상범"). 없으면 담당자 줄만 표시 */
  책임자: z.string().optional(),
  담당자: z.string(),
  연락처: z.string(),
  이메일: z.string().optional(),
  제목: z.string(),
  부제: z.string().optional(),
  사진: z.boolean().default(false),
  붙임: z.array(z.string()).optional(),
});
export type PressMeta = z.infer<typeof PressMetaSchema>;

export const DocModelSchema = z.discriminatedUnion("family", [
  z.object({ version: z.literal(1), family: z.literal("notice"), meta: NoticeMetaSchema, blocks: z.array(BlockSchema) }),
  z.object({ version: z.literal(1), family: z.literal("plan"), meta: PlanMetaSchema, blocks: z.array(BlockSchema) }),
  z.object({ version: z.literal(1), family: z.literal("press"), meta: PressMetaSchema, blocks: z.array(BlockSchema) }),
]);
export type DocModel = z.infer<typeof DocModelSchema>;
export type NoticeDoc = Extract<DocModel, { family: "notice" }>;
export type PlanDoc = Extract<DocModel, { family: "plan" }>;
export type PressDoc = Extract<DocModel, { family: "press" }>;

export function inlineText(inlines: Inline[]): string {
  return inlines.map((i) => (i.t === "br" ? "\n" : i.text)).join("");
}
export function plainInlines(text: string, extra: Partial<Extract<Inline, { t: "text" }>> = {}): Inline[] {
  return [{ t: "text", text, ...extra }];
}
