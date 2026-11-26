/**
 * 원본 그대로 남은 문단 세기 — 장(Ⅰ. Ⅱ. …)마다 글자가 있는 문단 가운데 몇 개가 손대지 않은 채 남았는지.
 *
 * 담당자 2026-11-24: 행정안전부 업무보고 양식에 「2027년 '모두의 성장' 추진」을 쓰라고 했더니 Ⅱ장만 바뀌고
 * Ⅰ·Ⅲ·Ⅳ장(23쪽 중 18쪽)은 행안부 조직·과제·쟁점이 그대로 남았다. 결과 보고에는 아무 경고가 없었고, 쪽수가
 * 원본과 같아 겉으로는 잘된 것처럼 보였다. 모양만 빌린 양식(새로 쓰기)에서 원본 내용이 남는 것은 틀린 문서이므로
 * 플랫폼이 장별로 세어 경고한다. 고쳐 쓰기에서는 범위 밖이 그대로인 것이 정상이라 표로만 보인다.
 */
import { paragraphText, type ApplyResult, type TemplateDoc, type TemplateEdits } from "./engine";

export interface ChapterLeftover {
  /** 장 제목(앞 30자). 첫 장 제목 앞(표지·차례)은 「앞부분」 */
  title: string;
  /** 글자가 있는 문단 수 */
  total: number;
  /** 그중 고치지도 지우지도 않은 문단 수 */
  unchanged: number;
}

const CHAPTER = /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\s*\.\s*\S/;
/** 차례 줄 — 제목 뒤에 탭과 쪽 번호가 붙는다 */
const TOC_LINE = /\t\s*\d+\s*$/;
const DATE = /20\d\d\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\s*\./;

export function leftoverByChapter(doc: TemplateDoc, changes: ApplyResult["changes"]): { chapters: ChapterLeftover[]; staleDates: { p: number; text: string }[] } {
  const touched = new Set(changes.filter((c) => c.kind !== "넣음").map((c) => c.p));
  // 문단을 지우면 그 안(표·칸)의 문단도 함께 빠진다
  const deleted = changes.filter((c) => c.kind === "지움").map((c) => doc.paragraphs.find((p) => p.id === c.p)).filter((p) => !!p);
  const gone = (id: number) => {
    if (touched.has(id)) return true;
    const q = doc.paragraphs.find((p) => p.id === id)!;
    return deleted.some((d) => d.section === q.section && q.start >= d.start && q.end <= d.end);
  };
  const chapters: ChapterLeftover[] = [{ title: "앞부분", total: 0, unchanged: 0 }];
  const staleDates: { p: number; text: string }[] = [];
  for (const p of doc.paragraphs) {
    const text = paragraphText(p).trim();
    if (!text) continue;
    if (CHAPTER.test(text) && !TOC_LINE.test(paragraphText(p))) chapters.push({ title: text.replace(/\s+/g, " ").slice(0, 30), total: 0, unchanged: 0 });
    const ch = chapters[chapters.length - 1];
    ch.total++;
    if (!gone(p.id)) {
      ch.unchanged++;
      const m = DATE.exec(text);
      if (m) staleDates.push({ p: p.id, text: m[0] });
    }
  }
  return { chapters: chapters.filter((c) => c.total > 0), staleDates };
}

/** 이 비율 이상 원본이 남은 장은 새로 쓰기에서 경고한다(장 제목·빈 칸 머리 같은 틀 글자 몇 개는 남을 수 있다) */
export const LEFTOVER_WARN_RATIO = 0.3;

/** 새로 쓰기 결과의 경고 줄 — 장별 남은 비율, 원본 날짜 */
export function leftoverWarnings(r: ReturnType<typeof leftoverByChapter>): string[] {
  const out: string[] = [];
  for (const c of r.chapters) {
    if (c.title === "앞부분" && c.total < 3) continue;
    if (c.total >= 3 && c.unchanged / c.total >= LEFTOVER_WARN_RATIO)
      out.push(`[원본 그대로] ${c.title} — 글자 문단 ${c.total}개 중 ${c.unchanged}개(${Math.round((100 * c.unchanged) / c.total)}%)가 양식 원본 내용 그대로입니다. 모양만 빌린 양식이라 원본 내용이 남으면 안 됩니다 — 이번 내용으로 새로 쓰거나, 쓸 내용이 없으면 지워야 합니다`);
  }
  for (const d of r.staleDates.slice(0, 5)) out.push(`[원본 날짜] 문단 ${d.p}: 「${d.text}」가 양식 원본 날짜 그대로입니다`);
  return out;
}

/** changes.md 에 붙이는 장별 표 */
export function leftoverMarkdown(r: ReturnType<typeof leftoverByChapter>): string {
  if (!r.chapters.length) return "";
  return ["", "## 장별 원본 그대로 남은 문단", "", "| 장 | 글자 문단 | 원본 그대로 |", "|---|---|---|", ...r.chapters.map((c) => `| ${c.title.replace(/\|/g, "／")} | ${c.total} | ${c.unchanged} (${Math.round((100 * c.unchanged) / c.total)}%) |`), ""].join("\n");
}

/** 글머리·기호만 있는 칸 — 새로 쓰기에서도 모양으로 남긴다 */
const MARK_ONLY = /^[\s□■○●◦ㅇ\-–—․·•※*✔❖⇒→▶▷◆◇󰊱-󰊹ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ0-9.()（）]*$/u;

/**
 * 새로 쓰기: 고치거나 본떠 넣은 문단에서 AI가 적지 않은 칸에 원본 글자가 남으면 비운다.
 *
 * 2026-11-26 다시 돌린 「'모두의 성장' 추진」: 「□ 3대 분야 중심 정책과제 마련계승과 K-민주주의 확산」 — 앞 칸만 고치고 뒤 칸의
 * 행안부 글이 붙어 남았다. 문단은 「고침」으로 세어져 장별 검사에도 걸리지 않았다. 글머리·번호처럼 기호뿐인 칸은 모양이라 둔다.
 */
export function clearStaleRuns(doc: TemplateDoc, input: TemplateEdits): { edits: TemplateEdits; cleared: { p: number; text: string }[] } {
  const byId = new Map(doc.paragraphs.map((p) => [p.id, p]));
  const cleared: { p: number; text: string }[] = [];
  const edits = (Array.isArray(input.edits) ? input.edits : []).map((e) => {
    if (!e || typeof e !== "object" || !("runs" in e) || !e.runs || typeof e.runs !== "object") return e;
    const src = byId.get("insertAfter" in e ? e.like : e.p);
    if (!src) return e;
    const runs = { ...e.runs };
    src.runs.forEach((r, i) => {
      if (String(i) in runs || MARK_ONLY.test(r.text)) return;
      runs[String(i)] = "";
      cleared.push({ p: "insertAfter" in e ? e.like : e.p, text: r.text.trim().slice(0, 40) });
    });
    return { ...e, runs };
  });
  return { edits: { ...input, edits }, cleared };
}

/**
 * 첨자 칸에 넣은 본문 글을 앞(없으면 뒤)의 보통 칸으로 옮긴다 — 두 쓰임 모두.
 *
 * 2026-11-26 「'모두의 성장' 추진」: 「3대 분야 중심 관계부처 합동 구체적 과제 마련」의 뒷부분이 원본 각주 표시용 윗첨자 칸에 들어가
 * 아주 작게 찍혔다. 문단 목록에 첨자 표시가 없어 AI 는 그 칸이 첨자인지 몰랐다(지금은 ⟦k 윗첨자⟧ 로 보인다).
 * 각주 표시처럼 짧은 글(3자 이하: 「1)」「*」)은 그대로 둔다.
 */
export function moveOutOfScript(doc: TemplateDoc, input: TemplateEdits): { edits: TemplateEdits; moved: { p: number; text: string }[] } {
  const byId = new Map(doc.paragraphs.map((p) => [p.id, p]));
  const isScript = (charPr?: string) => !!charPr && /첨자/.test(doc.charHints[charPr] ?? "");
  const moved: { p: number; text: string }[] = [];
  const edits = (Array.isArray(input.edits) ? input.edits : []).map((e) => {
    if (!e || typeof e !== "object" || !("runs" in e) || !e.runs || typeof e.runs !== "object") return e;
    const pid = "insertAfter" in e ? e.like : e.p;
    const src = byId.get(pid);
    if (!src) return e;
    const runs = { ...e.runs };
    const textOf = (j: number) => (String(j) in runs ? runs[String(j)] : src.runs[j].text);
    for (const [k, v] of Object.entries(e.runs)) {
      const i = Number(k);
      if (typeof v !== "string" || v.trim().length <= 3 || !isScript(src.runs[i]?.charPr)) continue;
      // 글이 있는 보통 칸에 붙인다 — 없으면(「※」 칸뿐) 글머리 칸 뒤에라도 붙인다
      const plain = [...src.runs.keys()].filter((j) => !isScript(src.runs[j].charPr));
      const withText = plain.filter((j) => !MARK_ONLY.test(textOf(j)));
      const candidates = withText.length ? withText : plain;
      const before = candidates.filter((j) => j < i).pop();
      const after = candidates.find((j) => j > i);
      const j = before ?? after;
      if (j === undefined) continue;
      runs[String(j)] = before !== undefined ? textOf(j) + v : v + textOf(j);
      runs[k] = "";
      moved.push({ p: pid, text: v.trim().slice(0, 40) });
    }
    return { ...e, runs };
  });
  return { edits: { ...input, edits }, moved };
}
