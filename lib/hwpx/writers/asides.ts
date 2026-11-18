/**
 * 앞말을 설명하는 괄호 — 「공감플러스(경북 안동시)」「금19,450,000원(부가가치세 포함)」의 괄호 부분은 본문보다 2pt 작게.
 *
 * 담당자 2026-11-18: "볼드 처리한 (디자인 시안) 이런 부분 말고, 공감플러스(경북 안동시)처럼 괄호 안에 들어가 있는 부분 있잖아.
 * 앞 내용을 설명하는 부분. 이런 건 글자 크기를 본문보다 2 작게 줄이면 좋아."
 *
 * 앞말에 붙은 괄호만 본다 — 줄 머리의 `(디자인 시안)` 같은 머리말은 앞이 빈칸이라 걸리지 않는다. 요일 `(목)`, `(안)`,
 * 법인 표기 `(재)` 처럼 이름·날짜의 한 부분인 괄호는 그대로 둔다. 굵게·크기를 따로 준 조각은 건드리지 않는다.
 */
import type { Inline } from "../../docmodel/schema";

/** 이름·날짜의 일부라 줄이지 않는 괄호 */
const KEEP = /^(?:[월화수목금토일]|안|재|사|주|유|농|[월화수목금토일]·?공휴일)$/;
const ASIDE = /(?<=\S)\(([^()\n]+)\)/g;

export const ASIDE_SHRINK_PT = 2;

export function shrinkAsides(inlines: Inline[], pt: number): Inline[] {
  const out: Inline[] = [];
  for (const inl of inlines) {
    if (inl.t !== "text" || inl.bold || inl.size) {
      out.push(inl);
      continue;
    }
    let last = 0;
    for (const m of inl.text.matchAll(ASIDE)) {
      if (KEEP.test(m[1].trim())) continue;
      const at = m.index ?? 0;
      if (at > last) out.push({ ...inl, text: inl.text.slice(last, at) });
      out.push({ ...inl, text: m[0], size: pt });
      last = at + m[0].length;
    }
    if (last === 0) out.push(inl);
    else if (last < inl.text.length) out.push({ ...inl, text: inl.text.slice(last) });
  }
  return out;
}
