/**
 * DocModel → plain text (.txt). Written for the 보도자료 deliverable but works for any family:
 * glyph lines keep their glyph, tables become ` | `-separated rows, composites are flattened.
 */
import type { Block, DocModel, Inline, NoticeMeta, PlanMeta, PressMeta } from "../schema";
import { greetingScope } from "../format";

export function inlinesPlain(inlines: Inline[]): string {
  return inlines.map((i) => (i.t === "br" ? "\n" : i.text)).join("");
}

function pressHeaderText(meta: PressMeta): string[] {
  const lines = ["보도자료", meta.기관, `배포일: ${meta.배포일}`, `보도시점: ${meta.보도시점}`, `담당부서: ${meta.담당부서}`, ...(meta.책임자 ? [`책임자: ${meta.책임자}`] : []), `담당자: ${meta.담당자} (${meta.연락처}${meta.이메일 ? `, ${meta.이메일}` : ""})`];
  if (meta.사진) lines.push("※ 사진 있음");
  return lines;
}

function noticeHeaderText(meta: NoticeMeta): string[] {
  return [
    `(재)경상북도경제진흥원 공고 제${meta.공고번호}호`,
    "",
    `「${meta.사업명}」`,
    `${meta.모집대상} 모집 공고${meta.부제 ? `(${meta.부제})` : ""}`,
    "",
    `  ${meta.주관기관}와 (재)경상북도경제진흥원에서 추진하는 「${meta.사업명}」${meta.모집대상}을 모집하오니 ${greetingScope(meta.지역, meta.대상기업군)}의 많은 참여를 바랍니다.`,
    "",
    meta.공고연월,
    meta.기관장,
  ];
}

function planCoverText(meta: PlanMeta): string[] {
  const lines: string[] = [];
  if (meta.결재) {
    const r = meta.결재;
    const cells = [r.담당 && `담당 ${r.담당}`, r.팀장 && `팀장 ${r.팀장}`, r.실장 && `실장 ${r.실장}`, r.본부장 && `본부장 ${r.본부장}`, r.원장 && `원장 ${r.원장}`].filter(Boolean);
    if (cells.length) lines.push(`[결재] ${cells.join(" | ")}`);
  }
  return lines;
}

export function blockToText(b: Block, doc: DocModel): string[] {
  switch (b.k) {
    case "para": {
      const glyph = b.glyph && b.glyph !== "none" ? `${b.glyph} ` : "";
      const text = glyph + inlinesPlain(b.inlines);
      if (b.role === "pressTitle" || b.role === "coverTitle") return ["", text];
      if (b.role === "pressSubtitle") return [text, ""];
      return [text];
    }
    case "blank":
      return [""];
    case "pageBreak":
      return ["", "----------", ""];
    case "image":
      return [`[이미지: ${b.asset}]`];
    case "table":
      return [
        ...(b.caption ? [b.caption] : []),
        ...b.rows.map((r) =>
          r.cells
            .filter((c) => !c.covered)
            .map((c) => inlinesPlain(c.inlines).replace(/\n/g, " / "))
            .join(" | "),
        ),
      ];
    case "chapterBand":
      return ["", `${b.numeral}. ${b.title}`];
    case "sectionBar":
      return ["", `${b.number}. ${b.title}`];
    case "sectionChip":
      return [`${b.label ? `${b.label} ` : ""}${b.title}`];
    case "summaryBox":
      return b.lines.map((l, i) => `${i === 0 && b.glyph && b.glyph !== "none" ? `${b.glyph} ` : ""}${inlinesPlain(l)}`);
    case "approvalBlock":
      return doc.family === "plan" ? planCoverText(doc.meta as PlanMeta) : [];
    case "coverTitle":
      return [inlinesPlain(b.inlines)];
    case "infoBox":
      return b.groups.flatMap((g) => [`□ ${g.heading}`, ...g.items.map((it) => ` ○ ${inlinesPlain(it).replace(/\n/g, " ")}`), ""]);
    case "overviewTable":
      return b.rows.map((r) => (r === "spacer" ? "" : `${r.bullet === false ? "  " : "○ "}${r.label} : ${inlinesPlain(r.value)}`));
    case "procedureFlow":
      return [b.stages.map((s) => `${s.name}(${s.when})`).join(" → ")];
    case "noticeHeader":
      return doc.family === "notice" ? noticeHeaderText(doc.meta as NoticeMeta) : [];
    case "pressHeader":
      return doc.family === "press" ? pressHeaderText(doc.meta as PressMeta) : [];
    case "attachmentList":
      return [...b.items.map((it, i) => (/^붙임/.test(it) ? it : `붙임 ${i + 1}. ${it}`)), "끝."];
  }
}

export function toText(doc: DocModel): string {
  const lines: string[] = [];
  for (const b of doc.blocks) lines.push(...blockToText(b, doc));
  if (doc.family === "press") {
    const meta = doc.meta as PressMeta;
    if (meta.붙임?.length && !doc.blocks.some((b) => b.k === "attachmentList")) {
      lines.push("", ...meta.붙임.map((it, i) => (/^붙임/.test(it) ? it : `붙임 ${i + 1}. ${it}`)), "끝.");
    }
  }
  // collapse runs of blank lines
  const out: string[] = [];
  for (const l of lines) {
    if (l === "" && out[out.length - 1] === "") continue;
    out.push(l);
  }
  return out.join("\n").replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
}
