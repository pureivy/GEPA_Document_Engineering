/**
 * 장·절이 애매하게 쪼개진 쪽 찾기 — 앞 장(절)의 끝 문단 한두 개만 다음 쪽 맨 위로 넘어가고 그 아래에서 바로 다음 장이 시작하는 경우.
 *
 * 결과보고서 Ⅰ 사업개요의 끝 두 줄((지급방법), ※ 근거)이 3쪽 맨 위로 넘어가고 그 아래에서 Ⅱ 추진결과가 시작했다.
 * 담당자는 ※ 근거 줄을 빼서 Ⅰ 을 2쪽에 끝내고 Ⅱ 를 3쪽 첫머리에서 시작하게 고쳤다(2026-10-21). 줄 간격으로는 문단 두세 개를
 * 당겨 올 수 없다(keepPass 의 당기기는 끝 한두 줄까지) — 중요하지 않은 줄을 빼거나 줄이는 판단이 필요해 경고로 에이전트에게 돌려준다.
 *
 * 한글이 읽어 준 쪽별 글(hangul.ts)을 쓴다: 문단마다 한 줄, 표만 든 문단(장 띠 Ⅱ·절 칩 1)은 빈 줄이다.
 * 빈 줄 다음이 □ 제목이거나 절의 첫 줄 `(계 획)` 이면 그 빈 줄은 새 장·절의 띠로 본다. 본문이 표로 이어지는 넘김은 잡지 않는다.
 */

/** 이만큼 이하의 문단만 넘어왔으면 쪼개진 것으로 본다 */
const MAX_SPILL = 3;

const NEW_BLOCK = /^\s*(□|[ⅠⅡⅢⅣⅤⅥⅦⅧ]\s|[○ㅇ]\s*\(계\s*획\))/;

export interface PageSplit {
  /** 1부터 */
  page: number;
  /** 넘어온 문단 수 */
  spilled: number;
  /** 넘어온 첫 문단 앞부분 */
  head: string;
}

export function findPageSplits(pageTexts: string[]): PageSplit[] {
  const out: PageSplit[] = [];
  for (let p = 1; p < pageTexts.length; p++) {
    const lines = pageTexts[p].split(/\r?\n/).map((l) => l.trimEnd());
    // 표지 다음 쪽 맨 위의 문서 제목(「…」 결과보고)은 넘어온 문단이 아니다
    if (/^\s*「/.test(lines[0] ?? "")) continue;
    let i = 0;
    while (i < lines.length && lines[i].trim() !== "" && !NEW_BLOCK.test(lines[i])) i++;
    if (i === 0 || i > MAX_SPILL || i >= lines.length) continue;
    // 넘어온 문단 아래: (빈 줄 = 띠) 다음 첫 글 줄이 새 장·절이어야 한다
    let k = i;
    while (k < lines.length && lines[k].trim() === "") k++;
    if (k === i && !NEW_BLOCK.test(lines[i])) continue;
    if (k >= lines.length || !NEW_BLOCK.test(lines[k])) continue;
    out.push({ page: p + 1, spilled: i, head: lines[0].trim().slice(0, 24) });
  }
  return out;
}

export function pageSplitWarnings(pageTexts: string[]): string[] {
  return findPageSplits(pageTexts).map(
    (s) =>
      `[쪽 나눔] ${s.page}쪽 맨 위에 앞 장·절의 끝 ${s.spilled}문단("${s.head}…")만 넘어오고 그 아래에서 다음 장·절이 시작한다 — 중요하지 않은 줄(근거 문서번호, 되풀이, 경위)을 빼거나 줄여 앞 쪽에서 끝나게 한다. 필요한 내용은 빼지 않는다`,
  );
}
