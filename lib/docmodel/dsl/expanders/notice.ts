/**
 * 공고문 expander (grammar rule 13): the 6-1 skeleton's fixed front part is synthesized from
 * front-matter so the writer model only authors sections 3+.
 *
 *   noticeHeader → infoBox(meta.접수) → pageBreak → image logo → sectionBar 1 모집개요 →
 *   overviewTable(meta.모집개요) → sectionBar 2 지원절차 → procedureFlow(meta.절차도) →
 *   note ※ 상기 일정은 추진 상황에 따라 변경될 수 있음
 */
import type { Inline, NoticeMeta } from "../../schema";
import { NOTICE_안내박스, NOTICE_일정변경 } from "../../boilerplate/notice";
import { parseInlines } from "../inline";
import type { BlockInput, FamilyContext } from "./types";

export const NOTICE_FIRST_SECTION = 3;
export const NOTICE_LOGO = { asset: "logo", widthMm: 92.3, heightMm: 13.3 } as const;

function text(t: string): Inline {
  return { t: "text", text: t };
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}

export function noticeInfoBox(meta: NoticeMeta): Extract<BlockInput, { k: "infoBox" }> {
  const a = meta.접수;
  const vars = { 이메일: a.이메일, 우편주소: a.우편주소, 부서명: a.부서명, 전화: a.전화 };
  return {
    k: "infoBox",
    groups: [
      {
        heading: NOTICE_안내박스.접수방법.heading,
        items: [[text(fill(NOTICE_안내박스.접수방법.이메일, vars))], [text(fill(NOTICE_안내박스.접수방법.우편, vars))]],
      },
      {
        heading: NOTICE_안내박스.문의.heading,
        items: [
          [text(NOTICE_안내박스.문의.작성문의), { t: "br" }, text(fill(NOTICE_안내박스.문의.작성문의_2행, vars))],
          [text(NOTICE_안내박스.문의.이의제기)],
        ],
      },
      { heading: NOTICE_안내박스.선정결과통보.heading, items: [[text(a.선정결과통보)]] },
    ],
  };
}

export function noticeOverviewTable(meta: NoticeMeta): Extract<BlockInput, { k: "overviewTable" }> {
  return {
    k: "overviewTable",
    rows: meta.모집개요.map((r) => {
      if (r === "spacer") return "spacer" as const;
      const row: { label: string; value: Inline[]; bullet?: boolean } = { label: r.라벨, value: parseInlines(r.값).inlines };
      if (r.불릿 !== undefined) row.bullet = r.불릿;
      return row;
    }),
  };
}

export function noticeProcedureFlow(meta: NoticeMeta): Extract<BlockInput, { k: "procedureFlow" }> {
  return { k: "procedureFlow", stages: meta.절차도.map((s) => ({ name: s.단계, when: s.일정 })) };
}

export function noticePrelude(meta: NoticeMeta): BlockInput[] {
  const blocks: BlockInput[] = [
    { k: "noticeHeader" },
    noticeInfoBox(meta),
    { k: "pageBreak" },
  ];
  if (meta.로고 !== false) blocks.push({ k: "image", asset: NOTICE_LOGO.asset, widthMm: NOTICE_LOGO.widthMm, heightMm: NOTICE_LOGO.heightMm, align: "left" });
  blocks.push(
    { k: "sectionBar", number: 1, title: "모집개요" },
    noticeOverviewTable(meta),
    { k: "sectionBar", number: 2, title: "지원절차" },
    noticeProcedureFlow(meta),
    { k: "para", role: "note", glyph: "※", indent: 0, inlines: [text(NOTICE_일정변경)] },
  );
  return blocks;
}

export function noticeContext(meta: NoticeMeta): FamilyContext {
  return { prelude: noticePrelude(meta), firstSectionNumber: NOTICE_FIRST_SECTION, plainRole: "plain", allowHeadings: true };
}
