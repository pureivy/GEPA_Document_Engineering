/**
 * 공고문 expander (grammar rule 13): the 6-1 skeleton's fixed front part is synthesized from
 * front-matter so the writer model only authors sections 3+.
 *
 *   noticeHeader → infoBox(meta.접수) → image logo(page-bottom) → pageBreak → sectionBar 1 모집개요 →
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
        // 이의제기 문구는 본문 "9. 기타 유의사항"의 {{boilerplate:이의제기}}로만 두고 안내박스에서는 뺀다(user 2026-09-16: 안내박스 항목 축소)
        items: [[text(NOTICE_안내박스.문의.작성문의), { t: "br" }, text(fill(NOTICE_안내박스.문의.작성문의_2행, vars))]],
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
  // 표지(1쪽): 공고 머리 → 안내박스 → GEPA 로고(쪽 아래 고정) → 쪽 나눔 (user 2026-09-16: 로고는 반드시 1쪽 하단에)
  const blocks: BlockInput[] = [{ k: "noticeHeader" }, noticeInfoBox(meta)];
  if (meta.로고 !== false) blocks.push({ k: "image", asset: NOTICE_LOGO.asset, widthMm: NOTICE_LOGO.widthMm, heightMm: NOTICE_LOGO.heightMm, align: "center", position: "pageBottom" });
  blocks.push({ k: "pageBreak" });
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
  // numeralStyle 은 headingStyle "chapterChip" 인 family 만 읽는다(parser.ts). 공고문은
  // "sectionBar" 라 `#` 이 번호 섹션바로 가므로 이 값에 닿지 않는다.
  return { prelude: noticePrelude(meta), firstSectionNumber: NOTICE_FIRST_SECTION, plainRole: "plain", allowHeadings: true, numeralStyle: "roman" };
}
