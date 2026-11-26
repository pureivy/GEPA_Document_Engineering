/**
 * 새로 쓰기 뒷정리 — 원본 여기저기의 문단을 제자리에서 고쳐 쓰고 나머지를 지우면, 지운 내용 사이에 있던 띄움 문단·쪽 나눔과
 * 고정된 표 높이가 남는다.
 *
 * 2026-11-26 「'모두의 성장' 추진」(행정안전부 업무보고 양식, 새로 쓰기): 내용은 맞게 바뀌었는데 ① 「-」 줄 사이에 빈 문단 15개가
 * 남아 쪽 가운데가 비었고 ② Ⅲ장 첫머리의 단 나눔(columnBreak)이 빈 문단에 남아 4쪽이 거의 빈 채 넘어갔고 ③ 표지 뒤 빈 줄이
 * 다음 쪽 위를 비웠고 ④ ✔ 상자는 원본 줄 수에 맞춘 높이 그대로라 위가 비었다.
 *
 * 그래서 새로 쓰기 결과에서만:
 *  - 표지(맨 앞 빈 줄들 뒤의 첫 표)는 그대로 두고, 표지 뒤 빈 줄은 지우고 본문 첫 문단을 새 쪽에서 시작한다.
 *  - 본문의 빈 문단이 잇달아 있으면 하나만 남기고, 남는 빈 문단의 쪽·단 나눔은 푼다. 문서 끝 빈 문단은 지운다.
 *  - 본문 표의 칸 높이를 풀어 한글이 글에 맞춰 다시 재게 한다.
 * 표 칸 안은 건드리지 않는다(칸의 하나뿐인 문단을 지우면 표가 깨진다).
 */
import { paragraphText, readTemplate, type TParagraph, type TemplateDoc } from "./engine";
import { repack } from "./fit";

/** 칸 높이를 이 값(HWPUNIT, 약 0.35mm)으로 내리면 한글이 글 높이만큼 늘린다 */
const MIN_CELL = 100;

function isEmptyTop(doc: TemplateDoc, p: TParagraph): boolean {
  return p.parent === undefined && !p.cell && !p.tables.length && !p.hasObject && !p.hasSecPr && paragraphText(p).trim() === "";
}

export function tidyNewWriting(bytes: Uint8Array): { bytes: Uint8Array; notes: string[] } {
  const doc = readTemplate(bytes);
  const notes: string[] = [];
  const sections = [...doc.sections];
  // 구역마다 바깥 문단만 차례로
  const ops: { section: number; start: number; end: number; str: string }[] = [];
  let removed = 0;
  let unbroken = 0;
  let coverTable: TParagraph | undefined;
  let breakBefore: TParagraph | undefined;
  for (let s = 0; s < doc.sections.length; s++) {
    const top = doc.paragraphs.filter((p) => p.section === s && p.parent === undefined);
    const firstContent = top.findIndex((p) => !isEmptyTop(doc, p) && !p.hasSecPr);
    // 표지: 첫 구역에서 빈 줄 몇 개(세로 가운데 맞춤) 뒤에 오는 첫 내용이 표
    let i0 = 0;
    if (s === 0 && firstContent >= 3 && top[firstContent].tables.length) {
      coverTable = top[firstContent];
      let j = firstContent + 1;
      while (j < top.length && isEmptyTop(doc, top[j])) {
        ops.push({ section: s, start: top[j].start, end: top[j].end, str: "" });
        removed++;
        j++;
      }
      if (j < top.length) breakBefore = top[j];
      i0 = j;
    } else if (firstContent >= 0) {
      i0 = firstContent;
    }
    let lastContent = -1;
    for (let k = top.length - 1; k >= 0; k--)
      if (!isEmptyTop(doc, top[k])) {
        lastContent = k;
        break;
      }
    for (let k = i0; k < top.length; k++) {
      const p = top[k];
      if (!isEmptyTop(doc, p)) continue;
      const prevEmpty = k > i0 && isEmptyTop(doc, top[k - 1]); // 잇단 빈 문단은 첫 하나만 남긴다
      if (k > lastContent || prevEmpty) {
        ops.push({ section: s, start: p.start, end: p.end, str: "" });
        removed++;
        continue;
      }
      const head = /^<hp:p\b[^>]*>/.exec(sections[s].slice(p.start, p.end))?.[0] ?? "";
      if (/(pageBreak|columnBreak)="1"/.test(head)) {
        ops.push({ section: s, start: p.start, end: p.start + head.length, str: head.replace(/(pageBreak|columnBreak)="1"/g, '$1="0"') });
        unbroken++;
      }
    }
  }
  // 본문 첫 문단은 새 쪽에서
  if (breakBefore) {
    const s = breakBefore.section;
    const head = /^<hp:p\b[^>]*>/.exec(sections[s].slice(breakBefore.start, breakBefore.end))?.[0] ?? "";
    if (head && !/pageBreak="1"/.test(head)) ops.push({ section: s, start: breakBefore.start, end: breakBefore.start + head.length, str: head.replace(/pageBreak="0"/, 'pageBreak="1"') });
  }
  // 본문 표의 칸 높이 풀기 — 표지 표는 둔다
  let tables = 0;
  for (const p of doc.paragraphs) {
    if (p.parent !== undefined || !p.tables.length || p === coverTable) continue;
    if (ops.some((o) => o.section === p.section && o.start === p.start && o.str === "")) continue;
    const s = p.section;
    const head = /^<hp:p\b[^>]*>/.exec(sections[s].slice(p.start, p.end))?.[0] ?? "";
    let body = sections[s].slice(p.start + head.length, p.end);
    body = body.replace(/<hp:cellSz\b([^>]*)\/>/g, (_, a: string) => `<hp:cellSz${a.replace(/height="\d+"/, `height="${MIN_CELL}"`)}/>`);
    body = body.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, "");
    ops.push({ section: s, start: p.start + head.length, end: p.end, str: body });
    tables++;
  }
  // 겹치지 않게 뒤에서부터(같은 문단의 머리 바꾸기와 몸 바꾸기는 범위가 나뉜다)
  ops.sort((a, b) => (a.section - b.section) || (b.start - a.start));
  for (const o of ops) sections[o.section] = sections[o.section].slice(0, o.start) + o.str + sections[o.section].slice(o.end);
  if (removed) notes.push(`빈 문단 ${removed}개 지움(지운 원본 사이에 남은 띄움 줄)`);
  if (unbroken) notes.push(`남은 쪽·단 나눔 ${unbroken}곳 풂`);
  if (breakBefore) notes.push("표지 뒤 본문을 새 쪽에서 시작");
  if (tables) notes.push(`본문 표 ${tables}개 칸 높이를 글에 맞춤`);
  return { bytes: repack(doc.entries, doc.sectionNames, sections), notes };
}
