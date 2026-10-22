/**
 * 전년 문장 옮겨 쓰기 찾기 — 결과보고서 Ⅳ(성과 및 총평)의 문장이 전년도 참고자료(prior/)에 그대로 있으면 경고.
 *
 * 계속사업은 지난해 결과보고서를 함께 올린다(담당자 2026-10-22). 비교에는 좋지만 지난해 성과·총평 문장을 올해
 * 것으로 옮기기 쉽다(result-writing.md §2-5 「다른 사업 총평의 복붙」). Ⅰ·Ⅱ 의 계획서 문장(추진절차·선정방법)은
 * 해마다 같은 것이 맞으므로 보지 않는다 — 올해 판단이 담겨야 하는 Ⅳ 만 본다.
 */

/** 이보다 짧은 문장은 우연히 같을 수 있다("만족도 조사 실시") */
const MIN_CHARS = 20;

const CHAPTER = /^#\s+(.+)$/;
const LEAD = /^\s*(?:[□ㅇ○❍\-·※◇]|\d+\)|[가-하]\.)\s*/;

/** 띄어쓰기·문장부호·글머리를 지우고 견준다 — 줄바꿈 위치나 쉼표가 달라도 같은 문장으로 본다 */
function norm(s: string): string {
  return s.replace(/[\s.,·:;'"‘’“”()（）「」『』\-–—~]/g, "");
}

export interface PriorCopy {
  line: number;
  text: string;
}

export function findPriorCopies(dsl: string, priorTexts: string[]): PriorCopy[] {
  if (!priorTexts.length) return [];
  const corpus = norm(priorTexts.join("\n"));
  const out: PriorCopy[] = [];
  let inResults = false;
  const lines = dsl.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const ch = CHAPTER.exec(raw);
    if (ch) {
      inResults = /성과|총평/.test(ch[1]);
      return;
    }
    if (!inResults || /^\s*(\||\{|```)/.test(raw)) return;
    const body = raw.replace(LEAD, "").trim();
    const key = norm(body);
    if (key.length >= MIN_CHARS && corpus.includes(key)) out.push({ line: i + 1, text: body });
  });
  return out;
}

export function priorCopyWarnings(dsl: string, priorTexts: string[]): string[] {
  return findPriorCopies(dsl, priorTexts).map(
    (c) => `[전년 문장] ${c.line}행 "${c.text.slice(0, 30)}…" — 지난해 결과보고서와 같은 문장이다. 올해 사실과 수치로 다시 쓴다(지난해 성과·총평을 옮기지 않는다)`,
  );
}
