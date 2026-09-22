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
 * 이 과제에서 내지 않는 것: 번호칩·요약박스·소제목 도형 칩(Task 4), 조직도·목차(Task 5).
 * 그 블록들은 지금 역할만 맞는 **맨 문단**으로 떨어진다 — 경고를 내고 버리면 `##` 제목이
 * 통째로 사라지기 때문이다.
 */
import type { XmlNode } from "../xml";
import { cloneFragment, loadGeometry, setCellText } from "../geometry";
import { pictureFrom, pictureSize } from "../emit/picture";
import { emitBlank, emitTable, splitInlinesByNewline, type FamilyStyle } from "./common";
import { leadingSpaces } from "../../docmodel/indent";
import type { Block, Glyph, Inline, ParaRole, ReportDoc, ReportMeta } from "../../docmodel/schema";
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
 * **소제목(`subHeading`)은 여기서 나오지 않는다.** 참고본의 소제목 줄에는 글자 표지가 아예
 * 없고 — 인라인 `hp:container` 도형 칩이 표지 노릇을 한다 — 그래서 기호로는 가리킬 수 없다.
 * style-map 에는 짝(paraPr 146 / charPr 142)을 맺어 두었고, 그 칩을 다는 것은 Task 4 다.
 *
 * `ㅇ` 는 참고본에서 일반현황의 평평한 목록(`ㅇ 1997년 …`, `ㅇ 조  직: 1본부 3실 …`)이다.
 * 열한 번 모두 그 쓰임이라 `listItem` 에 맺었다.
 */
function ladderRole(role: ParaRole, glyph: Glyph | undefined): string {
  if (role === "tocLine") return "tocLine";
  switch (glyph) {
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
        out.push(...summaryBox(ctx, b.lines));
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
 * 참고본의 제목은 남색 `hp:rect` 안의 글인데(그러데이션 상자), 그 조각을 뜨는 것은 소제목 칩과
 * 같은 종류의 일이라 Task 4 로 미룬다. 여기서는 같은 문단 모양(paraPr 45 / charPr 47 =
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

// ---- Task 4 가 갈아 끼울 자리 -----------------------------------------------------------

/** 번호+제목 칩의 임시 모습 — Task 4 가 1×2 표(`geometry/t05.xml` 계열)로 바꾼다. */
function sectionChip(ctx: WriterContext, label: string, title: string): XmlNode {
  const s = roleSpec(ctx, "chipTitle");
  const text = `${label ? `${label} ` : ""}${title}`;
  return ctx.para({ paraPr: s.paraPr, runs: [{ charPr: s.charPr, text }], vertsize: Math.round(s.base.pt * 100), lineSpacing: s.lineSpacing });
}

/** 요약문의 임시 모습 — Task 4 가 1×1 요약박스(`geometry/t06.xml` 계열)로 바꾼다. */
function summaryBox(ctx: WriterContext, lines: Inline[][]): XmlNode[] {
  const s = roleSpec(ctx, "summary");
  const out: XmlNode[] = [];
  for (const line of lines) {
    for (const g of splitInlinesByNewline(line)) {
      out.push(ctx.para({ paraPr: s.paraPr, runs: ctx.runsFor(g, s.base, s.charPr), vertsize: Math.round(s.base.pt * 100), lineSpacing: s.lineSpacing }));
    }
  }
  return out;
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
 * 본문 한 줄. 기호는 blocks 의 `glyph` 에 따로 담겨 있어서 `inlines` 만 쓰면 조용히 사라진다 —
 * 다른 family 와 같이 반각 공백 + 기호를 글자로 앞에 붙인다(`lib/docmodel/indent.ts`).
 */
function ladderPara(ctx: WriterContext, b: ParaBlock): XmlNode {
  const s = roleSpec(ctx, ladderRole(b.role, b.glyph));
  const glyph = b.glyph && b.glyph !== "none" ? b.glyph : undefined;
  const spaces = " ".repeat(b.indent ?? leadingSpaces("report", b.glyph, b.role));
  const runs =
    glyph === "●"
      ? [
          ...(spaces ? [{ charPr: roleSpec(ctx, "bullet1Mark").charPr, text: spaces }] : []),
          { charPr: roleSpec(ctx, "bullet1Mark").charPr, text: `${BULLET1_PUA} ` },
          ...ctx.runsFor(b.inlines, s.base, s.charPr),
        ]
      : ctx.runsFor(prefixed(spaces + (glyph ? `${glyph} ` : ""), b.inlines), s.base, s.charPr);
  return ctx.para({
    paraPr: s.paraPr,
    runs,
    vertsize: Math.round(s.base.pt * 100),
    lineSpacing: s.lineSpacing,
    forcePageBreak: b.pageBreakBefore,
  });
}

function prefixed(prefix: string, inlines: Inline[]): Inline[] {
  return prefix ? [{ t: "text", text: prefix }, ...inlines] : inlines;
}
