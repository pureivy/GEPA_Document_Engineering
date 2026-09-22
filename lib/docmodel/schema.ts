/**
 * DocModel — the typed intermediate representation shared by the DSL parser, the HWPX
 * writers and the browser editor. Every block has a stable `id` (assigned in document
 * order by the parser) used for streaming upserts and editor node mapping.
 */
import { z } from "zod";
import { DELEGATION_LEVELS, DEFAULT_DELEGATION, INSTITUTION_HEAD_TITLE } from "../org";

export const FamilySchema = z.enum(["plan", "notice", "press", "official", "report"]);
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
  z.object({
    ...Base,
    k: z.literal("image"),
    asset: z.string(),
    widthMm: z.number().optional(),
    heightMm: z.number().optional(),
    align: z.enum(["left", "center"]).optional(),
    /** "pageBottom" = 쪽 아래 고정(글자처럼 취급 안 함, 쪽 기준 아래 정렬) — 공고문 1쪽 로고 */
    position: z.enum(["inline", "pageBottom"]).optional(),
  }),
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
  // ---- official composites
  z.object({ ...Base, k: z.literal("officialHeader") }),
  z.object({ ...Base, k: z.literal("officialFooter") }),
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
  기관장: z.string().default(INSTITUTION_HEAD_TITLE),
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
  /** 본문 줄간격 % (user 2026-09-16: 사업계획서와 같은 160) */
  lineSpacing: z.number().default(160),
  /** 문단 위 간격: "plan" = 사업계획서와 같은 □10/ㅇ5/기타 3pt (기본), "none" = 참고 문서 그대로(골든) */
  paraSpacing: z.enum(["plan", "none"]).default("plan"),
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
      지소장: z.string().optional(),
      단장: z.string().optional(),
      등록일자: z.string().optional(),
      결재일자: z.string().optional(),
      공개구분: z.string().optional(),
      협조: z.string().optional(),
      /** 결재란 직위 4~5개(왼쪽부터). 비우면 `부서`로 lib/org.ts 의 결재라인을 고른다 */
      라인: z.array(z.string()).min(4).max(5).optional(),
    })
    .optional(),
  요약: z.object({ 사업개요: z.string(), 추진일정: z.string(), 기대효과: z.string() }).optional(),
  numbering: z.enum(["roman", "arabic"]).default("roman"),
  /**
   * 항목 들여쓰기 사다리. "gov"(기본) = 행정업무운영 편람: 첫째 항목 왼쪽 기본선, 이후 2타씩
   * (□0 ㅇ2 -4 ·6). "gepa" = 참고 문서 관행(□1 ㅇ2 -3 ·4). docs/design-system/gov-manual.md §3.
   */
  ladder: z.enum(["gepa", "gov"]).default("gov"),
  /** 본문 줄간격 % (user, 2026-09-16: 160) */
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

/**
 * 공문서 — 행정안전부 「행정업무의 운영 및 혁신에 관한 규정」 시행규칙 별지 제1호 일반기안문.
 * 가변부는 수신 / 제목 / 본문 / 붙임 네 가지뿐이고 나머지는 프레임과 조직 데이터다.
 *
 * 시행 일련번호는 이 스키마에 없다. 전자결재 시스템이 기안 후에 채번하므로 우리는 만들지 않는다
 * (시행 칸은 `<처리과>-` 까지만 찍는다). 값을 담을 자리를 두면 에이전트가 지어낸다.
 */
export const OfficialMetaSchema = z
  .object({
    수신유형: z.enum(["내부결재", "수신자", "수신자참조"]),
    /** 수신유형=수신자 일 때의 수신자 — 예: "경영기획실장(경영지원팀장)" */
    수신: z.string().optional(),
    /** 수신유형=수신자참조 일 때의 수신자 목록 */
    수신자: z.array(z.string()).optional(),
    경유: z.string().default(""),
    제목: z.string().min(1),
    /**
     * 결문 발신명의(직위). 비우면 **실제로 쓰인 결재라인의 마지막 직위**에서 정한다 —
     * 원장 → 기관장, 본부장 → 처리과가 속한 본부의 장, 실장·단장 → 그 실·단의 장(lib/org.ts
     * senderTitleFor). 부서에서 바로 뽑는 것이 아니다: 마케팅팀의 원장 전결은 실장이 아니라
     * 기관장 명의로 나간다. 우선순위는 이 값 → 직접 적은 `결재라인` 의 마지막 직위 → `전결`
     * 단계에서 끊은 결재라인의 마지막 직위.
     */
    발신명의: z.string().default(""),
    /** 기안 부서(팀). 시행 칸에 `<처리과>-` 로 찍힌다 */
    처리과: z.string().min(1),
    /** 시행일. 시행 전에는 빈 문자열 */
    시행일: z.string().default(""),
    공개구분: z.enum(["공개", "부분공개", "비공개"]).default("공개"),
    /**
     * 전결 단계 — 결재란과 발신명의를 함께 정한다(lib/org.ts DELEGATION_LEVELS). 기본은 원장:
     * 결재란은 처리과의 결재라인을 끝까지 쓰고 발신명의는 기관장이 된다. 전결은 그 사슬을 낮추는
     * 선택이라 적은 문서만 짧아진다(기본값의 근거는 lib/org.ts DEFAULT_DELEGATION).
     * `결재라인`·`발신명의`를 직접 적으면 각각 이 값보다 앞선다.
     */
    전결: z.enum(DELEGATION_LEVELS).default(DEFAULT_DELEGATION),
    /** 결재란 직위. 비우면 `전결` 단계에서 끊은 approvalLineFor(처리과) */
    결재라인: z.array(z.string()).default([]),
    협조자: z.array(z.string()).default([]),
    연락처: z
      .object({
        우편번호: z.string().default(""),
        주소: z.string().default(""),
        홈페이지: z.string().default("https://gepa.kr"),
        전화: z.string().default(""),
        전송: z.string().default(""),
        이메일: z.string().default(""),
      })
      // zod v4: 객체의 .default() 는 출력 타입(각 필드 기본 적용 후)을 요구한다 — {} 는
      // 안쪽 필드 기본값과 동일한 전체 리터럴로 명시해야 통과한다(런타임 결과는 동일).
      .default({ 우편번호: "", 주소: "", 홈페이지: "https://gepa.kr", 전화: "", 전송: "", 이메일: "" }),
    붙임: z.array(z.string()).default([]),
  });
export type OfficialMeta = z.infer<typeof OfficialMetaSchema>;

/**
 * 수신유형과 수신·수신자의 정합성 검사. 사람이 읽는 문제 목록을 돌려준다(빈 배열이면 정상).
 *
 * 이것을 zod `.superRefine()` 으로 넣지 않는 이유: superRefine 으로 감싸도 여전히 ZodObject 라
 * unwrapSchema(frontmatter.ts:116)·collectUnknownKeys 는 멀쩡히 동작한다(zod 4.6.5 실측) — 그건
 * 문제가 아니다. 진짜 이유는 **판정의 성격**이다. superRefine 은 안 맞으면 파싱 자체를 실패시키는데,
 * 이 호출처(작성기의 ctx.warnings, 검토관)는 문서를 **경고와 함께라도 만들어 내야** 한다 — 수신유형과
 * 수신·수신자가 안 맞아도 문서는 나오고, 사람이 읽는 문제 목록만 곁들인다. 스키마 파싱을 막으면
 * 그 자리에서 작성이 멈춘다.
 */
export function officialMetaProblems(m: OfficialMeta): string[] {
  const out: string[] = [];
  if (m.수신유형 === "수신자" && !m.수신?.trim()) out.push("수신유형이 '수신자'면 수신을 적어야 합니다");
  if (m.수신유형 === "수신자참조" && !m.수신자?.length) out.push("수신유형이 '수신자참조'면 수신자를 한 명 이상 적어야 합니다");
  // 내부결재는 받는 곳이 없다 — 두문 수신 칸에 "내부결재"만 찍힌다(참고 문서도 그렇다).
  // 폼은 이 상태를 만들 수 없으므로(RECIPIENT_KEY 가 내부결재에 키를 주지 않는다) 값이 있다면
  // 에이전트가 지어냈거나 DSL 을 손으로 고친 것이다. 둘 다 작성자가 듣고 싶어 하는 지적이다.
  if (m.수신유형 === "내부결재" && m.수신?.trim()) out.push("수신유형이 '내부결재'면 수신을 적지 않습니다");
  if (m.수신유형 === "내부결재" && m.수신자?.length) out.push("수신유형이 '내부결재'면 수신자를 적지 않습니다");
  return out;
}

/**
 * 주요업무보고 — 스펙 §5.3. 참고본(`※(경제진흥원) 2026년 주요업무보고`, 23쪽) 실측 기준.
 *
 * `OfficialMetaSchema` 와 같이 **맨 `z.object`** 로 둔다. `.refine`/`.superRefine` 을 걸면
 * front-matter 경로의 `unwrapSchema`(dsl/frontmatter.ts:116)가 `instanceof ZodObject` 로
 * 갈라지지 못해, 한 칸이 안 맞는 것이 복구 가능한 경고가 아니라 파싱 실패가 된다.
 */
export const ReportMetaSchema = z.object({
  제목: z.string().default("주요업무보고"),
  보고일: z.string().default(""),
  보고대상: z.string().default(""),
  부서: z.string().default(""),
  대상기간: z.string().default(""),
  목차표시: z.boolean().default(true),
});
export type ReportMeta = z.infer<typeof ReportMetaSchema>;

export const DocModelSchema = z.discriminatedUnion("family", [
  z.object({ version: z.literal(1), family: z.literal("notice"), meta: NoticeMetaSchema, blocks: z.array(BlockSchema) }),
  z.object({ version: z.literal(1), family: z.literal("plan"), meta: PlanMetaSchema, blocks: z.array(BlockSchema) }),
  z.object({ version: z.literal(1), family: z.literal("press"), meta: PressMetaSchema, blocks: z.array(BlockSchema) }),
  z.object({ version: z.literal(1), family: z.literal("official"), meta: OfficialMetaSchema, blocks: z.array(BlockSchema) }),
  z.object({ version: z.literal(1), family: z.literal("report"), meta: ReportMetaSchema, blocks: z.array(BlockSchema) }),
]);
export type DocModel = z.infer<typeof DocModelSchema>;
export type NoticeDoc = Extract<DocModel, { family: "notice" }>;
export type PlanDoc = Extract<DocModel, { family: "plan" }>;
export type PressDoc = Extract<DocModel, { family: "press" }>;
export type OfficialDoc = Extract<DocModel, { family: "official" }>;
export type ReportDoc = Extract<DocModel, { family: "report" }>;

export function inlineText(inlines: Inline[]): string {
  return inlines.map((i) => (i.t === "br" ? "\n" : i.text)).join("");
}
export function plainInlines(text: string, extra: Partial<Extract<Inline, { t: "text" }>> = {}): Inline[] {
  return [{ t: "text", text, ...extra }];
}
