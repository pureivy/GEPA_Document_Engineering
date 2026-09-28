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
import { approvalLineFor, approvalLineUpTo, departmentFullName, senderTitleFor } from "../../org";
import { leadingSpaces, manualMarkerIndent } from "../../docmodel/indent";
import { inlineText, officialMetaProblems, type Block, type Inline, type OfficialDoc, type OfficialMeta } from "../../docmodel/schema";
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
  return { ...r, base, lineSpacing: ctx.reg.paraPrInfo(r.paraPr)?.lineSpacing ?? BODY_LINE_SPACING };
}

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
  return ctx.para({ paraPr: s.paraPr, runs: ctx.runsFor(bodyInlines(b), s.base, s.charPr), vertsize: s.base.pt * 100, lineSpacing: s.lineSpacing, forcePageBreak: b.pageBreakBefore });
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
