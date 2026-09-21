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
import { loadGeometry, cloneFragment, setCellText } from "../geometry";
import { approvalLineFor, departmentFullName } from "../../org";
import { leadingSpaces } from "../../docmodel/indent";
import { officialMetaProblems, type Block, type Inline, type OfficialDoc, type OfficialMeta } from "../../docmodel/schema";
import type { CharSpec } from "../registry";
import { WriterContext } from "./context";

type ParaBlock = Extract<Block, { k: "para" }>;

/** style-map 역할이 없을 때의 대비값. 참고 문서는 굴림체 12pt 장평 95 / 180 %(charPr 8, paraPr 27). */
const BODY_CHAR: CharSpec = { font: "gulim", pt: 12, ratio: 95 };
const BODY_LINE_SPACING = 180;

// ---- 두문(t00) 셀 지도 ------------------------------------------------------------------
const HEAD_수신 = [3, 1] as const;
const HEAD_경유 = [4, 1] as const;
const HEAD_제목 = [5, 1] as const;

// ---- 결문(t01) 셀 지도 ------------------------------------------------------------------
const FOOT_발신명의 = [0, 10] as const;
const FOOT_수신자라벨 = [1, 0] as const;
const FOOT_수신자 = [1, 5] as const;
/** 결재란 직위 칸 — 참고 문서에 값이 있는 세 칸(★과장 / 팀장 / 실장) */
const FOOT_결재 = [
  [3, 0],
  [3, 9],
  [3, 20],
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
  const out: XmlNode[] = [];
  const m = doc.meta;
  for (const p of officialMetaProblems(m)) ctx.warnings.push({ message: p });
  // 작성자가 ```attach 로 직접 쓴 붙임이 있으면 그것을 쓰고, 없을 때만 meta.붙임 을 펼친다
  // (serialize/toText.ts:99 와 같은 규칙).
  const hasAttachmentBlock = doc.blocks.some((b) => b.k === "attachmentList");
  let wroteFooter = false;

  for (const b of doc.blocks) {
    switch (b.k) {
      case "officialHeader":
        out.push(...headTable(ctx, m));
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
      case "pageBreak":
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
  return { ...r, base, lineSpacing: ctx.reg.paraPrInfo(r.paraPr)?.lineSpacing ?? BODY_LINE_SPACING };
}

/**
 * 본문 문단 — 참고 문서의 paraPr 27 / charPr 8 을 그대로 쓴다(표준 서식의 본문 줄).
 * 글머리 기호는 문단 여백이 아니라 앞 반각 공백으로 들여쓴다(다른 family 와 같은 관행,
 * lib/docmodel/indent.ts). 공문서 사다리는 편람의 2타(□0 ㅇ2 -4 ·6)다.
 */
function bodyPara(ctx: WriterContext, b: ParaBlock): XmlNode {
  const s = roleSpec(ctx, "body");
  const glyph = b.glyph && b.glyph !== "none" ? b.glyph : undefined;
  const prefix = " ".repeat(b.indent ?? leadingSpaces("official", b.glyph, b.role)) + (glyph ? `${glyph} ` : "");
  const inlines: Inline[] = prefix ? [{ t: "text", text: prefix }, ...b.inlines] : b.inlines;
  return ctx.para({ paraPr: s.paraPr, runs: ctx.runsFor(inlines, s.base, s.charPr), vertsize: s.base.pt * 100, lineSpacing: s.lineSpacing, forcePageBreak: b.pageBreakBefore });
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
    return ctx.para({ paraPr: s.paraPr, runs: [{ charPr: s.charPr, text }], vertsize: s.base.pt * 100, lineSpacing: s.lineSpacing });
  });
}

// ---- 두문 --------------------------------------------------------------------------------

function headTable(ctx: WriterContext, m: OfficialMeta): XmlNode[] {
  const ref = loadGeometry(ctx.tpl.dir, "t00");
  if (!ref) {
    ctx.warnings.push({ message: "official template geometry t00 missing; 두문 표를 생략했습니다" });
    return [];
  }
  const head = tableOnly(cloneFragment(ref, ctx.ids));
  setCellText(head, ...HEAD_수신, 수신값(m));
  setCellText(head, ...HEAD_경유, m.경유);
  setCellText(head, ...HEAD_제목, m.제목);
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

  setCellText(foot, ...FOOT_발신명의, 발신명의(ctx, m));

  // 수신자 목록은 `수신자참조` 일 때만 — 아니면 라벨까지 비워 참고 문서의 목록이 남지 않게 한다
  const 참조 = m.수신유형 === "수신자참조";
  setCellText(foot, ...FOOT_수신자라벨, 참조 ? "수신자" : "");
  setCellText(foot, ...FOOT_수신자, 참조 ? (m.수신자 ?? []).join(", ") : "");

  const line = m.결재라인.length ? m.결재라인 : approvalLineFor(m.처리과);
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
 * 결문 발신명의 칸은 직위(`경영기획실장`)를 쓴다 — 사람 이름이 아니다.
 * 비어 있으면 처리과가 속한 실·단 이름에 `장`을 붙여 만든다(`전략기획팀` → `경영기획실장`).
 */
function 발신명의(ctx: WriterContext, m: OfficialMeta): string {
  if (m.발신명의.trim()) return m.발신명의.trim();
  const unit = departmentFullName(m.처리과);
  const derived = unit ? (unit.endsWith("장") ? unit : `${unit}장`) : "";
  ctx.warnings.push({ message: derived ? `발신명의가 비어 있어 처리과 "${m.처리과}"에서 "${derived}"로 채웠습니다` : `발신명의가 비어 있고 처리과 "${m.처리과}"로 부서를 찾지 못해 빈 칸으로 두었습니다` });
  return derived;
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
