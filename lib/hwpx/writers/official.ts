/**
 * 공문서 작성기 — 별지 제1호 일반기안문.
 * 두문 표(t00)와 결문 표(t01)를 참고 문서에서 XML 그대로 복제하고 setCellText 로 값만 바꾼다.
 * 셀 주소는 docs/plans/2026-09-21-공문서.md 의 셀 지도에서 실측한 값이다.
 *
 * 사업계획서 결재란(plan.ts:128)과 같은 기법이지만 한 가지가 다르다: 공문서 참고 문서는
 * 두문 표와 도입 문장을 **같은 문단**에 담고 있어서(표 run 뒤에 CLICK_HERE 누름틀과 hp:t 가
 * 이어진다), 조각을 그대로 복제하면 참고 문서의 도입 문장과 짝 없는 fieldBegin 이 따라온다.
 * tableOnly() 가 표 run 하나만 남긴다.
 */
import { childrenNamed, findFirst, isNode, type XmlNode } from "../xml";
import { paragraph } from "../emit/paragraph";
import { loadGeometry, cloneFragment, setCellText } from "../geometry";
import { approvalLineFor, approvalLineUpTo, departmentFullName, findUnit, INSTITUTION_HEAD_TITLE, senderTitleFor } from "../../org";
import { leadingSpaces, manualMarkerIndent } from "../../docmodel/indent";
import { inlineText, officialMetaProblems, type Block, type Inline, type OfficialDoc, type OfficialMeta } from "../../docmodel/schema";
import type { CharSpec, ParaSpec } from "../registry";
import { WriterContext } from "./context";
import { emitTable, orphanSpacing, type FamilyStyle } from "./common";

type ParaBlock = Extract<Block, { k: "para" }>;

/** style-map 역할이 없을 때의 대비값. 참고 문서는 굴림체 12pt 장평 95 / 180 %(charPr 8, paraPr 27). */
const BODY_CHAR: CharSpec = { font: "gulim", pt: 12, ratio: 95 };
const BODY_LINE_SPACING = 180;
/** 본문 표(정산내역 등) — 본문 12pt 에 맞춘 10pt 표, 회색 머리글. 참고 공문 정산표 실측 모양 */
const OFFICIAL_TABLE_STYLE: FamilyStyle = {
  bodyPt: 12,
  bodyLineSpacing: BODY_LINE_SPACING,
  body1Bold: false,
  body1Font: "body",
  notePt: 11,
  tableHeaderFill: "#E5E5E5",
  tableFontPt: 10,
  hangingIndent: true,
  indentFamily: "official",
  // 공문 본문 글꼴(참고 문서 header 의 굴림체) — 역할 이름이 아니라 글꼴 이름으로 준다
  tableFont: "굴림체",
  anchorFont: "굴림체",
  // 금액 칸은 오른쪽 정렬(담당자 공문 3630 정산표)
  numericRight: true,
};
/** 본문이 길어 줄간격을 좁힐 때의 표 — 담당자 공문 3630 의 표 줄간격(125~130 %) */
const OFFICIAL_TABLE_STYLE_COMPACT: FamilyStyle = { ...OFFICIAL_TABLE_STYLE, tableLook: { lineSpacing: 130 } };

// ---- 두문(t00) 셀 지도 ------------------------------------------------------------------
const HEAD_수신 = [3, 1] as const;
const HEAD_경유 = [4, 1] as const;
const HEAD_제목 = [5, 1] as const;

// ---- 결문(t01) 셀 지도 ------------------------------------------------------------------
const FOOT_발신명의 = [0, 10] as const;
const FOOT_수신자라벨 = [1, 0] as const;
const FOOT_수신자 = [1, 5] as const;
/**
 * 결재란 직위 칸 다섯 개 — t01 3행의 셀 이름이 `직위.1` … `직위.5` 이고 다섯 칸 모두
 * `borderFillIDRef=3 paraPr=23 charPr=21` 로 같다. 참고 문서에서 뒤 두 칸이 비어 있는 것은
 * 그 문서가 실장 전결(`★과장`의 ★)이었기 때문이지 서식이 세 칸이어서가 아니다.
 * (4행 `직위.6`…`직위.10` 은 결재선이 더 긴 문서를 위한 둘째 줄이다 — 여기서는 쓰지 않는다.)
 */
const FOOT_결재 = [
  [3, 0],
  [3, 9],
  [3, 20],
  [3, 32],
  [3, 42],
] as const;
const FOOT_협조자 = [5, 4] as const;
const FOOT_시행 = [7, 3] as const;
const FOOT_시행일 = [7, 16] as const;
const FOOT_우편번호 = [8, 1] as const;
const FOOT_주소 = [8, 7] as const;
const FOOT_홈페이지 = [8, 30] as const;
const FOOT_전화 = [9, 2] as const;
const FOOT_전송 = [9, 13] as const;
const FOOT_이메일 = [9, 23] as const;
const FOOT_공개구분 = [9, 39] as const;

export function writeOfficial(ctx: WriterContext, doc: OfficialDoc): XmlNode[] {
  const est = estimateBodyHeight(ctx, doc, BODY_LINE_SPACING);
  compactSpacing = est > BODY_BUDGET;
  if (compactSpacing && estimateBodyHeight(ctx, doc, COMPACT_LINE_SPACING) > BODY_BUDGET) {
    ctx.warnings.push({ message: "공문 본문이 길어 결재란·시행 정보가 다음 쪽으로 넘어갈 수 있습니다 — 사업개요·붙임 줄을 한 줄씩으로 줄이세요" });
  }
  try {
    return writeOfficialInner(ctx, doc);
  } finally {
    compactSpacing = false;
  }
}

function writeOfficialInner(ctx: WriterContext, doc: OfficialDoc): XmlNode[] {
  const out: XmlNode[] = [];
  const m = doc.meta;
  for (const p of officialMetaProblems(m)) ctx.warnings.push({ message: p });
  // 작성자가 ```attach 로 직접 쓴 붙임이 있으면 그것을 쓰고, 없을 때만 meta.붙임 을 펼친다
  // (serialize/toText.ts:99 와 같은 규칙).
  const hasAttachmentBlock = doc.blocks.some((b) => b.k === "attachmentList");
  let wroteFooter = false;
  // 첫 본문 문단은 두문 표와 같은 문단에 들어간다(firstBodyBlock 참조) — 본문 루프에서는 건너뛴다
  const first = firstBodyBlock(doc.blocks);
  // 별지(붙임 서식)는 `<pagebreak>` 뒤에 온다. 결문은 본문이 끝나는 쪽에 와야 하므로 그 쪽나눔
  // **앞**에 쓴다 — 맨 뒤에 붙이면 결재란·시행 정보가 별지로 밀린다.
  const 별지시작 = doc.blocks.find((b) => b.k === "pageBreak");

  for (const b of doc.blocks) {
    if (b === first) continue;
    switch (b.k) {
      case "officialHeader":
        out.push(...headTable(ctx, m, first));
        break;
      case "officialFooter":
        out.push(...footTable(ctx, m, hasAttachmentBlock));
        wroteFooter = true;
        break;
      case "para":
        out.push(bodyPara(ctx, b));
        break;
      case "blank":
        out.push(blankPara(ctx));
        break;
      case "attachmentList":
        out.push(...attachmentParas(ctx, b.items));
        break;
      case "table":
        // 결과 및 정산보고 공문의 정산내역 표(교부금·집행액·잔액·이자·반납액)처럼 본문에 표가 드는
        // 공문이 실문서의 다수다(closeout-cover.md §2.6). 표가 없는 공문의 출력은 그대로다.
        out.push(...emitTable(ctx, compactSpacing ? OFFICIAL_TABLE_STYLE_COMPACT : OFFICIAL_TABLE_STYLE, b));
        break;
      case "pageBreak":
        if (b === 별지시작 && !wroteFooter) {
          out.push(...footTable(ctx, m, hasAttachmentBlock));
          wroteFooter = true;
        }
        ctx.pendingPageBreak = true;
        break;
      default:
        ctx.warnings.push({ blockId: b.id, message: `block kind "${b.k}" is not supported in 공문서; skipped` });
    }
  }
  if (!wroteFooter) out.push(...footTable(ctx, m, hasAttachmentBlock));
  return out;
}

/**
 * style-map 역할(`body`·`attachment`)의 문단·글자 속성. 굵은 글씨 같은 변형은 참고 문서의
 * 글꼴에서 파생해야 하므로(`font: "body"` 로 두면 휴먼명조가 끼어든다) 실제 charPr 에서 읽는다.
 */
function roleSpec(ctx: WriterContext, name: string): { paraPr: number; charPr: number; base: CharSpec; lineSpacing: number } {
  const r = ctx.roleOr(name, { para: { align: "JUSTIFY", lineSpacing: BODY_LINE_SPACING }, char: BODY_CHAR });
  const c = ctx.reg.charPrInfo(r.charPr);
  const base: CharSpec = c ? { font: c.hangul, pt: c.pt, spacing: c.spacing, ratio: c.ratio } : BODY_CHAR;
  const info = ctx.reg.paraPrInfo(r.paraPr);
  const ls = info?.lineSpacing ?? BODY_LINE_SPACING;
  if (compactSpacing && info && ls > COMPACT_LINE_SPACING) {
    const paraPr = ctx.reg.paraPr({ align: info.align as ParaSpec["align"], lineSpacing: COMPACT_LINE_SPACING, hanging: info.intent < 0 ? -info.intent / 2 : undefined, firstLine: info.intent > 0 ? info.intent / 2 : undefined, left: info.left / 2, right: info.right / 2, prev: info.prev / 2, next: info.next / 2, keepWithNext: info.keepWithNext });
    return { paraPr, charPr: r.charPr, base, lineSpacing: COMPACT_LINE_SPACING };
  }
  return { ...r, base, lineSpacing: ls };
}

/**
 * 결문 표는 쪽 맨 아래에 붙는 고정 표(높이 약 82mm)라 본문이 그 자리를 침범하면 결재란이 통째로 다음 쪽으로 간다.
 * 본문이 길면 담당자 공문(ESG·기업지원팀-3630)처럼 줄간격을 155 % 로 좁혀 한 쪽에 넣는다(담당자 2026-10-06).
 */
const COMPACT_LINE_SPACING = 155;
/**
 * 두문·결문을 뺀 본문 자리(HWPUNIT, 아래 추정식 단위). 담당자 공문 3630 과 같은 분량(본문 11줄 + 정산표 + 붙임 3줄)은
 * 추정 180 % = 40,100 이면 결문이 다음 쪽으로 밀리고 155 % = 35,600 이면 한 쪽에 드는 것을 한글에서 확인했다(2026-10-06).
 * 그 사이 값을 둔다.
 */
const BODY_BUDGET = 37500;

/** 본문(두문 앵커의 첫 문단 포함) 높이 추정 — 문단 줄 수 × 글자 크기 × 줄간격 + 표 + 붙임 */
function estimateBodyHeight(ctx: WriterContext, doc: OfficialDoc, ls: number): number {
  const pt = BODY_CHAR.pt;
  const line = pt * 100 * (ls / 100);
  let h = 0;
  for (const b of doc.blocks) {
    if (b.k === "pageBreak") break;
    if (b.k === "para") {
      const t = inlineText(bodyInlines(b));
      h += /^\s*\(단위\s*[:：]/.test(t) ? 1300 : ctx.lineCount(t, pt, OFFICIAL_TEXT_WIDTH) * line;
    } else if (b.k === "blank") h += line;
    else if (b.k === "table") h += b.rows.reduce((a, r) => a + Math.max(1, ...r.cells.map((c) => inlineText(c.inlines).split(String.fromCharCode(10)).length)), 0) * 1000 * 1.6 + 600;
    else if (b.k === "attachmentList") h += b.items.length * line + 1000;
  }
  if (!doc.blocks.some((b) => b.k === "attachmentList")) h += doc.meta.붙임.length * line + (doc.meta.붙임.length ? 1000 : 0);
  return h;
}
/** 공문 서식(별지 제1호)의 본문 폭 — 용지 59528 − 왼쪽 5102 − 오른쪽 4818 (templates/official) */
const OFFICIAL_TEXT_WIDTH = 49608;
let compactSpacing = false;

/**
 * 두문 표와 한 문단에 들어갈 본문 블록 — **첫 본문 문단이면 무엇이든**이다.
 *
 * 처음에는 "번호 없는 도입 문장일 때만"으로 좁혀 두었는데 틀렸다. 「실라리안 특판전」(표본 1)의
 * 앵커 문단은 번호 항목 `1. 평소 부서 운영에 협조해 주셔서 감사합니다.` 를 담고 있다. 기준은
 * 글의 모양이 아니라 **자리**다. 덕분에 `1.` 로 시작하는 공문에도 빈 앵커 줄이 남지 않는다.
 */
function firstBodyBlock(blocks: OfficialDoc["blocks"]): ParaBlock | undefined {
  return blocks.find((b) => b.k === "para") as ParaBlock | undefined;
}

/**
 * 본문 문단의 글자 내용 — 글머리 기호를 앞에 붙이고 편람 2타 사다리만큼 반각 공백으로
 * 들여쓴다(다른 family 와 같은 관행, lib/docmodel/indent.ts). 기호는 blocks 의 `glyph` 에
 * 따로 담겨 있어서 `inlines` 만 쓰면 조용히 사라진다 — 앵커에 넣는 첫 문단도 같은 길을 탄다.
 */
function bodyInlines(b: ParaBlock): Inline[] {
  const glyph = b.glyph && b.glyph !== "none" ? b.glyph : undefined;
  // 기호가 없는 문단은 글머리의 편람 번호(`1.` `가.` `1)` …)에서 단계를 읽는다 — 번호는 glyph
  // 가 아니라 본문 글자라서 기호 사다리가 닿지 않아 지금까지 전부 0타로 나갔다.
  const marker = glyph ? undefined : manualMarkerIndent(inlineText(b.inlines));
  const prefix = " ".repeat(b.indent ?? marker ?? leadingSpaces("official", b.glyph, b.role)) + (glyph ? `${glyph} ` : "");
  return prefix ? [{ t: "text", text: prefix }, ...b.inlines] : b.inlines;
}

/** 본문 문단 — 참고 문서의 paraPr 27 / charPr 8 을 그대로 쓴다(표준 서식의 본문 줄). */
function bodyPara(ctx: WriterContext, b: ParaBlock): XmlNode {
  const s = roleSpec(ctx, "body");
  // "(단위: 원)" 줄은 표 오른쪽 위에 작게(담당자 공문 3630) — 본문 줄로 두면 왼쪽에 붙어 표 머리와 떨어져 보인다
  const raw = inlineText(b.inlines).trim();
  if (/^\(단위\s*[:：].*\)$/.test(raw)) {
    const paraPr = ctx.reg.paraPr({ align: "RIGHT", lineSpacing: 130 });
    const charPr = ctx.reg.charPr({ ...s.base, pt: 10 });
    // captionParas 에 넣지 않는다 — 표와 한 문단으로 묶이면(mergeCaptionTables) 단위 줄이 표 **아래**에 그려지고
    // 그 문단 높이가 부풀어 붙임이 쪽 아래 결문의 발신명의와 겹쳤다(담당자 2026-10-12). 공문은 한 쪽이라 단위 줄만
    // 쪽 끝에 남을 일이 없으니 따로 둔다.
    return ctx.para({ paraPr, runs: [{ charPr, text: raw }], vertsize: 1000, lineSpacing: 130 });
  }
  const inl = bodyInlines(b);
  const sp = orphanSpacing(ctx, inlineText(inl), s.base, OFFICIAL_TEXT_WIDTH);
  const runs = sp ? ctx.runsFor(inl, { ...s.base, spacing: sp }) : ctx.runsFor(inl, s.base, s.charPr);
  return ctx.para({ paraPr: s.paraPr, runs, vertsize: s.base.pt * 100, lineSpacing: s.lineSpacing, forcePageBreak: b.pageBreakBefore });
}

function blankPara(ctx: WriterContext): XmlNode {
  const s = roleSpec(ctx, "body");
  return ctx.para({ paraPr: s.paraPr, runs: [{ charPr: s.charPr, text: "" }], vertsize: s.base.pt * 100, lineSpacing: s.lineSpacing });
}

/**
 * 붙임 줄 — 편람 §4(시행규칙 제4조제4·5항): `붙임∨∨명칭 수량.∨∨끝.`
 * 항목이 둘 이상이면 `붙임∨∨1.∨…` 처럼 번호를 매기고 마지막 항목 뒤에 `끝.` 을 붙인다.
 */
function attachmentParas(ctx: WriterContext, items: string[]): XmlNode[] {
  const s = roleSpec(ctx, "attachment");
  // 작성자가 `끝.` 만 담은 줄을 넣었으면(```attach 관행) 버린다 — 여기서 다시 붙인다
  const list = items.map((it) => it.trim()).filter((it) => it && it !== "끝.");
  if (list.length === 0) return [];
  const many = list.length > 1;
  return list.map((it, i) => {
    const head = i === 0 ? "붙임  " : "      ";
    const body = many ? `${i + 1}. ${it}` : it;
    const text = head + body + (i === list.length - 1 ? "  끝." : "");
    // 문단 위 여백은 "붙임" 첫 줄에만 — 줄마다 넣으면 붙임 3줄이 벌어져 결문이 다음 쪽으로 밀렸다(담당자 공문 3630 은 여백 없음)
    const paraPr = i === 0 ? s.paraPr : noSpaceBefore(ctx, s.paraPr);
    return ctx.para({ paraPr, runs: [{ charPr: s.charPr, text }], vertsize: s.base.pt * 100, lineSpacing: s.lineSpacing });
  });
}

/** 같은 문단 모양에서 문단 위 여백만 뺀 것 */
function noSpaceBefore(ctx: WriterContext, paraPr: number): number {
  const p = ctx.reg.paraPrInfo(paraPr);
  if (!p || !p.prev) return paraPr;
  return ctx.reg.paraPr({ align: p.align as ParaSpec["align"], lineSpacing: p.lineSpacing, hanging: p.intent < 0 ? -p.intent / 2 : undefined, firstLine: p.intent > 0 ? p.intent / 2 : undefined, left: p.left / 2, right: p.right / 2, next: p.next / 2, keepWithNext: p.keepWithNext });
}

// ---- 두문 --------------------------------------------------------------------------------

/**
 * 두문 표 + 첫 본문 문단. 참고 문서에서 이 둘은 **한 문단**이다(표 run 다음에 글 run 이 이어진다).
 *
 * 첫 문단을 뒤따르는 별도 문단으로 내면, 표만 든 앵커 문단이 자기 paraPr(28 = 12pt 200 %)
 * 높이만큼 빈 줄을 차지한다 — 한글에서 제목 아래에 빈 줄로 보인다(rhwp·resvg 는 이 빈 줄을
 * 접어서 렌더가 같아 보인다). 참고 문서와 같은 구조로 내면 빈 줄이 사라지고, 첫 문단은
 * 앵커의 paraPr(줄간격 200 %, 문단 아래 500)을 저절로 물려받는다. 문단 아래 간격이 다음 항목
 * 앞 빈 줄 노릇을 하므로 빈 문단을 따로 넣지 않는다.
 *
 * paraPr 는 언제나 우리 템플릿(표본 3)의 앵커 값을 쓴다 — 표본마다 id 가 다르므로 다른 표본에서
 * 읽은 번호를 옮겨 적지 않는다.
 */
function headTable(ctx: WriterContext, m: OfficialMeta, first: ParaBlock | undefined): XmlNode[] {
  const ref = loadGeometry(ctx.tpl.dir, "t00");
  if (!ref) {
    ctx.warnings.push({ message: "official template geometry t00 missing; 두문 표를 생략했습니다" });
    return first ? [bodyPara(ctx, first)] : [];
  }
  // tableOnly 가 참고 문서의 도입 문장과 짝 없는 CLICK_HERE fieldBegin 을 먼저 걷어낸다
  const head = tableOnly(cloneFragment(ref, ctx.ids));
  setCellText(head, ...HEAD_수신, 수신값(m));
  setCellText(head, ...HEAD_경유, m.경유);
  setCellText(head, ...HEAD_제목, m.제목);
  if (compactSpacing) {
    // 첫 문단 아래 5pt 여백과 180 % 줄간격 — 본문을 좁힐 때는 담당자 공문 3630 처럼 여백 없이
    const info = ctx.reg.paraPrInfo(Number(head.attrs.paraPrIDRef));
    if (info) head.attrs.paraPrIDRef = String(ctx.reg.paraPr({ align: info.align as ParaSpec["align"], lineSpacing: COMPACT_LINE_SPACING, left: info.left / 2, right: info.right / 2 }));
  }
  if (first) {
    const s = roleSpec(ctx, "lead");
    // paragraph() 로 run 노드만 만들어 앵커에 잇는다(문단 자체는 버린다) — 하이퍼링크 같은
    // 특수 run 도 본문과 똑같이 나오도록 run 생성 로직을 한 곳에 둔다
    const runs = childrenNamed(paragraph({ id: 0, paraPr: s.paraPr, runs: ctx.runsFor(bodyInlines(first), s.base, s.charPr) }), "hp:run");
    head.children.push(...runs);
  }
  return [head];
}

/** 수신 칸의 값 — 내부결재문서는 `내부결재`, 수신자가 여럿이면 `수신자 참조`(목록은 결문에 쓴다). */
function 수신값(m: OfficialMeta): string {
  if (m.수신유형 === "내부결재") return "내부결재";
  if (m.수신유형 === "수신자참조") return "수신자 참조";
  return m.수신 ?? "";
}

// ---- 결문 --------------------------------------------------------------------------------

function footTable(ctx: WriterContext, m: OfficialMeta, hasAttachmentBlock: boolean): XmlNode[] {
  const out: XmlNode[] = [];
  if (!hasAttachmentBlock) out.push(...attachmentParas(ctx, m.붙임));
  const ref = loadGeometry(ctx.tpl.dir, "t01");
  if (!ref) {
    ctx.warnings.push({ message: "official template geometry t01 missing; 결문 표를 생략했습니다" });
    return out;
  }
  const foot = tableOnly(cloneFragment(ref, ctx.ids));
  // 결문 표를 품은 문단은 글자 1pt — 12pt 로 두면 빈 줄 하나(약 7mm)를 차지해 그 줄이 쪽에 안 들어갈 때 결문 표까지
  // 다음 쪽으로 끌고 갔다(담당자 공문 3630 의 앵커는 1pt, 2026-10-06)
  for (const r of childrenNamed(foot, "hp:run")) {
    const c = ctx.reg.charPrInfo(Number(r.attrs.charPrIDRef));
    r.attrs.charPrIDRef = String(ctx.reg.charPr(c ? { font: c.hangul, pt: 1, ratio: c.ratio } : { ...BODY_CHAR, pt: 1 }));
  }

  // 수신자 목록은 `수신자참조` 일 때만 — 아니면 라벨까지 비워 참고 문서의 목록이 남지 않게 한다
  const 참조 = m.수신유형 === "수신자참조";
  setCellText(foot, ...FOOT_수신자라벨, 참조 ? "수신자" : "");
  setCellText(foot, ...FOOT_수신자, 참조 ? (m.수신자 ?? []).join(", ") : "");

  // 결재란이 먼저다 — 발신명의는 그 결재라인의 **마지막 직위**에서 나온다
  const line = 결재라인(ctx, m);
  setCellText(foot, ...FOOT_발신명의, 발신명의(ctx, m, line));
  if (line.length > FOOT_결재.length) {
    ctx.warnings.push({ message: `결재란은 ${FOOT_결재.length}칸입니다. 결재라인 ${line.length}개 중 뒤 ${line.length - FOOT_결재.length}개(${line.slice(FOOT_결재.length).join(", ")})는 서식에 들어가지 않습니다` });
  }
  FOOT_결재.forEach(([row, col], i) => setCellText(foot, row, col, line[i] ?? ""));

  setCellText(foot, ...FOOT_협조자, m.협조자.join(", "));

  // 시행 일련번호는 만들지 않는다 — 전자결재가 기안 후에 채번한다(plan.ts:141 과 같은 관행).
  setCellText(foot, ...FOOT_시행, `${m.처리과}-`);
  setCellText(foot, ...FOOT_시행일, m.시행일);

  const c = m.연락처;
  setCellText(foot, ...FOOT_우편번호, c.우편번호);
  setCellText(foot, ...FOOT_주소, c.주소);
  setCellText(foot, ...FOOT_홈페이지, c.홈페이지);
  setCellText(foot, ...FOOT_전화, c.전화);
  setCellText(foot, ...FOOT_전송, c.전송);
  setCellText(foot, ...FOOT_이메일, c.이메일);
  setCellText(foot, ...FOOT_공개구분, m.공개구분);

  out.push(foot);
  return out;
}

/**
 * 결재란 직위 — 직접 적은 `결재라인` 이 언제나 앞선다(전결을 규정 밖으로 적어야 하는 문서의
 * 탈출구; 골든 문서가 참고 문서의 과장·팀장·실장을 이 길로 재현한다). 비어 있으면 `전결` 단계에서
 * 끊는다. 그 단계가 처리과의 결재라인에 없으면(본부 없는 경영기획실의 본부장 전결) 끊지 않고
 * 전체를 쓰되 그렇게 했다고 말한다 — 조용히 다른 단계로 바꾸면 결재란이 사실과 달라진다.
 */
function 결재라인(ctx: WriterContext, m: OfficialMeta): string[] {
  if (m.결재라인.length) return m.결재라인;
  const cut = approvalLineUpTo(m.처리과, m.전결);
  if (cut) return cut;
  const full = approvalLineFor(m.처리과);
  ctx.warnings.push({ message: `처리과 "${m.처리과}"의 결재라인(${full.join("·")})에는 ${m.전결} 단계가 없습니다 — 전결 없이 ${full[full.length - 1]}까지 결재하는 것으로 두었습니다` });
  return full;
}

/**
 * 결문 발신명의 칸은 직위(`경영기획실장`)를 쓴다 — 사람 이름이 아니다.
 * 직접 적은 값이 언제나 앞서고, 비어 있으면 **결재라인의 마지막 직위**에서 만든다
 * (원장 → 기관장, 본부장 → 소속 본부장, 실장·단장 → 그 실·단장).
 */
function 발신명의(ctx: WriterContext, m: OfficialMeta, line: string[]): string {
  if (m.발신명의.trim()) return m.발신명의.trim();
  // 밖으로 나가는 공문(수신자·수신자참조)은 전결과 관계없이 **기관장 명의**다 — 전결은 결재란을
  // 어디서 끊는지만 정한다(담당자 지시 2026-10-02; 실문서 ESG·기업지원팀-3629·3630: 본부장 전결,
  // 발신명의 "(재)경상북도경제진흥원장"). 실·단장 명의는 내부결재에서만 쓴다.
  if (m.수신유형 !== "내부결재" && !isInternalRecipient(m)) return INSTITUTION_HEAD_TITLE;
  const last = line[line.length - 1];
  const title = senderTitleFor(last, m.처리과);
  if (title) return title;
  // 규칙이 이름 붙이지 않은 마지막 직위(내부결재의 팀장·지소장)나 모르는 부서 — 처리과에서
  // 지어내되 무엇을 했는지 남긴다
  const unit = departmentFullName(m.처리과);
  const derived = unit ? (unit.endsWith("장") ? unit : `${unit}장`) : "";
  ctx.warnings.push({
    message: derived
      ? `결재라인의 마지막 직위 "${last ?? ""}"로는 발신명의를 정할 수 없어 처리과 "${m.처리과}"에서 "${derived}"로 채웠습니다`
      : `발신명의가 비어 있고 처리과 "${m.처리과}"로 부서를 찾지 못해 빈 칸으로 두었습니다`,
  });
  return derived;
}

/**
 * 받는 곳이 모두 진흥원 안인가 — "전부서", 진흥원의 팀·실·지소 이름, 또는 기관명 없이 직위만 적은 수신
 * (경영지원팀장, 본부장). 안이면 보조기관(전결권자) 명의, 밖(경상북도지사·○○시장·다른 기관)이면 기관장 명의다.
 */
export function isInternalRecipient(m: Pick<OfficialMeta, "수신" | "수신자">): boolean {
  const names = [m.수신 ?? "", ...(m.수신자 ?? [])].map((s) => s.trim()).filter(Boolean);
  if (!names.length) return false;
  return names.every((n) => {
    const base = n.replace(/\(.*\)$/, "").trim();
    if (/^(전\s*부서|각\s*(팀|부서|실)|진흥원\s*전\s*직원)/.test(base)) return true;
    if (/(도지사|시장|군수|구청장|교육감|대표|이사장|위원장|센터장|회장|청장|총장|병원장)$/.test(base)) return false;
    if (findUnit(base.replace(/(장|팀장|실장|지소장|단장)$/, ""))) return true;
    return /^(원장|본부장|실장|단장|팀장|지소장)$/.test(base) || /(본부장|실장|단장|팀장|지소장)$/.test(base) && !/[(\s]/.test(base);
  });
}

// ---- 조각 다듬기 ---------------------------------------------------------------------------

/**
 * 복제한 조각에서 표를 담은 run 하나만 남긴다.
 *
 * 참고 문서의 두문 문단은 `[표][CLICK_HERE 누름틀][도입 문장]` 이 한 문단에 들어 있다. 그대로
 * 두면 (1) 참고 문서의 도입 문장이 모든 공문서에 새고, (2) 짝이 없는 fieldBegin 이 남는다
 * (짝 fieldEnd 는 참고 문서의 마지막 문단에 있었다 — ADR 0004 의 secPr 중복과 같은 종류의
 * 사고다). 사업계획서 조각은 표 뒤가 구역 컨트롤뿐이라 stripSectionControls 만으로 충분했다.
 */
function tableOnly(frag: XmlNode): XmlNode {
  const run = childrenNamed(frag, "hp:run").find((r) => findFirst(r, "hp:tbl"));
  if (!run) return frag;
  run.children = run.children.filter((c) => isNode(c) && c.name === "hp:tbl");
  frag.children = frag.children.filter((c) => c === run);
  return frag;
}
