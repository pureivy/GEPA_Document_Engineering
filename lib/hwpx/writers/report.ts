/**
 * 주요업무보고 작성기 — 표지·간지·본문 사다리·빈 쪽.
 *
 * 다른 작성기와 갈라지는 점 하나: **문단 모양을 합성하지 않고 참고본의 id 를 그대로 쓴다.**
 * 참고본의 본문 문단은 왼쪽 여백 0 에 음수 `intent`(내어쓰기)만 걸려 있고, 단계 들여쓰기는
 * 글자로 넣은 반각 공백이다(`templates/report/reference.hwpx` 실측). 그래서 style-map 의
 * paraPr 를 그대로 쓰면서 `leadingSpaces()` 로 공백을 앞에 붙이면 참고본과 같은 줄이 나온다 —
 * `emitPara`(common.ts)처럼 align·lineSpacing·hanging 으로 새 paraPr 를 합성하면 참고본이
 * 손으로 맞춰 둔 내어쓰기 폭(단계마다 다르다)이 사라진다.
 *
 * 쪽번호는 여기서 내지 않는다. `templates/report/pkg` 의 첫 문단이 이미
 * `<hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/>` 를 들고 있고,
 * build.ts:65 가 구역에 pageNum 이 없을 때 그것을 첫 문단에 꽂는다(plan·press·official 과 같다).
 *
 * 이 과제에서 내지 않는 것: 조직도·목차(Task 5).
 */
import { clone, findAll, type XmlNode } from "../xml";
import { cloneFragment, loadGeometry, setCellText } from "../geometry";
import { pictureFrom, pictureSize } from "../emit/picture";
import { table, cellInteriorWidth, type CellSpec } from "../emit/table";
import { emitBlank, emitTable, splitInlinesByNewline, type FamilyStyle } from "./common";
import { leadingSpaces } from "../../docmodel/indent";
import { inlineText, type Block, type Glyph, type Inline, type ParaRole, type ReportDoc, type ReportMeta } from "../../docmodel/schema";
import type { CharSpec, ParaSpec } from "../registry";
import { WriterContext } from "./context";

type ParaBlock = Extract<Block, { k: "para" }>;

/** 참고본 본문 기준값 — style-map 역할이 빠졌을 때만 쓰인다. */
const BODY_PT = 15;
const BODY_LINE_SPACING = 160;

/**
 * 표에 쓰는 기본값. 참고본 예산표(`geometry/t11.xml`)의 머리글 칸이 `#E5E5E5` 다.
 * paraPr/charPr 은 `emitTable` 이 표 안에서 따로 합성하므로 여기 값은 크기만 정한다.
 */
const REPORT_TABLE_STYLE: FamilyStyle = {
  bodyPt: BODY_PT,
  bodyLineSpacing: BODY_LINE_SPACING,
  body1Bold: false,
  body1Font: "body",
  notePt: 12,
  tableHeaderFill: "#E5E5E5",
  tableFontPt: 11,
  hangingIndent: true,
};

/**
 * 역할별 대비값. style-map 이 맺어 준 id 가 언제나 앞서고, 여기 값은 그 id 가 없을 때만 쓴다.
 * 참고본에 깨끗한 짝이 없는 역할(`note`·`coverSpacer`·`coverMeta`)은 일부러 style-map 에
 * 넣지 않고 여기 상수로 둔다 — 어림짐작한 paraPr 는 나중에 찾기가 훨씬 어렵다.
 *
 * `hanging` 은 참고본 `intent` 의 절반이다(registry.ts:206 이 `intent = 2 × -hanging`).
 */
const FALLBACK: Record<string, { para: ParaSpec; char: CharSpec }> = {
  coverTitle: { para: { align: "CENTER", lineSpacing: 130, prev: 500 }, char: { font: "heading", pt: 45, color: "#000094" } },
  coverMeta: { para: { align: "CENTER", lineSpacing: 160 }, char: { font: "heading", pt: 17 } },
  coverSpacer: { para: { align: "CENTER", lineSpacing: 160 }, char: { font: "HY견고딕", pt: 15, spacing: -5, ratio: 98 } },
  chapterBand: { para: { align: "CENTER", lineSpacing: 90, prev: 1000 }, char: { font: "HY견고딕", pt: 30, bold: true, ratio: 95 } },
  chipTitle: { para: { align: "JUSTIFY", lineSpacing: 130, hanging: 1816, prev: 500 }, char: { font: "heading", pt: 17 } },
  chipLabel: { para: { align: "CENTER", lineSpacing: 130, hanging: 1816, prev: 500 }, char: { font: "heading", pt: 15, color: "#FFFFFF" } },
  tocLine: { para: { align: "JUSTIFY", lineSpacing: 200, left: 2000, right: 2500, prev: 500 }, char: { font: "body", pt: 14, ratio: 95 } },
  summary: { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "table", pt: 15, spacing: -2, ratio: 95 } },
  subHeading: { para: { align: "JUSTIFY", lineSpacing: 160, hanging: 2020, next: 150 }, char: { font: "HY견고딕", pt: 15 } },
  listItem: { para: { align: "JUSTIFY", lineSpacing: 180 }, char: { font: "body", pt: 13 } },
  bullet1: { para: { align: "JUSTIFY", lineSpacing: 160, hanging: 1357, next: 150 }, char: { font: "body", pt: 15, bold: true, spacing: -5, ratio: 95 } },
  // 글머리 기호 한 글자만 쓰는 역할 — paraPr 은 bullet1 과 같은 것을 적어 두되 쓰지 않는다
  // (RoleMap 이 언제나 짝을 요구한다. lib/hwpx/template.ts:RoleMap).
  bullet1Mark: { para: { align: "JUSTIFY", lineSpacing: 160, hanging: 1357, next: 150 }, char: { font: "body", pt: 14, spacing: -9, ratio: 98 } },
  bullet2: { para: { align: "JUSTIFY", lineSpacing: 160, hanging: 1632, next: 150 }, char: { font: "body", pt: 15, spacing: -5, ratio: 95 } },
  note: { para: { align: "JUSTIFY", lineSpacing: 160 }, char: { font: "note", pt: 12 } },
  tableAnchor: { para: { align: "JUSTIFY", lineSpacing: 180 }, char: { font: "heading", pt: 14, ratio: 98 } },
};

interface RoleSpec {
  paraPr: number;
  charPr: number;
  base: CharSpec;
  lineSpacing: number;
}

/**
 * 역할 → (paraPr, charPr, 글자 기준값). 굵게·색 같은 인라인 변형은 **맺어진 charPr 의 실제
 * 글꼴**에서 파생해야 한다(official.ts:roleSpec 과 같은 이유) — 대비값의 글꼴로 파생하면
 * 굵은 조각만 다른 글꼴로 튄다.
 */
function roleSpec(ctx: WriterContext, name: string): RoleSpec {
  const fb = FALLBACK[name] ?? FALLBACK.summary;
  const r = ctx.roleOr(name, fb);
  const c = ctx.reg.charPrInfo(r.charPr);
  const base: CharSpec = c ? { font: c.hangul, pt: c.pt, bold: c.bold, color: c.color, spacing: c.spacing, ratio: c.ratio } : fb.char;
  return { ...r, base, lineSpacing: ctx.reg.paraPrInfo(r.paraPr)?.lineSpacing ?? fb.para.lineSpacing ?? BODY_LINE_SPACING };
}

/**
 * 사다리 한 칸 → style-map 역할.
 *
 * **소제목(`subHeading`)은 `□` 가 가리킨다.** 참고본의 소제목 줄에는 글자 표지가 아예 없고 —
 * 인라인 `hp:container` 도형 칩이 표지 노릇을 한다 — 그래서 DSL 쪽에 기호 하나를 골라 줘야
 * 했다. `□` 를 고른 까닭은 세 가지다: 과제 개요가 `ㅇ` 를 `listItem` 으로 못 박았고(참고본의
 * 일반현황 평평한 목록 열한 번이 그 쓰임이다), `●`·`-`·`·` 는 아래 칸이 이미 쓰고 있으며,
 * `□` 는 다른 네 family 에서 첫째 칸 기호라 작성자·에이전트가 손에 익은 글자인데 여기서는
 * 아무 데도 맺혀 있지 않아 조용히 요약문으로 떨어지고 있었다(Task 3 이 남긴 흠).
 * `□` 로 쓴 줄은 기호를 **글자로 내지 않는다** — 도형 칩이 그 자리를 대신한다.
 *
 * `ㅇ` 는 참고본에서 일반현황의 평평한 목록(`ㅇ 1997년 …`, `ㅇ 조  직: 1본부 3실 …`)이다.
 * 열한 번 모두 그 쓰임이라 `listItem` 에 맺었다.
 */
function ladderRole(role: ParaRole, glyph: Glyph | undefined): string {
  if (role === "tocLine") return "tocLine";
  switch (glyph) {
    case "□":
      return "subHeading";
    case "ㅇ":
    case "○":
    case "◦":
    case "❍":
      return "listItem";
    case "●":
      return "bullet1";
    case "-":
    case "·":
    case "∙":
    case "▪":
      return "bullet2";
    case "※":
    case "*":
      return "note";
    default:
      return "summary";
  }
}

export function writeReport(ctx: WriterContext, doc: ReportDoc): XmlNode[] {
  // 표지 제목은 meta.제목 에서 나온다. 편집기가 `coverTitle` 블록을 넣었으면(fromPm.ts:155)
  // 그 글이 앞선다 — 본문 자리에 따로 내면 표지와 2쪽에 제목이 두 번 나온다
  // (공문서의 firstBodyBlock 과 같은 손질이다).
  const titleBlock = doc.blocks.find((b) => b.k === "coverTitle") as Extract<Block, { k: "coverTitle" }> | undefined;
  const out: XmlNode[] = [...cover(ctx, doc.meta, titleBlock?.inlines)];
  // 표지 다음 블록은 새 쪽에서 시작한다 — 참고본도 표지 뒤가 쪽 나눔이다(para 19).
  ctx.pendingPageBreak = true;

  for (const b of doc.blocks) {
    if (b === titleBlock) continue;
    switch (b.k) {
      case "coverTitle":
        ctx.warnings.push({ blockId: b.id, message: "표지 제목이 둘 이상입니다 — 첫 번째만 씁니다" });
        break;
      case "chapterBand":
        out.push(chapterBand(ctx, b.numeral, b.title));
        break;
      case "sectionChip":
        out.push(sectionChip(ctx, b.label, b.title));
        break;
      case "summaryBox":
        out.push(...summaryBox(ctx, b));
        break;
      case "para":
        out.push(ladderPara(ctx, b));
        break;
      case "blank":
        out.push(emitBlank(ctx, REPORT_TABLE_STYLE, b.role === "blankSmall"));
        break;
      case "pageBreak":
        ctx.pendingPageBreak = true;
        break;
      case "table":
        out.push(...emitTable(ctx, REPORT_TABLE_STYLE, b));
        break;
      default:
        ctx.warnings.push({ blockId: b.id, message: `block kind "${b.k}" is not supported in 주요업무보고; skipped` });
    }
  }
  return out;
}

// ---- 표지 ---------------------------------------------------------------------------------

/**
 * 표지 = 도 로고 표(`geometry/t00.xml`) → 빈 줄 → 제목 → 빈 줄 → 보고일·부서 → 기관 로고 그림.
 *
 * 참고본의 제목은 남색 `hp:rect` 안의 글이다(그러데이션 상자). **그 상자는 아직 뜨지 않았다** —
 * Task 4 의 파일 목록에도 단계에도 없어서 후속 과제로 남긴다(소제목 칩과 같은 종류의 일이고,
 * `subHeadingChip` 이 길을 터 두었다). 여기서는 같은 문단 모양(paraPr 45 / charPr 47 =
 * HY헤드라인M 45pt #000094)으로 가운데 정렬 문단 하나를 낸다.
 *
 * 표지 문단이 문서의 첫 문단이므로 build.ts 가 여기에 secPr 와 쪽번호 컨트롤을 꽂는다.
 */
function cover(ctx: WriterContext, m: ReportMeta, title?: Inline[]): XmlNode[] {
  const out: XmlNode[] = [];
  const logo = loadGeometry(ctx.tpl.dir, "t00");
  if (logo) out.push(cloneFragment(logo, ctx.ids));
  else ctx.warnings.push({ message: "report template geometry t00 missing; 표지 로고 표를 생략했습니다" });

  for (let i = 0; i < 3; i++) out.push(coverSpacer(ctx));
  out.push(coverTitlePara(ctx, title ?? [{ t: "text", text: m.제목 }]));
  for (let i = 0; i < 6; i++) out.push(coverSpacer(ctx));

  // 참고본 표지에는 제목 말고 글이 없다. `보고일`·`부서` 는 비어 있을 때가 많고 비면 줄도 내지
  // 않는다. `보고대상`·`대상기간` 은 표지에 쓰지 않는다 — 목차·간지(Task 5)와 에이전트
  // 프롬프트(Task 6)가 쓰는 값이고, 표지에 넣으면 참고본에 없는 줄이 는다.
  if (m.보고일.trim()) out.push(coverLine(ctx, m.보고일.trim()));
  if (m.부서.trim()) out.push(coverLine(ctx, m.부서.trim()));
  for (let i = 0; i < 3; i++) out.push(coverSpacer(ctx));

  // 참고본 표지 아래쪽 기관 로고(para 18, binaryItemIDRef=image2)
  const ref = ctx.tpl.pics["image2"];
  if (ref) {
    const s = roleSpec(ctx, "coverSpacer");
    const pic = pictureFrom(ref, { id: ctx.ids.nextShapeId(), instid: ctx.ids.nextShapeId(), zOrder: ctx.ids.nextZOrder() });
    out.push(ctx.para({ paraPr: s.paraPr, runs: [{ charPr: s.charPr, nodes: [pic] }], vertsize: pictureSize(pic).height, lineSpacing: 160 }));
  }
  return out;
}

function coverTitlePara(ctx: WriterContext, inlines: Inline[]): XmlNode {
  const s = roleSpec(ctx, "coverTitle");
  return ctx.para({ paraPr: s.paraPr, runs: ctx.runsFor(inlines, s.base, s.charPr), vertsize: Math.round(s.base.pt * 100), lineSpacing: s.lineSpacing });
}

function coverLine(ctx: WriterContext, text: string): XmlNode {
  const s = roleSpec(ctx, "coverMeta");
  return ctx.para({ paraPr: s.paraPr, runs: [{ charPr: s.charPr, text }], vertsize: Math.round(s.base.pt * 100), lineSpacing: s.lineSpacing });
}

function coverSpacer(ctx: WriterContext): XmlNode {
  const s = roleSpec(ctx, "coverSpacer");
  return ctx.para({ paraPr: s.paraPr, runs: [{ charPr: s.charPr, text: "" }], vertsize: Math.round(s.base.pt * 100), lineSpacing: s.lineSpacing });
}

// ---- 간지 ---------------------------------------------------------------------------------

/**
 * 장 간지 — 참고본 `geometry/t03.xml`(1×4 표: 제목 칸 + 색 띠 세 칸)을 복제하고 글만 바꾼다.
 * 띠 세 칸의 borderFill(70·71·72)은 조각에 딸려 오므로 여기서 건드리지 않는다.
 *
 * 복제 조각은 `ctx.para` 를 거치지 않아 쪽 나눔 플래그를 스스로 먹지 않는다 —
 * plan.ts 의 표지 조각과 같은 방식으로 직접 옮겨 준다. 이걸 빠뜨리면 `pageBreak` 앞에 둔
 * 간지가 앞 쪽에 붙고, `pageBreak → blank → pageBreak` 로 만든 빈 쪽도 함께 무너진다.
 */
function chapterBand(ctx: WriterContext, numeral: string, title: string): XmlNode {
  const text = `${numeral}. ${title}`;
  const ref = loadGeometry(ctx.tpl.dir, "t03");
  if (!ref) {
    ctx.warnings.push({ message: "report template geometry t03 missing; 간지를 맨 문단으로 냈습니다" });
    const s = roleSpec(ctx, "chapterBand");
    return ctx.para({ paraPr: s.paraPr, runs: [{ charPr: s.charPr, text }], vertsize: Math.round(s.base.pt * 100), lineSpacing: s.lineSpacing });
  }
  const frag = cloneFragment(ref, ctx.ids);
  setCellText(frag, 0, 0, text);
  if (ctx.pendingPageBreak) frag.attrs.pageBreak = "1";
  ctx.pendingPageBreak = false;
  return frag;
}

// ---- 번호+제목 칩 · 요약박스 ---------------------------------------------------------------

/**
 * 칸 너비·높이·여백은 참고본 `geometry/t31`(= `t34`·`t36` 과 같은 모양)의 실측값이다.
 * 색은 참고본 borderFill 53(번호 칸)·52(제목 칸)·4(표 테두리)를 그대로 되뇐다 —
 * `StyleRegistry.borderFill` 이 서명으로 헤더를 먼저 뒤지므로(registry.ts:265) 같은 값을
 * 달라고 하면 새 id 를 붙이지 않고 참고본의 id 를 돌려준다. 다만 **돌아오는 id 가 늘 그
 * 번호는 아니다**: 52 는 헤더에 한 글자도 다르지 않은 쌍둥이 29 가 앞서 있어 29 가 온다.
 * 그래서 테스트는 id 가 아니라 보이는 색과 "새 borderFill 이 붙지 않았다"를 못 박는다.
 */
const CHIP_COLS = [3719, 43905];
const CHIP_HEIGHT = 2980;
const CHIP_MARGIN = { l: 510, r: 510, t: 141, b: 141 };
const CHIP_LABEL_FILL = "#000D59";
const CHIP_TITLE_FILL = "#ECF2FA";

/**
 * 번호+제목 칩 — 1×2 표(번호 칸 + 제목 칸).
 *
 * `plan.ts:334 numberedChip` 과 같은 얼개지만 칸 너비(`[3719, 43905]` vs `[2600, 45300]`)도
 * 색도 여백도 다르다. 사업계획서 출력이 바이트 단위로 얼어붙어 있으므로(계획 §전역 제약)
 * 그쪽을 건드리지 않고 여기에 report 값을 받는 변형을 둔다. 값이 겹치는 곳이 없어 공통
 * 부분을 빼내 봐야 인자 목록만 길어진다.
 */
function sectionChip(ctx: WriterContext, label: string, title: string): XmlNode {
  const lab = roleSpec(ctx, "chipLabel");
  const tit = roleSpec(ctx, "chipTitle");
  const bfLabel = ctx.reg.borderFill({ l: "none", r: "none", t: "none", b: "none", fill: CHIP_LABEL_FILL });
  const bfTitle = ctx.reg.borderFill({ l: "none", r: "none", t: "none", b: "none", fill: CHIP_TITLE_FILL });
  const cell = (col: number, spec: RoleSpec, text: string, bf: number): CellSpec => ({
    col,
    borderFill: bf,
    margin: CHIP_MARGIN,
    vertAlign: "TOP",
    paragraphs: [ctx.cellPara({ paraPr: spec.paraPr, runs: [{ charPr: spec.charPr, text }], vertsize: Math.round(spec.base.pt * 100), lineSpacing: spec.lineSpacing, horzsize: cellInteriorWidth(CHIP_COLS[col], CHIP_MARGIN) })],
  });
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: CHIP_COLS,
    // 참고본 제목 칸은 반각 공백 하나로 번호 칸에서 떨어져 있다(`<hp:t> K-AI 경북형 …`).
    rows: [{ height: CHIP_HEIGHT, cells: [cell(0, lab, label, bfLabel), cell(1, tit, ` ${title}`, bfTitle)] }],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: CHIP_MARGIN,
    outMargin: { l: 141, r: 141, t: 141, b: 141 },
  });
  const anchor = roleSpec(ctx, "tableAnchor");
  return ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: CHIP_HEIGHT, lineSpacing: 100 });
}

const BOX_WIDTH = 47905;
const BOX_MARGIN = { l: 510, r: 510, t: 141, b: 141 };
const BOX_FILL = "#F2F2F2";
const BOX_LINE_HEIGHT = 2400;
/**
 * 두 줄짜리 요약문의 참고본 높이. 참고본은 **같은 두 줄에 5217 과 5733 을 둘 다** 쓴다
 * (`t35`·`t37` 대 `t30`·`t32` — 손으로 끌어 맞춘 자국이다). 글자에서 셈한 높이
 * (여백 282 + 줄당 2400 × 2 = 5082)는 둘 다보다 낮으므로, 둘 중 **낮은 쪽을 바닥**으로 삼고
 * 줄이 늘면 셈한 값이 이긴다. 한글은 표 높이를 다시 흘리므로 이 값은 첫 배치용이다.
 */
const BOX_MIN_HEIGHT = 5217;

/**
 * 요약박스 — 절 제목 바로 밑의 1×1 회색 점선 상자(참고본 `geometry/t32` 계열).
 * 칸 색은 borderFill 9(점선 네 변 + `#F2F2F2`), 표 테두리는 4 다.
 */
function summaryBox(ctx: WriterContext, b: Extract<Block, { k: "summaryBox" }>): XmlNode[] {
  const s = roleSpec(ctx, "summary");
  const interior = cellInteriorWidth(BOX_WIDTH, BOX_MARGIN);
  // 참고본 요약문에는 글머리 기호가 없다 — 사업계획서(`plan.ts:textBox`)처럼 `❖` 를 기본값으로
  // 끼우지 않는다. 작성자가 ```box 첫 줄에 기호를 적었을 때만 그대로 앞에 단다.
  const glyph = b.glyph && b.glyph !== "none" ? `${b.glyph} ` : "";
  const paras: XmlNode[] = [];
  let lineCount = 0;
  for (const line of b.lines) {
    const groups = splitInlinesByNewline(line);
    for (const g of groups.length ? groups : [[]]) {
      const inl = glyph ? prefixed(glyph, g) : g;
      paras.push(ctx.cellPara({ paraPr: s.paraPr, runs: ctx.runsFor(inl, s.base, s.charPr), vertsize: Math.round(s.base.pt * 100), lineSpacing: s.lineSpacing, horzsize: interior }));
      lineCount += ctx.lineCount(inlineText(inl), s.base.pt, interior);
    }
  }
  if (!paras.length) return [];
  const dash = { type: "DASH" as const, widthMm: 0.12, color: "#000000" };
  const bf = ctx.reg.borderFill({ l: dash, r: dash, t: dash, b: dash, fill: BOX_FILL });
  const height = Math.max(BOX_MIN_HEIGHT, BOX_MARGIN.t + BOX_MARGIN.b + BOX_LINE_HEIGHT * lineCount);
  const tbl = table({
    id: ctx.ids.nextShapeId(),
    zOrder: ctx.ids.nextZOrder(),
    cols: [BOX_WIDTH],
    rows: [{ height, cells: [{ col: 0, borderFill: bf, margin: BOX_MARGIN, paragraphs: paras }] }],
    borderFill: ctx.reg.gridBorderFill(),
    inMargin: BOX_MARGIN,
    outMargin: { l: 141, r: 141, t: 141, b: 141 },
    horzRelTo: "COLUMN",
  });
  const anchor = roleSpec(ctx, "tableAnchor");
  return [ctx.para({ paraPr: anchor.paraPr, runs: [{ charPr: anchor.charPr, nodes: [tbl] }], vertsize: height, lineSpacing: 100 })];
}

// ---- 본문 사다리 ---------------------------------------------------------------------------

/**
 * 참고본이 `●` 를 담는 방식: **사용자 영역 문자 `U+F06D`** 다. 심볼 글꼴(한양신명조,
 * 이 템플릿의 `fontRef symbol="14"`)이 그 자리를 채운 동그라미로 그린다.
 *
 * 실측: `section0.xml` 에 `U+F06D` 가 **63개**, 다른 PUA 문자는 없다. `rhwp export-text` 가
 * 뽑은 글에는 `●` 가 **63개**. 하나씩 맞는다. 그래서 DSL 은 사람이 읽고 grep 할 수 있는
 * `●` 를 쓰고(작성자가 `export-text` 에서 보는 것도 그 글자다) 작성기가 나가는 길에 옮긴다.
 *
 * `U+25CF`(진짜 `●`)를 그대로 내보내면 안 된다 — 심볼 글꼴이 아니라 본문 글꼴로 그려져
 * 참고본과 모양이 갈린다. 정확한 부호를 손에 쥐고 있으므로 그럴 이유가 없다.
 *
 * 참고본의 run 짜임(문단 117·120·123·128·136, paraPr 147): `[143: " "] [163: "\uF06D "]
 * [10: 본문]`. 기호와 뒤 공백이 본문(15pt)보다 작은 14pt 라 여기서도 charPr 를 갈라 준다.
 */
const BULLET1_PUA = "\uF06D";

/**
 * 소제목 도형 칩(`geometry/chip.xml`)의 크기 — 조각의 `hp:sz` 와 같다. 참고본의 소제목 줄은
 * 줄 높이도 글자(1500)가 아니라 이 도형(1552)이 정한다.
 */
const SUBHEADING_CHIP_HEIGHT = 1552;

/**
 * 소제목 앞에 붙는 인라인 도형 칩. 참고본은 흰색→`#4E9484` 그러데이션 네모(`hp:rect` 두 장)를
 * `treatAsChar="1"` 인 `hp:container` 로 글줄 안에 끼워 둔다 — 표가 아니라서
 * `extract-geometry.ts`(표만 덤프)가 뜨지 못했고, `section0.xml` 에서 직접 떠 왔다.
 *
 * `cloneFragment`(geometry.ts:22)를 쓰지 않는 까닭: 그쪽은 `hp:p`·`hp:tbl`·`hp:pic` 만 새로
 * 매기고 `hp:container`·`hp:rect` 는 건드리지 않는다. 거기에 도형 갈래를 더하면 같은 함수로
 * 표지 조각을 복제하는 사업계획서(`plan.ts` → `geometry/cover-title.xml` 에 `hp:rect` 가 있다)
 * 의 출력이 함께 바뀐다 — 얼어붙은 family 다. 그래서 여기 갈래를 따로 둔다.
 *
 * 참고본에서 낱낱이 다른 값: 바깥 `id`=`instid`(26개 모두 다르다) · `zOrder` · 속 `hp:rect`
 * 두 장의 `instid`. `hp:rect` 의 `id`·`zOrder` 는 26개 모두 0 이다(묶음 안 번호라 그대로 둔다).
 */
function subHeadingChip(ctx: WriterContext): XmlNode | undefined {
  const ref = loadGeometry(ctx.tpl.dir, "chip");
  if (!ref) return undefined;
  const n = clone(ref);
  const shapeId = String(ctx.ids.nextShapeId());
  n.attrs.id = shapeId;
  n.attrs.instid = shapeId;
  n.attrs.zOrder = String(ctx.ids.nextZOrder());
  for (const rect of findAll(n, "hp:rect")) rect.attrs.instid = String(ctx.ids.nextShapeId());
  return n;
}

/**
 * 본문 한 줄. 기호는 blocks 의 `glyph` 에 따로 담겨 있어서 `inlines` 만 쓰면 조용히 사라진다 —
 * 다른 family 와 같이 반각 공백 + 기호를 글자로 앞에 붙인다(`lib/docmodel/indent.ts`).
 * 예외 둘: `●` 는 심볼 글꼴의 `U+F06D` 로 바뀌고, `□` 는 글자가 아니라 도형 칩이 된다.
 */
function ladderPara(ctx: WriterContext, b: ParaBlock): XmlNode {
  const role = ladderRole(b.role, b.glyph);
  const s = roleSpec(ctx, role);
  const glyph = b.glyph && b.glyph !== "none" ? b.glyph : undefined;
  const spaces = " ".repeat(b.indent ?? leadingSpaces("report", b.glyph, b.role));
  let runs;
  let vertsize = Math.round(s.base.pt * 100);
  if (glyph === "●") {
    const mark = roleSpec(ctx, "bullet1Mark").charPr;
    runs = [
      ...(spaces ? [{ charPr: mark, text: spaces }] : []),
      { charPr: mark, text: `${BULLET1_PUA} ` },
      ...ctx.runsFor(b.inlines, s.base, s.charPr),
    ];
  } else if (role === "subHeading") {
    const chip = subHeadingChip(ctx);
    if (!chip) ctx.warnings.push({ blockId: b.id, message: "report template geometry chip missing; 소제목 도형 칩을 생략했습니다" });
    // 참고본은 도형과 글을 한 run 에 담지만(`hp:container` 다음에 `hp:t`), RunSpec 은 둘 중
    // 하나만 받는다. charPr 가 같은 run 두 개로 나누어도 글꼴·크기는 같다.
    runs = [
      ...(chip ? [{ charPr: s.charPr, nodes: [chip] }] : []),
      // 참고본의 글은 도형 다음 반각 공백 하나로 시작한다(`<hp:t> 청년정주지원센터 …`).
      ...ctx.runsFor(prefixed(`${spaces} `, b.inlines), s.base, s.charPr),
    ];
    if (chip) vertsize = Math.max(vertsize, SUBHEADING_CHIP_HEIGHT);
  } else {
    runs = ctx.runsFor(prefixed(spaces + (glyph ? `${glyph} ` : ""), b.inlines), s.base, s.charPr);
  }
  return ctx.para({
    paraPr: s.paraPr,
    runs,
    vertsize,
    lineSpacing: s.lineSpacing,
    forcePageBreak: b.pageBreakBefore,
  });
}

function prefixed(prefix: string, inlines: Inline[]): Inline[] {
  return prefix ? [{ t: "text", text: prefix }, ...inlines] : inlines;
}
