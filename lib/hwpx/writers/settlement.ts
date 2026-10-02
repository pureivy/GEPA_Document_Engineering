/**
 * 정산보고서 작성기 — 「지방위탁사업비 사업추진실적 및 정산보고서」.
 *
 * 참고본은 담당자가 실제로 낸 정산보고서다(ESG·기업지원팀, 2025 향토뿌리기업 육성 사업, 2025. 12.).
 * 문단은 **참고본의 문단·글자 모양 id 를 그대로** 쓴다(report.ts 와 같은 방식) — 함초롬바탕 13pt 본문,
 * HY헤드라인M 22pt 제목, 줄간격 195% 와 내어쓰기가 참고본에 손으로 맞춰져 있어서 새로 합성하면 어긋난다.
 * 모양만 쓰고 글은 쓰지 않는다: 템플릿 패키지의 본문은 비워 두었고(개인정보), 장 띠·연락처 상자 두 조각만
 * 자리표시 글로 바꿔 geometry 에 남겼다(templates/settlement/README.md).
 *
 *   표지 구역(첫 `#` 앞) : ○ 사업명 줄 15pt, (단위) 12pt 오른쪽, 날짜 오른쪽·제출자 가운데, ```box = 연락처 점선 상자
 *   `#`                  : "1. │ 제목" 장 띠(geometry/t02)
 *   `##`                 : 󰊱 절 제목(HY헤드라인M 16pt)
 *   ① 로 시작하는 줄      : 하위 제목(15pt 굵게)
 *   ❍ (사업비) … (집행액: N원) : 세부사업 머리(13pt 굵게 + 괄호 11pt)
 *   표                    : 칸 채움 없음, 머리 위·마지막 아래 0.4mm, 바깥 좌우 선 없음, 함초롬바탕 12pt
 */
import { child, childrenNamed, clone, el, isNode, type XmlNode } from "../xml";
import { cellAt, cloneFragment, loadGeometry, setCellText } from "../geometry";
import { emitBlank, emitTable, type FamilyStyle } from "./common";
import { leadingSpaces } from "../../docmodel/indent";
import { inlineText, type Block, type Inline, type SettlementDoc } from "../../docmodel/schema";
import type { RunSpec } from "../emit/paragraph";
import { WriterContext } from "./context";

type ParaBlock = Extract<Block, { k: "para" }>;

/** 참고본 header.xml 의 모양 id(실측) — templates/settlement/style-map.json 과 같은 값 */
const S = {
  title: { paraPr: 33, charPr: 7 },
  coverItem: { paraPr: 34, charPr: 14 },
  coverUnit: { paraPr: 35, charPr: 16 },
  coverPlain: { paraPr: 36, charPr: 38 },
  coverNote: { paraPr: 28, charPr: 17 },
  coverNoteLine: { paraPr: 36, charPr: 17 },
  section: { paraPr: 77, charPr: 59 },
  sub: { paraPr: 101, charPr: 51 },
  body1: { paraPr: 90, charPr: 17 },
  body2: { paraPr: 91, charPr: 17 },
  body3: { paraPr: 91, charPr: 17 },
  group: { paraPr: 104, charPr: 53 },
  groupAmount: { charPr: 82 },
  unit: { paraPr: 98, charPr: 73 },
  note: { paraPr: 28, charPr: 17 },
} as const;

/** 참고본 절 번호 글자(󰊱 󰊲 …) — 한컴 PUA. 참고본의 "󰊳 사업 및 소요경비배분 변경내역" 그대로 */
const SECTION_DIGITS = ["󰊱", "󰊲", "󰊳", "󰊴", "󰊵", "󰊶", "󰊷", "󰊸", "󰊹"];

const TABLE_STYLE: FamilyStyle = {
  bodyPt: 13,
  bodyLineSpacing: 195,
  body1Bold: false,
  body1Font: "body",
  notePt: 12,
  tableHeaderFill: "#FFFFFF",
  tableFontPt: 12,
  hangingIndent: true,
  tableFont: "함초롬바탕",
  anchorFont: "함초롬바탕",
  // 참고본 표: 칸 채움 없음, 머리 위·마지막 아래 굵은 선(0.4mm), 바깥 좌우 선 없음
  tableLook: { headerFill: "#FFFFFF", totalFill: "#FFFFFF", headerTopMm: 0.4, lastBottomMm: 0.4, frame: "grid", outerSidesNone: true, lineSpacing: 130, padding: "tight" },
  numericRight: true,
};

export function writeSettlement(ctx: WriterContext, doc: SettlementDoc): XmlNode[] {
  const out: XmlNode[] = [];
  let cover = true; // 첫 `#` 앞은 표지
  let sectionNo = 0;
  for (const b of doc.blocks) {
    switch (b.k) {
      case "coverTitle":
        out.push(ctx.para({ paraPr: S.title.paraPr, runs: [{ charPr: S.title.charPr, text: inlineText(b.inlines) }], vertsize: 2200, lineSpacing: 160 }));
        out.push(blank(ctx));
        break;
      case "chapterBand": {
        cover = false;
        sectionNo = 0;
        out.push(...chapterBand(ctx, b.numeral, b.title));
        break;
      }
      case "sectionChip": {
        const digit = SECTION_DIGITS[sectionNo++] ?? `${sectionNo}.`;
        out.push(blank(ctx));
        out.push(ctx.para({ paraPr: S.section.paraPr, runs: [{ charPr: S.section.charPr, text: `${digit} ${b.title}` }], vertsize: 1600, lineSpacing: 190 }));
        break;
      }
      case "para":
        out.push(cover ? coverPara(ctx, b) : bodyPara(ctx, b));
        break;
      case "summaryBox":
        out.push(contactBox(ctx, b.lines.map((l) => inlineText(l))));
        break;
      case "table":
        out.push(...emitTable(ctx, TABLE_STYLE, b));
        break;
      case "blank":
        out.push(blank(ctx));
        break;
      case "pageBreak":
        ctx.pendingPageBreak = true;
        break;
      case "attachmentList":
        // 서식 문서라 붙임 블록을 쓰지 않는다 — 들어오면 본문 줄로 내보낸다
        for (const it of b.items) out.push(ctx.para({ paraPr: S.body2.paraPr, runs: [{ charPr: S.body2.charPr, text: `  ${it}` }] }));
        break;
      default:
        ctx.warnings.push({ blockId: b.id, message: `block kind "${b.k}" is not supported in 정산보고서; skipped` });
    }
  }
  return out;
}

function blank(ctx: WriterContext): XmlNode {
  return emitBlank(ctx, TABLE_STYLE, true);
}

function runs(ctx: WriterContext, inlines: Inline[], charPr: number, prefix = ""): RunSpec[] {
  const r = ctx.runsFor(inlines, ctx.reg.charPrInfo(charPr) ? specOf(ctx, charPr) : { font: "함초롬바탕", pt: 13 }, charPr);
  if (prefix) r.unshift({ charPr, text: prefix });
  return r;
}

/** 맺어진 글자 모양의 기준값 — 굵게 같은 인라인 변형을 같은 글꼴에서 파생하려고 읽는다 */
function specOf(ctx: WriterContext, charPr: number) {
  const i = ctx.reg.charPrInfo(charPr)!;
  return { font: i.hangul, pt: i.pt, bold: i.bold };
}

/** 표지 구역의 문단 — 사업명 줄(○), (단위), 날짜·제출자, ※ 첨부서류 */
function coverPara(ctx: WriterContext, b: ParaBlock): XmlNode {
  const text = inlineText(b.inlines).trim();
  if (b.role === "unitCaption") return ctx.para({ paraPr: S.coverUnit.paraPr, runs: [{ charPr: S.coverUnit.charPr, text }], vertsize: 1200, lineSpacing: 160 });
  if (b.glyph === "○" || b.glyph === "ㅇ" || b.glyph === "◦") return ctx.para({ paraPr: S.coverItem.paraPr, runs: runs(ctx, b.inlines, S.coverItem.charPr, "○ "), vertsize: 1500, lineSpacing: 160 });
  if (b.glyph === "※") return ctx.para({ paraPr: S.coverNote.paraPr, runs: runs(ctx, b.inlines, S.coverNote.charPr, "※ "), vertsize: 1300, lineSpacing: 160 });
  // 제출일(오른쪽)·제출자(가운데)·귀하(오른쪽) — 참고본은 공백으로 밀었지만 정렬로 맞춘다(글자 수가 바뀌어도 자리가 유지된다)
  const right = /^\d{4}년\s*\d{0,2}\s*월/.test(text) || /귀하$/.test(text);
  const center = /^제출자/.test(text) || /^대표자/.test(text);
  if (right || center) {
    const paraPr = ctx.reg.paraPr({ align: right ? "RIGHT" : "CENTER", lineSpacing: 160, prev: right ? 1000 : 600 });
    return ctx.para({ paraPr, runs: runs(ctx, b.inlines, S.coverPlain.charPr), vertsize: 1400, lineSpacing: 160 });
  }
  if (/^\s*[①-⑩]/.test(text)) return ctx.para({ paraPr: S.coverNoteLine.paraPr, runs: runs(ctx, b.inlines, S.coverNoteLine.charPr, "   "), vertsize: 1300, lineSpacing: 160 });
  return ctx.para({ paraPr: S.coverItem.paraPr, runs: runs(ctx, b.inlines, S.coverItem.charPr), vertsize: 1500, lineSpacing: 160 });
}

/** 본문 문단 — □ ○ - ❍ ※ (단위) ① */
function bodyPara(ctx: WriterContext, b: ParaBlock): XmlNode {
  const text = inlineText(b.inlines);
  if (b.role === "unitCaption") return ctx.para({ paraPr: S.unit.paraPr, runs: [{ charPr: S.unit.charPr, text: text.trim() }], vertsize: 800, lineSpacing: 200 });
  if (b.glyph === "※" || b.glyph === "*") return ctx.para({ paraPr: S.note.paraPr, runs: runs(ctx, b.inlines, S.note.charPr, `  ${b.glyph} `), vertsize: 1300, lineSpacing: 160 });
  if (b.glyph === "❍") return groupHead(ctx, b.inlines);
  if (!b.glyph && /^\s*[①-⑩]/.test(text)) return ctx.para({ paraPr: S.sub.paraPr, runs: runs(ctx, b.inlines, S.sub.charPr, "  "), vertsize: 1500, lineSpacing: 200 });
  const role = b.role === "body1" ? S.body1 : b.role === "body3" || b.role === "body4" ? S.body3 : S.body2;
  const glyph = b.glyph && b.glyph !== "none" ? b.glyph : "";
  const spaces = " ".repeat(glyph ? leadingSpaces("settlement", b.glyph, b.role) : 0);
  return ctx.para({ paraPr: role.paraPr, runs: runs(ctx, b.inlines, role.charPr, glyph ? `${spaces}${glyph} ` : ""), vertsize: 1300, lineSpacing: 195 });
}

/** ❍ (사업비) 세부사업명(집행액: N원) — 괄호 부분은 11pt 로 작게(참고본 그대로) */
function groupHead(ctx: WriterContext, inlines: Inline[]): XmlNode {
  const text = inlineText(inlines).trim();
  const m = /^(.*?)(\(집행액[^)]*\))\s*$/.exec(text);
  const head = m ? m[1] : text;
  const r: RunSpec[] = [{ charPr: S.group.charPr, text: `   ❍ ${head}` }];
  if (m) r.push({ charPr: S.groupAmount.charPr, text: m[2] });
  return ctx.para({ paraPr: S.group.paraPr, runs: r, vertsize: 1300, lineSpacing: 200 });
}

/** "1. │ 제목" 장 띠 — 참고본 t02(1×2 표)를 복제해 번호·제목을 넣는다 */
function chapterBand(ctx: WriterContext, numeral: string, title: string): XmlNode[] {
  const ref = loadGeometry(ctx.tpl.dir, "chapter");
  if (!ref) {
    ctx.warnings.push({ message: "settlement geometry/chapter.xml 이 없어 장 띠를 글로 대신합니다" });
    return [ctx.para({ paraPr: S.section.paraPr, runs: [{ charPr: S.section.charPr, text: `${numeral}. ${title}` }] })];
  }
  const frag = cloneFragment(ref, ctx.ids);
  setCellText(frag, 0, 0, `${numeral.replace(/\.$/, "")}.`);
  setCellText(frag, 0, 1, ` ${title}`);
  if (ctx.pendingPageBreak) {
    frag.attrs.pageBreak = "1";
    ctx.pendingPageBreak = false;
  }
  return [frag];
}

/**
 * 연락처 점선 상자 — 참고본 t01(1×1, DASH 0.1mm)을 복제하고 줄마다 첫 문단을 복제해 채운다.
 * ```box 의 줄이 그대로 상자 안의 줄이 된다(❍ 실무책임자 / ❍ 연 락 처 / ❍ 주 소).
 */
function contactBox(ctx: WriterContext, lines: string[]): XmlNode {
  const ref = loadGeometry(ctx.tpl.dir, "contact");
  if (!ref) {
    ctx.warnings.push({ message: "settlement geometry/contact.xml 이 없어 연락처를 글로 대신합니다" });
    return ctx.para({ paraPr: S.coverItem.paraPr, runs: [{ charPr: S.coverItem.charPr, text: lines.join(" / ") }] });
  }
  const frag = cloneFragment(ref, ctx.ids);
  const cell = cellAt(frag, 0, 0);
  const sl = cell ? child(cell, "hp:subList") : undefined;
  if (!sl) {
    setCellText(frag, 0, 0, lines.join("\n"));
    return frag;
  }
  const proto = childrenNamed(sl, "hp:p")[0];
  const charPr = childrenNamed(proto, "hp:run")[0]?.attrs.charPrIDRef ?? "0";
  sl.children = sl.children.filter((c) => !(isNode(c) && c.name === "hp:p"));
  for (const line of lines) {
    const p = clone(proto);
    p.attrs.id = String(ctx.ids.nextParaId());
    p.children = p.children.filter((c) => !(isNode(c) && (c.name === "hp:run" || c.name === "hp:linesegarray")));
    p.children.unshift(el("hp:run", { charPrIDRef: charPr }, [el("hp:t", {}, [` ${line.replace(/^\s*/, "")}`])]));
    sl.children.push(p);
  }
  if (ctx.pendingPageBreak) {
    frag.attrs.pageBreak = "1";
    ctx.pendingPageBreak = false;
  }
  return frag;
}
