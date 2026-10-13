/** Block handlers shared by all families: paragraphs, blanks, page breaks, images, generic tables. */
import { childrenNamed, findAll, type XmlNode } from "../xml";
import type { WriterContext } from "./context";
import type { Block, Cell, Inline, ParaRole, TableStyle, Row, Family } from "../../docmodel/schema";
import { inlineText } from "../../docmodel/schema";
import { leadingSpaces, noteIndentUnder, type Ladder } from "../../docmodel/indent";
import { table, cellInteriorWidth, type CellSpec, type RowSpec } from "../emit/table";
import { sumFormula, FIXED_SPACE } from "../emit/paragraph";
import { pictureFrom, pictureOf, pictureSize } from "../emit/picture";
import { imageInfo } from "../imageInfo";
import type { CharSpec, FontRole, ParaSpec, SideSpec } from "../registry";
import { TEXT_WIDTH, mmToHwp } from "../units";

type ParaBlock = Extract<Block, { k: "para" }>;
type TableBlock = Extract<Block, { k: "table" }>;
type ImageBlock = Extract<Block, { k: "image" }>;

export interface FamilyStyle {
  bodyPt: number; // 13 notice / 15 plan
  bodyLineSpacing: number; // 160 / meta
  body1Bold: boolean; // plan: □ bold
  body1Font: FontRole; // body (휴먼명조) or heading (HY헤드라인M)
  /** size of the □ line when it differs from the body (범피스: HY헤드라인M 16) */
  body1Pt?: number;
  notePt: number; // 12
  /** font role for ※ / * notes: "note" = 한양중고딕 (GEPA), "table" = 맑은 고딕 (범피스) */
  noteFont?: FontRole;
  tableHeaderFill: string; // #DFE6F7 / #D9D9D9
  tableFontPt: number; // 11
  /** heavier rules above and below the table header row (범피스 행안부 표서식: 0.5 mm) */
  tableHeaderRuleMm?: number;
  hangingIndent: boolean;
  /** which leading-space ladder to use (defaults to the document family) */
  indentFamily?: Family;
  /**
   * 표 글꼴(기본 "table" = 맑은 고딕)과 표 앵커 문단 글꼴(기본 "body" = 휴먼명조). 공문서 템플릿에는
   * 두 글꼴이 없다 — 그대로 두면 대체 글꼴 경고가 나므로 공문은 굴림을 쓴다.
   */
  tableFont?: FontRole | string;
  anchorFont?: FontRole | string;
  /** 표 모양 덮어쓰기 — 역할별 기본값 위에 얹는다(tableDefaults). 정산보고서의 참고본 표 양식 */
  tableLook?: Partial<TableDefaults>;
  /** 금액·숫자만 든 본문 칸을 오른쪽 정렬(정산보고서 참고본). 기본은 기존 규칙(짧으면 가운데) */
  numericRight?: boolean;
  /**
   * 표의 본문 칸 정렬을 열 단위로 맞춘다 — 글자는 가운데, 금액은 오른쪽, 세 줄 이상 꺾이는 긴 글이 있는
   * 열만 열 전체를 왼쪽. 머리행 없는 서식형 표는 첫 열 가운데·합친 값 칸 왼쪽. 기본 규칙(8자 이하만 가운데)은 같은 열에서
   * 가운데·왼쪽이 섞였다(정산 집행현황·사업개요 요약, 담당자 2026-10-12)
   */
  columnAlign?: boolean;
  /** "gov" = 행정업무운영 편람 2타 사다리(□0 ㅇ2 -4 ·6); default "gepa" = reference-document habit */
  ladder?: Ladder;
  /** 문단 위 간격 (HWPUNIT, 100 = 1pt) per level: □ / ㅇ / everything else (- · ※ * plain) */
  spaceBefore?: { body1: number; body2: number; other: number };
  /** ○ 항목 맨 앞의 괄호 라벨 `(사전 진단)`을 괄호째 굵게 (글머리 ○는 그대로) — user 2026-09-16 */
  boldLeadingLabel?: boolean;
  /** glyph substitutions at emit time, e.g. { "ㅇ": "○" } for the 범정부 profile */
  glyphMap?: Record<string, string>;
}

/**
 * 마지막 줄에 몇 글자만 넘쳐 흐르는 문단("…보고드립 / 니다")은 자간을 조금 줄여 한 줄을 아낀다 — 담당자들이
 * 손으로 하는 손질(공문 3630 의 "2." 줄은 자간 -6). 줄인 자간(%, 음수) 또는 0 을 돌려준다.
 * 글자 폭은 추정값이라(한글 1em·영숫자 0.5em × 장평) 넘친 양이 아주 적을 때만 손댄다.
 */
export function orphanSpacing(ctx: WriterContext, text: string, base: CharSpec, firstLineWidth: number, lineWidth = firstLineWidth): number {
  if ((base.spacing ?? 0) < 0 || text.includes("\n")) return 0;
  const ratio = (base.ratio ?? 100) / 100;
  const w = ctx.textWidth(text, base.pt) * ratio;
  if (w <= firstLineWidth) return 0;
  const lines = 1 + Math.ceil((w - firstLineWidth) / lineWidth);
  const capacity = firstLineWidth + (lines - 2) * lineWidth; // 한 줄 줄였을 때 들어갈 폭
  const over = w - capacity;
  const maxOrphan = base.pt * 100 * ratio * 3.5; // 넘친 글자가 3자 남짓일 때만
  if (over <= 0 || over > maxOrphan) return 0;
  for (const sp of [-3, -5, -7]) {
    // 자간은 글자 폭의 백분율 — 빈칸·문장부호에도 걸리므로 전체 폭에 그대로 곱한다. 추정 오차를 감안해 2 % 여유
    if (w * (1 + sp / 100) <= capacity * 0.98) return sp;
  }
  return 0;
}

/** Resolve the role → (paraPr, charPr, charSpec) for a body paragraph. */
export function bodyStyle(ctx: WriterContext, fs: FamilyStyle, b: ParaBlock): { paraPr: number; base: CharSpec; baseCharPr?: number; prefix: string } {
  const rawGlyph = b.glyph && b.glyph !== "none" ? b.glyph : undefined;
  const glyph = rawGlyph ? ((fs.glyphMap?.[rawGlyph] ?? rawGlyph) as typeof rawGlyph) : undefined;
  const indentFamily = fs.indentFamily ?? ctx.family;
  const ladder = fs.ladder ?? "gepa";
  let indent = b.indent ?? leadingSpaces(indentFamily, b.glyph, b.role, ladder);
  // house idiom / 편람: a ※ / * note that follows an item is indented under that item's text
  if (b.indent === undefined && (glyph === "※" || glyph === "*")) {
    const under = noteIndentUnder(indentFamily, ctx.prevGlyph, ladder);
    if (under !== undefined) indent = under;
  }
  if (glyph && glyph !== "※" && glyph !== "*") ctx.prevGlyph = glyph;
  const spaces = " ".repeat(indent);
  const prefix = glyph ? `${spaces}${glyph} ` : spaces;
  const align = (b.align ?? "both").toUpperCase().replace("BOTH", "JUSTIFY") as ParaSpec["align"];
  const role = b.role;
  const mapped = ctx.reg.role(role);
  let base: CharSpec;
  switch (role) {
    case "body1":
      base = { font: fs.body1Font, pt: fs.body1Pt ?? fs.bodyPt, bold: fs.body1Bold };
      break;
    case "body2":
    case "body3":
    case "body4":
    case "plain":
      base = { font: "body", pt: fs.bodyPt };
      break;
    case "note":
      base = { font: fs.noteFont ?? "note", pt: fs.notePt };
      break;
    case "footnote":
      // notice reference: 굴림 11pt; templates without 굴림 (plan) use the note font
      base = fs.noteFont ? { font: fs.noteFont, pt: fs.notePt } : ctx.reg.hasFace("굴림") ? { font: "gulim", pt: 11, spacing: -4 } : { font: "note", pt: 11 };
      break;
    case "unitCaption":
      base = { font: "table", pt: 10 };
      break;
    case "attachmentHeading":
      base = { font: "body", pt: fs.bodyPt, bold: true };
      break;
    case "annexHeading":
      base = { font: "heading", pt: 14, bold: true };
      break;
    case "coverSummary":
      base = { font: "table", pt: 13, ratio: 98 };
      break;
    case "tocLine":
      base = { font: "heading", pt: 15 };
      break;
    default:
      base = { font: "body", pt: fs.bodyPt };
  }
  // paragraph shape
  let paraPr: number;
  const useMapped = mapped && !b.align && !fs.spaceBefore && (!fs.hangingIndent || !glyph || role === "footnote");
  if (useMapped) paraPr = mapped.paraPr;
  else {
    const spec: ParaSpec = { align: align ?? "JUSTIFY", lineSpacing: role === "footnote" ? 150 : fs.bodyLineSpacing };
    if (role === "unitCaption") spec.align = "RIGHT";
    if (fs.spaceBefore) spec.prev = role === "body1" ? fs.spaceBefore.body1 : role === "body2" ? fs.spaceBefore.body2 : fs.spaceBefore.other;
    if (fs.hangingIndent && glyph && role !== "footnote") spec.hanging = ctx.textWidth(prefix, base.pt);
    paraPr = ctx.reg.paraPr(spec);
  }
  // □ 제목은 아래 내용과 같은 쪽에 둔다(담당자 2026-10-06). (단위) 줄에는 걸지 않는다 — 한글이 뒤따르는 표를
  // 통째로 다음 쪽으로 밀어 앞 쪽이 비었다
  if (role === "body1") paraPr = ctx.reg.keepWithNext(paraPr);
  const baseCharPr = mapped && !b.align ? mapped.charPr : undefined;
  // sanity: the mapped charPr must match the intended size, otherwise resolve by spec
  const info = baseCharPr !== undefined ? ctx.reg.charPrInfo(baseCharPr) : undefined;
  const ok = info && info.pt === base.pt && info.bold === !!base.bold && info.hangul === ctx.reg.faceOf(base.font);
  return { paraPr, base, baseCharPr: ok ? baseCharPr : undefined, prefix };
}

export function emitPara(ctx: WriterContext, fs: FamilyStyle, b: ParaBlock): XmlNode {
  const { paraPr, base, baseCharPr, prefix } = bodyStyle(ctx, fs, b);
  let runs;
  if (b.role === "body1" && fs.body1Font === "heading" && fs.body1Bold && prefix) {
    // file-5 idiom: "□ " in bold HY헤드라인M, the title text regular
    const glyphRun = ctx.runsFor([{ t: "text", text: prefix }], { ...base, bold: true });
    const textRuns = ctx.runsFor(b.inlines, { ...base, bold: false });
    runs = [...glyphRun, ...textRuns];
  } else {
    let body: Inline[] = b.inlines;
    if (fs.boldLeadingLabel && b.role === "body2" && body[0]?.t === "text" && !body[0].bold) {
      // "(사전 진단) 참여기업 …" → bold "(사전 진단)", regular rest
      const m = /^(\s*\([^()]{1,20}\))(?=\s|$)/.exec(body[0].text);
      // "(계    획)" 처럼 칸을 맞추려 넣은 빈칸은 고정폭 빈칸으로 — 양쪽 정렬이 보통 빈칸을 늘려 표제가 벌어진다
      if (m) body = [{ ...body[0], text: m[1].replace(/(?<=\S) +(?=\S)/g, (s) => (s.length > 1 ? FIXED_SPACE.repeat(s.length) : s)), bold: true },{ ...body[0], text: body[0].text.slice(m[1].length) }, ...body.slice(1)].filter((i) => i.t !== "text" || i.text !== "");
    }
    const inlines: Inline[] = prefix ? [{ t: "text", text: prefix }, ...body] : body;
    runs = ctx.runsFor(inlines, base, baseCharPr);
  }
  const ls = ctx.reg.paraPrInfo(paraPr)?.lineSpacing ?? fs.bodyLineSpacing;
  const node = ctx.para({ paraPr, runs, vertsize: Math.round(base.pt * 100), lineSpacing: ls, forcePageBreak: b.pageBreakBefore });
  if (b.role === "unitCaption") ctx.captionParas.add(node);
  return node;
}

export function emitBlank(ctx: WriterContext, fs: FamilyStyle, small = false): XmlNode {
  const r = ctx.roleOr("blank", { para: { align: "JUSTIFY", lineSpacing: fs.bodyLineSpacing }, char: { font: "body", pt: fs.bodyPt } });
  const pt = small ? 5 : fs.bodyPt;
  const charPr = small ? ctx.reg.charPr({ font: "body", pt }) : r.charPr;
  return ctx.para({ paraPr: r.paraPr, runs: [{ charPr, text: "" }], vertsize: pt * 100, lineSpacing: fs.bodyLineSpacing });
}

type PhotosBlock = Extract<Block, { k: "photos" }>;

/**
 * 사진 대지 — `cols` 장(기본 2)씩 한 줄, 칸마다 사진(가운데) + 아래 설명 한 줄. 표는 본문 폭, 얇은 회색 테두리.
 * 사진은 칸 안쪽 폭과 최대 높이(2장 60mm·1장 85mm·3장 45mm) 안에서 비율을 지켜 줄인다. 한 줄은 쪽에서 나뉘지 않는다.
 * 사진 파일을 읽을 수 없으면 그 칸에 "(사진 없음: 경로)" 를 쓰고 경고한다 — 조용히 빈 칸을 내지 않는다.
 */
export function emitPhotos(ctx: WriterContext, fs: FamilyStyle, b: PhotosBlock): XmlNode[] {
  const cols = Math.min(3, Math.max(1, b.cols ?? 2));
  if (!b.items.length) {
    ctx.warnings.push({ blockId: b.id, message: "사진 대지에 사진이 없습니다" });
    return [];
  }
  const colW = Math.floor(TEXT_WIDTH / cols);
  const widths = Array.from({ length: cols }, (_, i) => (i === cols - 1 ? TEXT_WIDTH - colW * (cols - 1) : colW));
  const margin = { l: 283, r: 283, t: 283, b: 141 };
  // 담당자 사진 대지(2026-10-07): 사진 줄과 설명 줄을 나눠 점선으로 가르고, 사진 높이를 한 줄에 맞춘다(2열 45mm).
  // 가로 사진은 칸을 채우도록 가운데를 잘라 쓰고(늘이지 않는다), 세로 사진은 같은 높이로 줄여 가운데 둔다.
  const picH = mmToHwp(cols === 1 ? 80 : cols === 2 ? 45 : 35);
  const capPt = 10;
  const gray = { type: "SOLID" as const, widthMm: 0.12, color: "#A6A6A6" };
  const dash = { type: "DASH" as const, widthMm: 0.12, color: "#000000" };
  const picBf = ctx.reg.borderFill({ l: gray, r: gray, t: gray, b: dash });
  const capBf = ctx.reg.borderFill({ l: gray, r: gray, t: dash, b: gray });
  const center = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 100 });
  const capPara = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 130 });
  const capChar = ctx.reg.charPr({ font: fs.tableFont ?? "table", pt: capPt });
  const capMargin = { l: 283, r: 283, t: 141, b: 141 };
  const hasCaption = b.items.some((it) => it.caption);
  const rows: RowSpec[] = [];
  for (let i = 0; i < b.items.length; i += cols) {
    const chunk = b.items.slice(i, i + cols);
    const picCells: CellSpec[] = [];
    const capCells: CellSpec[] = [];
    let capLines = 1;
    for (let c = 0; c < cols; c++) {
      const it = chunk[c];
      const interior = cellInteriorWidth(widths[c], margin);
      let para: XmlNode;
      if (!it) {
        para = ctx.cellPara({ paraPr: center, runs: [{ charPr: capChar, text: "" }], vertsize: capPt * 100, lineSpacing: 100, horzsize: interior });
      } else {
        const bin = ctx.addBinary(it.src);
        const info = bin ? imageInfo(bin.bytes) : undefined;
        if (bin && info) {
          const aspect = info.width / info.height;
          const boxAspect = interior / picH;
          let w: number, crop: { x: number; y: number; w: number; h: number } | undefined;
          if (aspect >= 1) {
            // 가로 사진 — 칸(interior × picH)을 채우고 넘치는 쪽을 가운데 기준으로 자른다
            w = interior;
            if (aspect > boxAspect) { const k = boxAspect / aspect; crop = { x: (1 - k) / 2, y: 0, w: k, h: 1 }; }
            else { const k = aspect / boxAspect; crop = { x: 0, y: (1 - k) / 2, w: 1, h: k }; }
          } else {
            w = Math.min(interior, Math.round(picH * aspect));
          }
          const pic = pictureOf(bin.id, info, { width: w, height: picH }, { id: ctx.ids.nextShapeId(), instid: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder() }, crop);
          para = ctx.cellPara({ paraPr: center, runs: [{ charPr: capChar, nodes: [pic] }], vertsize: picH, lineSpacing: 100, horzsize: interior });
        } else {
          ctx.warnings.push({ blockId: b.id, message: `사진을 읽을 수 없습니다: ${it.src}` });
          para = ctx.cellPara({ paraPr: center, runs: [{ charPr: capChar, text: `(사진 없음: ${it.src})` }], vertsize: capPt * 100, lineSpacing: 130, horzsize: interior });
        }
      }
      picCells.push({ col: c, borderFill: hasCaption ? picBf : capBf, paragraphs: [para], vertAlign: "CENTER", margin });
      const capInterior = cellInteriorWidth(widths[c], capMargin);
      const cap = it?.caption ?? "";
      if (cap) capLines = Math.max(capLines, ctx.lineCount(cap, capPt, capInterior * 1.1));
      capCells.push({ col: c, borderFill: capBf, paragraphs: [ctx.cellPara({ paraPr: capPara, runs: [{ charPr: capChar, text: cap }], vertsize: capPt * 100, lineSpacing: 130, horzsize: capInterior })], vertAlign: "CENTER", margin: capMargin });
    }
    rows.push({ height: picH + margin.t + margin.b, cells: picCells });
    if (hasCaption) rows.push({ height: capLines * capPt * 130 + capMargin.t + capMargin.b, cells: capCells });
  }
  const tblNode = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: widths,
    rows,
    borderFill: ctx.reg.borderFill({ l: "none", r: "none", t: "none", b: "none" }),
    inMargin: margin,
    outMargin: { l: 140, r: 140, t: 140, b: 140 },
    treatAsChar: true,
    repeatHeader: false,
    pageBreak: "CELL",
  });
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: fs.bodyLineSpacing }, char: { font: fs.anchorFont ?? "body", pt: fs.bodyPt } });
  const height = rows.reduce((a, r) => a + r.height, 0);
  // 사진 대지는 위 본문과 4pt 띄운다
  const paraPr = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 100, prev: 400 });
  void anchor;
  return [ctx.para({ paraPr, runs: [{ charPr: capChar, nodes: [tblNode] }], vertsize: height, lineSpacing: 100 })];
}

export function emitImage(ctx: WriterContext, fs: FamilyStyle, b: ImageBlock): XmlNode | undefined {
  const refId = b.asset === "logo" ? "image1" : b.asset === "chevron" ? "image2" : b.asset;
  const ref = ctx.tpl.pics[refId];
  if (!ref) {
    ctx.warnings.push({ blockId: b.id, message: `image asset "${b.asset}" not in template` });
    return undefined;
  }
  const width = b.widthMm ? mmToHwp(b.widthMm) : undefined;
  const pic = pictureFrom(ref, { id: ctx.ids.nextShapeId(), instid: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder() }, width);
  const { height } = pictureSize(pic);
  const r = ctx.roleOr("logoAnchor", { para: { align: b.align === "center" ? "CENTER" : "LEFT", lineSpacing: fs.bodyLineSpacing }, char: { font: "body", pt: fs.bodyPt } });
  if (b.position === "pageBottom") {
    // out-of-flow picture pinned to the bottom of the page (쪽 기준), horizontally per `align`; the anchor paragraph stays empty
    const pos = findAll(pic, "hp:pos")[0];
    if (pos) Object.assign(pos.attrs, { treatAsChar: "0", flowWithText: "0", allowOverlap: "0", vertRelTo: "PAGE", vertAlign: "BOTTOM", vertOffset: "0", horzRelTo: "PAGE", horzAlign: b.align === "center" ? "CENTER" : "LEFT", horzOffset: "0" });
    pic.attrs.textWrap = "TOP_AND_BOTTOM";
    const paraPr = ctx.reg.paraPr({ align: "LEFT", lineSpacing: 100 });
    return ctx.para({ paraPr, runs: [{ charPr: r.charPr, nodes: [pic] }], vertsize: 1000, lineSpacing: 100 });
  }
  const paraPr = b.align === "center" ? ctx.reg.paraPr({ align: "CENTER", lineSpacing: 160 }) : r.paraPr;
  return ctx.para({ paraPr, runs: [{ charPr: r.charPr, nodes: [pic] }], vertsize: height, lineSpacing: 120 });
}

// ---------------------------------------------------------------------------------------
// Generic tables

interface ResolvedCell extends Cell {
  row: number;
  col: number;
}

/** Expand a DocModel row grid into a positional grid honoring spans and `covered` cells. */
function layoutGrid(rows: Row[]): { grid: (ResolvedCell | null)[][]; colCount: number } {
  // One entry per grid column in each row: span anchors are followed by `covered` entries.
  const colCount = Math.max(...rows.map((r) => r.cells.length), 1);
  const grid: (ResolvedCell | null)[][] = rows.map(() => Array(colCount).fill(null));
  const coveredByRowSpan: boolean[][] = rows.map(() => Array(colCount).fill(false));
  rows.forEach((r, ri) => {
    r.cells.forEach((c, col) => {
      if (col >= colCount) return;
      if (c.covered || coveredByRowSpan[ri][col]) return;
      const cs = Math.max(1, Math.min(c.colSpan ?? 1, colCount - col));
      const rs = Math.max(1, Math.min(c.rowSpan ?? 1, rows.length - ri));
      grid[ri][col] = { ...c, colSpan: cs, rowSpan: rs, row: ri, col };
      for (let dr = 1; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) coveredByRowSpan[ri + dr][col + dc] = true;
    });
  });
  return { grid, colCount };
}

/** 인라인 묶음의 맨 앞 빈칸을 떼어 낸다 */
function trimLeading(g: Inline[]): Inline[] {
  const i = g.findIndex((x) => x.t !== "text" || x.text.trim() !== "");
  if (i < 0) return g;
  const first = g[i];
  return [...(first.t === "text" ? [{ ...first, text: first.text.trimStart() }] : [first]), ...g.slice(i + 1)];
}

export interface TableDefaults {
  borderColor: string;
  headerFill: string;
  totalFill: string;
  fontPt: number;
  headerFontPt: number;
  lineSpacing: number;
  padding: "tight" | "text";
  frame: "grid" | "open" | "none";
  headerTopMm: number; // heavier rule above header
  lastBottomMm: number; // heavier rule under last row
  outerSidesNone: boolean; // left col left / right col right borders NONE (frame draws them)
  headerBottomMm?: number;
}

/**
 * family 별 표 모양 덮어쓰기(`FamilyStyle.tableLook`)를 역할별 기본값 **위에** 얹는다. 표의 DSL 속성
 * (`{table header-fill=…}`)은 여전히 앞선다 — tableLook 은 그 속성이 없을 때의 집안 양식이다.
 */
export function tableDefaults(ctx: WriterContext, fs: FamilyStyle, b: TableBlock): TableDefaults {
  const d = roleTableDefaults(ctx, fs, b);
  if (!fs.tableLook) return d;
  const s: TableStyle = b.style ?? {};
  const look = { ...fs.tableLook };
  if (s.headerFill) delete look.headerFill;
  if (s.totalFill) delete look.totalFill;
  if (s.fontPt) delete look.fontPt;
  if (s.headerFontPt) delete look.headerFontPt;
  if (s.lineSpacing) delete look.lineSpacing;
  return { ...d, ...look };
}

function roleTableDefaults(ctx: WriterContext, fs: FamilyStyle, b: TableBlock): TableDefaults {
  const s: TableStyle = b.style ?? {};
  const rule = fs.tableHeaderRuleMm;
  const base: TableDefaults = {
    borderColor: s.borderColor ?? "#000000",
    headerFill: s.headerFill ?? fs.tableHeaderFill,
    totalFill: s.totalFill ?? "#D9D9D9",
    fontPt: s.fontPt ?? fs.tableFontPt,
    headerFontPt: s.headerFontPt ?? s.fontPt ?? fs.tableFontPt,
    lineSpacing: s.lineSpacing ?? 150,
    padding: s.padding ?? "text",
    frame: s.border === "none" ? "none" : "grid",
    headerTopMm: rule ?? 0.12,
    lastBottomMm: rule ?? 0.12,
    outerSidesNone: true,
    ...(rule ? { headerBottomMm: rule } : {}),
  };
  switch (b.role) {
    case "docs":
      return { ...base, headerTopMm: 0.5, lastBottomMm: 0.5, headerBottomMm: 0.1, lineSpacing: s.lineSpacing ?? 160 };
    case "support":
      return { ...base, frame: "open", headerTopMm: 0.4, lastBottomMm: 0.4, fontPt: s.fontPt ?? 10, headerFontPt: s.headerFontPt ?? 11, lineSpacing: s.lineSpacing ?? 130, padding: s.padding ?? "text" };
    case "evalCriteria":
      return { ...base, borderColor: s.borderColor ?? "#3A3C84", headerFill: s.headerFill ?? "#D9D9D9", headerTopMm: 0.4, lastBottomMm: 0.4, fontPt: s.fontPt ?? 10, lineSpacing: s.lineSpacing ?? 120 };
    case "budget":
      return { ...base, headerFill: s.headerFill ?? (ctx.family === "plan" ? "#D9D9D9" : fs.tableHeaderFill), lineSpacing: s.lineSpacing ?? 160 };
    default:
      if (s.border === "grey012") return { ...base, borderColor: "#808080" };
      return base;
  }
}

export function emitTable(ctx: WriterContext, fs: FamilyStyle, b: TableBlock): XmlNode[] {
  const out: XmlNode[] = [];
  const d = tableDefaults(ctx, fs, b);
  const { grid, colCount } = layoutGrid(b.rows);
  // column widths
  let cols: number[];
  const target = TEXT_WIDTH;
  if (b.widthsPt && b.widthsPt.length === colCount) {
    const raw = b.widthsPt.map((w) => w * 100);
    const sum = raw.reduce((a, c) => a + c, 0);
    // 표는 본문 폭을 꽉 채운다 — 좁게 남으면 (단위) 줄(오른쪽 끝)과 표 오른쪽 끝이 어긋나 보인다(담당자 2026-10-06)
    const scale = target / sum;
    cols = raw.map((w) => Math.round(w * scale));
  } else {
    cols = Array(colCount).fill(Math.floor(target / colCount));
  }
  const margin = d.padding === "tight" ? { l: 141, r: 141, t: 141, b: 141 } : { l: 510, r: 510, t: 141, b: 141 };
  // 짧은 머리글(빈칸 없는 6자 이하, 예: "연번")이 칸보다 넓으면 "연/번"으로 꺾인다 — 그 칸을 넓히고
  // 늘어난 만큼 가장 넓은 칸에서 덜어 표 전체 폭은 그대로 둔다(담당자 2026-10-06)
  const headRow = b.rows[0]?.isHeader || (b.headerRows ?? 0) > 0 ? grid[0] : undefined;
  if (headRow && colCount > 1) {
    for (let ci = 0; ci < colCount; ci++) {
      const c = headRow[ci];
      if (!c || (c.colSpan ?? 1) !== 1) continue;
      const t = inlineText(c.inlines).trim();
      if (!t || /\s/.test(t) || t.length > 6) continue;
      const need = Math.ceil(ctx.textWidth(t, d.headerFontPt) * 1.08) + margin.l + margin.r + 120;
      if (cols[ci] >= need) continue;
      const widest = cols.reduce((wi, w, i) => (i !== ci && w > cols[wi] ? i : wi), ci === 0 ? 1 : 0);
      const give = Math.min(need - cols[ci], cols[widest] - need);
      if (give > 0) {
        cols[ci] += give;
        cols[widest] -= give;
      }
    }
  }
  const width = cols.reduce((a, c) => a + c, 0);
  const headerRows = b.headerRows ?? (b.rows[0]?.isHeader ? 1 : 0);
  const lastRow = b.rows.length - 1;
  const side = (mm: number, color = d.borderColor): SideSpec => (mm <= 0 ? "none" : { type: "SOLID", widthMm: mm, color });

  // 열 단위 정렬: 세 줄 이상 꺾이는 본문 칸이 있는 열은 왼쪽, 아니면 가운데 — 칸마다 글자 수로 정하면 한 열에서
  // 가운데·왼쪽이 섞였다(결과보고서 기업명 열 "다온한옥스테이" 가운데 / "로컬상점온기(이수진)" 왼쪽, 2026-10-13)
  const longCol: boolean[] = Array(colCount).fill(false);
  {
    b.rows.forEach((row, ri) => {
      if (ri < headerRows || row.isHeader) return;
      grid[ri].forEach((c, ci) => {
        if (!c || (c.colSpan ?? 1) !== 1) return;
        const interior = cellInteriorWidth(cols[ci], margin);
        const n = splitInlinesByNewline(c.inlines).reduce((a, g) => a + ctx.wrapLines(inlineText(g), d.fontPt, interior * 1.1), 0);
        if (n >= 3) longCol[ci] = true;
      });
    });
  }
  const rowSpecs: RowSpec[] = [];
  const rowHeights: number[] = b.rows.map(() => 0);
  const cellSpecs: CellSpec[][] = b.rows.map(() => []);
  b.rows.forEach((row, ri) => {
    for (let ci = 0; ci < colCount; ci++) {
      const c = grid[ri][ci];
      if (!c) continue;
      const cs = c.colSpan ?? 1, rs = c.rowSpan ?? 1;
      const isHeader = ri < headerRows || !!row.isHeader;
      const isTotal = !!row.isTotal;
      const isLast = ri + rs - 1 === lastRow;
      const cellW = cols.slice(ci, ci + cs).reduce((a, x) => a + x, 0);
      const interior = cellInteriorWidth(cellW, margin);
      // borders
      const leftEdge = ci === 0, rightEdge = ci + cs === colCount;
      const l: SideSpec = leftEdge && d.outerSidesNone && d.frame !== "none" ? "none" : d.frame === "none" ? "none" : side(0.12);
      const r: SideSpec = rightEdge && d.outerSidesNone && d.frame !== "none" ? "none" : d.frame === "none" ? "none" : side(0.12);
      const t: SideSpec = d.frame === "none" ? "none" : ri === 0 ? side(d.headerTopMm) : ri === headerRows && headerRows > 0 && d.headerBottomMm ? side(d.headerBottomMm) : side(0.12);
      const bt: SideSpec = d.frame === "none" ? "none" : isLast ? side(d.lastBottomMm) : ri + rs === headerRows && d.headerBottomMm ? side(d.headerBottomMm) : side(0.12);
      const custom = c.borders;
      const fill = c.fill ?? (isHeader ? d.headerFill : isTotal ? d.totalFill : b.role === "evalCriteria" ? "#FFFFFF" : null);
      const bf = ctx.reg.borderFill({
        l: custom?.l ? toSide(custom.l) : l,
        r: custom?.r ? toSide(custom.r) : r,
        t: custom?.t ? toSide(custom.t) : t,
        b: custom?.b ? toSide(custom.b) : bt,
        fill,
      });
      // text
      const pt = isHeader ? d.headerFontPt : d.fontPt;
      const bold = c.bold ?? isHeader;
      const text = inlineText(c.inlines);
      // first (구분) column is always centred (user 2026-09-16); other body cells centre when short, justify when long
      const numeric = !!fs.numericRight && !isHeader && ci > 0 && /^[\s\-△+]*[\d,]+(\.\d+)?\s*$/.test(text) && /\d{1,3}(,\d{3})+|\d{4,}/.test(text);
      // 좁은 칸(안쪽 폭 200pt 미만)의 긴 글은 왼쪽 정렬 — 양쪽 정렬은 빈칸이 적은 줄을 크게 벌린다(담당자 2026-10-06)
      const longAlign: ParaSpec["align"] = interior < 20000 ? "LEFT" : "JUSTIFY";
      // 머리행 없는 서식형 표(정산 사업개요 요약): 첫 열(항목)은 가운데, 여러 칸을 합친 값 칸은 왼쪽, 나머지는 열 단위
      const formCell = !!fs.columnAlign && headerRows === 0 && ci > 0 && cs > 1;
      const alignDefault: ParaSpec["align"] = isHeader ? "CENTER" : numeric ? "RIGHT" : c.align ? (c.align.toUpperCase().replace("BOTH", "JUSTIFY") as ParaSpec["align"]) : formCell ? longAlign : b.role === "docs" ? "CENTER" : ci > 0 && cs === 1 && longCol[ci] ? longAlign : "CENTER";
      const paraPr = ctx.reg.paraPr({ align: alignDefault, lineSpacing: d.lineSpacing });
      const base: CharSpec = { font: fs.tableFont ?? "table", pt, bold };
      // paragraphs: split on '\n' (from br inlines or literal newlines)
      const paras: XmlNode[] = [];
      const groups = splitInlinesByNewline(c.inlines);
      const formula = isTotal ? columnSumFormula(grid, ri, ci, headerRows, text) : null;
      let nestedHeight = 0;
      let lines = 0;
      if (formula) {
        // 합계 cell: a FORMULA field over the column (the reference's `=SUM(?2:?6)??%g;;100`)
        paras.push(ctx.cellPara({ paraPr, runs: [{ charPr: ctx.reg.charPr(base), text: text.trim(), formula, fieldId: ctx.ids.nextShapeId() }], vertsize: pt * 100, lineSpacing: d.lineSpacing, horzsize: interior }));
        lines = 1;
      } else {
        let underCircle = false;
        for (const g of groups.length ? groups : [[{ t: "text", text: "" } as Inline]]) {
          const score = parseScoreLine(inlineText(g));
          if (score) {
            // 정량평가 배점표: `구분: 30%이상 30 / 30%미만 24 / …` becomes the reference's nested 2×N table
            if (score.lead) {
              paras.push(ctx.cellPara({ paraPr, runs: ctx.runsFor([{ t: "text", text: score.lead }], base), vertsize: pt * 100, lineSpacing: d.lineSpacing, horzsize: interior }));
              lines += ctx.lineCount(score.lead, pt, interior);
            }
            const nested = scoreTable(ctx, score.items, interior);
            const leftPara = ctx.reg.paraPr({ align: "LEFT", lineSpacing: 150 });
            const cp = ctx.reg.charPr({ ...base, spacing: -5 });
            paras.push(ctx.cellPara({ paraPr: leftPara, runs: [{ charPr: cp, text: " " }, { charPr: cp, nodes: [nested.node] }], vertsize: nested.height, lineSpacing: 100, horzsize: interior }));
            nestedHeight += nested.height + 280; // + out margins
            continue;
          }
          // a bullet line inside a cell ("∙ 항목", "· 항목", "- 항목", "○ 항목") hangs its wrapped lines under the text
          // (user 2026-09-16); the bullet prefix width at this size is the hanging indent
          const gText = inlineText(g);
          const bullet = /^(\s*[∙·•\-○ㅇ◦]\s+)/.exec(gText);
          // ◦·○·ㅇ 줄 아래의 "- " 줄은 한 단계 아래 — 빈칸 두 개 폭만큼 들여 쓴다(담당자 2026-10-12, 정산 사업개요 추진실적)
          if (bullet && /^[○ㅇ◦]/.test(bullet[1].trim())) underCircle = true;
          const sub = !!bullet && underCircle && bullet[1].trim() === "-";
          // 들여쓰기는 문단 모양이 맡는다 — 손으로 넣은 앞 빈칸(2칸·3칸 제각각)은 떼어 내 줄마다 같은 자리에서 시작하게
          const line = sub ? trimLeading(g) : g;
          const prefix = sub ? bullet[1].trimStart() : bullet?.[1] ?? "";
          const cellParaPr = bullet && !isHeader ? ctx.reg.paraPr({ align: alignDefault === "CENTER" ? "LEFT" : alignDefault, lineSpacing: d.lineSpacing, hanging: ctx.textWidth(prefix, pt), ...(sub ? { left: ctx.textWidth("  ", pt) } : {}) }) : paraPr;
          paras.push(ctx.cellPara({ paraPr: cellParaPr, runs: ctx.runsFor(line, base), vertsize: pt * 100, lineSpacing: d.lineSpacing, horzsize: interior }));
          // 글자 폭 추정(한글 1em)은 굴림·맑은 고딕의 실제 폭보다 넓다 — 넉넉히 잡으면 한 줄 칸이 두 줄 높이로 잡혀 표가
          // 길어진다(정산 집행현황 "사업비(민간사업지원금)"). 한글은 넘치는 칸의 행을 스스로 늘리므로 10 % 여유를 준다.
          // 줄은 어절 단위로 센다 — 글자 폭 합으로 세면 4줄로 꺾이는 칸을 3줄로 잡아 끝줄이 잘렸다(결과보고서 2026-10-12)
          lines += ctx.wrapLines(gText, pt, interior * 1.1);
        }
      }
      const h = Math.round(Math.max(lines, nestedHeight ? 0 : 1) * pt * 100 * (d.lineSpacing / 100)) + nestedHeight + margin.t + margin.b + 300;
      if (rs === 1) rowHeights[ri] = Math.max(rowHeights[ri], row.heightPt ? row.heightPt * 100 : h);
      cellSpecs[ri].push({ col: ci, colSpan: cs, rowSpan: rs, borderFill: bf, paragraphs: paras, vertAlign: c.valign === "top" ? "TOP" : c.valign === "bottom" ? "BOTTOM" : "CENTER", margin, header: isHeader });
    }
  });
  const minH = Math.round(d.fontPt * 100 * (d.lineSpacing / 100)) + margin.t + margin.b + 300;
  b.rows.forEach((row, ri) => rowSpecs.push({ height: Math.max(rowHeights[ri], row.heightPt ? row.heightPt * 100 : minH), cells: cellSpecs[ri] }));

  const splittable = b.rows.length >= 15 && b.role !== "support";
  const frameBf = d.frame === "grid" ? ctx.reg.borderFill({ l: side(0.12), r: side(0.12), t: side(0.12), b: side(0.12) }) : ctx.reg.borderFill({ l: "none", r: "none", t: "none", b: "none" });
  const tblNode = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols,
    rows: rowSpecs,
    borderFill: frameBf,
    inMargin: margin,
    // 나뉘는 표는 본문 흐름 밖에 놓이므로 아래 여백을 넉넉히(약 3mm) — 바로 다음 제목이 표에 붙어 보였다
    outMargin: { l: 140, r: 140, t: 140, b: splittable ? 850 : 140 },
    // 긴 표(15행 이상)는 글자처럼 취급하지 않는다 — 글자처럼 취급한 표는 쪽을 나눌 수 없어 통째로 다음 쪽으로
    // 넘어가고 앞 쪽이 절반씩 비었다(담당자 2026-10-06). 셀 단위로 나뉘고 머리행은 반복된다.
    treatAsChar: !splittable,
    ...(splittable ? { horzRelTo: "COLUMN" as const } : {}),
    repeatHeader: true,
    noAdjust: b.role === "support",
    // 나뉘는 표는 행 단위로만 나눈다(TABLE) — CELL 은 칸 속 글까지 두 쪽으로 쪼갰다("향토뿌리기업 및 산업유산 / 체험 프로그램 운영")
    pageBreak: b.role === "support" || splittable ? "TABLE" : "CELL",
  });
  if (b.caption) {
    const r = ctx.roleOr("unitCaption", { para: { align: "RIGHT", lineSpacing: 150 }, char: { font: fs.tableFont ?? "table", pt: 10 } });
    const cap = ctx.para({ paraPr: r.paraPr, runs: [{ charPr: r.charPr, text: b.caption }], vertsize: 1000, lineSpacing: 150 });
    ctx.captionParas.add(cap);
    out.push(cap);
  }
  const anchor = ctx.roleOr("tableAnchor", { para: { align: "JUSTIFY", lineSpacing: fs.bodyLineSpacing }, char: { font: fs.anchorFont ?? "body", pt: fs.bodyPt } });
  const height = rowSpecs.reduce((a, r) => a + r.height, 0);
  const anchorPara = ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tblNode] }], vertsize: height, lineSpacing: 100 });
  if (!splittable) ctx.inlineTableAnchors.add(anchorPara);
  else ctx.splitTableAnchors.add(anchorPara);
  out.push(anchorPara);
  void width;
  return out;
}

/**
 * "(단위: 원)" 줄 바로 뒤에 쪽에서 나뉘는 표가 오면 (단위) 줄에 다음 문단과 함께(keepWithNext)를 건다.
 * 나뉘지 않는 표와는 예전에 한 문단(단위 줄 ↵ 표)으로 묶었으나 단위 줄이 표 아래로 가서 그만두었다(아래 본문).
 */
export function mergeCaptionTables(ctx: WriterContext, nodes: XmlNode[]): XmlNode[] {
  const out: XmlNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const cap = nodes[i], next = nodes[i + 1];
    // 나뉘는 표(글자처럼 취급하지 않음)는 한 문단으로 묶을 수 없다 — (단위) 줄만 다음 문단과 함께로 붙인다
    // 안 나뉘는 표 앞도 같다 — 한글은 다음 문단과 함께를 지키므로 걸지 않으면 (단위) 줄만 쪽 끝에 남았다(한글 결과보고서 3·4쪽, 2026-10-13)
    if (next && ctx.captionParas.has(cap) && (ctx.splitTableAnchors.has(next) || ctx.inlineTableAnchors.has(next))) {
      cap.attrs.paraPrIDRef = String(ctx.reg.keepWithNext(Number(cap.attrs.paraPrIDRef)));
      out.push(cap);
      continue;
    }
    // 쪽에서 나뉘지 않는 표는 묶지 않는다 — (단위) 줄 ↵ 표 를 한 문단에 넣었더니 렌더에서 단위 줄이 표 **아래**에
    // 그려지고 그 문단 높이가 부풀어 뒤 내용이 쪽 아래로 밀렸다(공문 붙임이 발신명의와 겹침, 결과보고서 쪽 번호 겹침;
    // 담당자 2026-10-12). (단위) 줄은 표 위 별도 문단으로 둔다.
    out.push(cap);
  }
  return out;
}

export interface ScoreLine {
  /** text kept as its own line before the table (e.g. `1. 매출액 대비 수출액 비율(25년 기준)`); absent for a bare `구분:` line */
  lead?: string;
  items: Array<[string, string]>;
}

function parseScoreItems(src: string, min: number): Array<[string, string]> | null {
  const items = src.split(/\s*\/\s*/).filter(Boolean);
  if (items.length < min) return null;
  const out: Array<[string, string]> = [];
  for (const it of items) {
    const mm = /^(.*\S)\s+(\d+(?:\.\d+)?)$/.exec(it.trim());
    if (!mm) return null;
    out.push([mm[1], mm[2]]);
  }
  return out;
}

/**
 * A 배점 range line becomes the reference's nested 2×N score table:
 *   `구분: 30%이상 30 / 30%미만 24 / …`              (the 6-1 transcription)
 *   `1. 매출액 대비 수출액 비율: 30% 이상 30 / …`     (lead text + ranges, as writers tend to put it)
 *   `200% 이상 20 / 200% 미만 16 / 100% 미만 12 / …`  (bare ranges, ≥ 3 items)
 * Every item must end with a number; anything else stays ordinary text.
 */
export function parseScoreLine(text: string): ScoreLine | null {
  const t = text.trim();
  const colon = /^(.*?)\s*[:：]\s*(.+)$/.exec(t);
  if (colon) {
    const items = parseScoreItems(colon[2], 2);
    if (items) {
      const lead = colon[1].trim();
      return lead && lead !== "구분" ? { lead, items } : { items };
    }
  }
  const bare = parseScoreItems(t, 3);
  return bare ? { items: bare } : null;
}

/**
 * Nested 배점표 exactly as in the 6-1 reference: 2 rows × (1 + N) columns, label column 4256
 * and 5785 per score column (scaled down when the cell interior is narrower), header row
 * 1665 / score row 2231 HWPUNIT, #D9D9D9 header, 0.25 mm black outer edges, 0.12 mm #CCCCCC
 * inner rules, 맑은 고딕 10 pt centred (paraPr CENTER 160% hanging 1448).
 */
function scoreTable(ctx: WriterContext, items: Array<[string, string]>, interior: number): { node: XmlNode; height: number } {
  const n = items.length;
  let cols = [4256, ...items.map(() => 5785)];
  const total = cols.reduce((a, c) => a + c, 0);
  const avail = interior - 280; // out margins 140 + 140
  if (total > avail) cols = cols.map((c) => Math.floor((c * avail) / total));
  const margin = { l: 510, r: 510, t: 141, b: 141 };
  // reference heights (1665 / 2231) grow when a label wraps inside its 5785-wide column
  const rowsText = [
    ["구분", ...items.map((i) => i[0])],
    ["배점", ...items.map((i) => i[1])],
  ];
  const rowH = rowsText.map((texts, ri) => {
    // narrow columns: measure conservatively (the width estimate is approximate and a label that
    // wraps grows the nested table, which the outer row height must already include)
    const wrapped = Math.max(...texts.map((t, ci) => ctx.lineCount(t, 10, Math.floor(cellInteriorWidth(cols[ci], margin) * 0.8))));
    return Math.max(ri === 0 ? 1665 : 2231, wrapped * 1600 + margin.t + margin.b + 100);
  });
  const heavy: SideSpec = { type: "SOLID", widthMm: 0.25, color: "#000000" };
  const light: SideSpec = { type: "SOLID", widthMm: 0.12, color: "#CCCCCC" };
  const paraPr = ctx.reg.paraPr({ align: "CENTER", lineSpacing: 160, hanging: 1448 });
  const charPr = ctx.reg.charPr({ font: "table", pt: 10 });
  const rows: RowSpec[] = rowsText.map((texts, ri) => ({
    height: rowH[ri],
    cells: texts.map((t, ci) => {
      const bf = ctx.reg.borderFill({
        l: ci === 0 ? heavy : light,
        r: ci === texts.length - 1 ? heavy : light,
        t: ri === 0 ? heavy : light,
        b: ri === 1 ? heavy : light,
        fill: ri === 0 ? "#D9D9D9" : null,
      });
      const w = cellInteriorWidth(cols[ci], margin);
      return { col: ci, borderFill: bf, paragraphs: [ctx.cellPara({ paraPr, runs: [{ charPr, text: t }], vertsize: 1000, lineSpacing: 160, horzsize: w })], vertAlign: "CENTER" as const, margin };
    }),
  }));
  const node = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols,
    rows,
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: margin,
    outMargin: { l: 140, r: 140, t: 140, b: 140 },
    treatAsChar: true,
    repeatHeader: true,
    pageBreak: "CELL",
  });
  void n;
  return { node, height: rowH[0] + rowH[1] };
}

const NUMERIC_CELL = /^\s*[+-]?\d{1,3}(,\d{3})*(\.\d+)?\s*$|^\s*[+-]?\d+(\.\d+)?\s*$/;

function cellNumber(c: ResolvedCell | null): number | null {
  if (!c) return 0; // covered position: the anchor above already counted it
  const t = inlineText(c.inlines);
  if (!NUMERIC_CELL.test(t)) return null;
  return Number(t.replace(/,/g, "").trim());
}

/**
 * A total row's numeric cell gets a FORMULA field summing the data rows of its column
 * (`=SUM(?from:?to)`, rows 1-based) — only when the displayed value really is that sum,
 * so the field can never contradict the visible number.
 */
export function columnSumFormula(grid: (ResolvedCell | null)[][], totalRow: number, col: number, headerRows: number, shown: string): string | null {
  if (!NUMERIC_CELL.test(shown)) return null;
  const from = headerRows, to = totalRow - 1;
  if (to < from) return null;
  let sum = 0;
  for (let r = from; r <= to; r++) {
    const n = cellNumber(grid[r]?.[col] ?? null);
    if (n === null) return null;
    sum += n;
  }
  const value = Number(shown.replace(/,/g, "").trim());
  if (Math.abs(sum - value) > 1e-9) return null;
  return sumFormula(from + 1, to + 1, shown.trim());
}

function toSide(s: { type?: string; widthMm?: number; color?: string }): SideSpec {
  if (s.type === "none") return "none";
  const type = s.type === "dash" ? "DASH" : s.type === "dot" ? "DOT" : s.type === "double" ? "DOUBLE_SLIM" : "SOLID";
  return { type, widthMm: s.widthMm ?? 0.12, color: s.color ?? "#000000" };
}

export function splitInlinesByNewline(inlines: Inline[]): Inline[][] {
  const groups: Inline[][] = [[]];
  for (const inl of inlines) {
    if (inl.t === "br") {
      groups.push([]);
      continue;
    }
    if (inl.t === "text" && inl.text.includes("\n")) {
      const parts = inl.text.split("\n");
      parts.forEach((p, i) => {
        if (i > 0) groups.push([]);
        if (p) groups[groups.length - 1].push({ ...inl, text: p });
      });
      continue;
    }
    groups[groups.length - 1].push(inl);
  }
  return groups.filter((g, i) => g.length > 0 || i < groups.length);
}

export function roleForGlyphless(role: ParaRole): ParaRole {
  return role;
}
