/**
 * DocModel → GitHub-flavoured Markdown (.md), used for the 보도자료 deliverable. Unlike the DSL,
 * this output targets ordinary Markdown renderers: composites become headings / tables / lists,
 * merged cells are flattened (covered cells render empty), and the 보도자료 head becomes a
 * small key-value table.
 */
import type { Block, DocModel, Inline, NoticeMeta, PressMeta } from "../schema";
import { greetingScope } from "../format";

function esc(s: string): string {
  return s.replace(/([\\`*_{}[\]<>|])/g, "\\$1");
}

export function inlinesToMarkdown(inlines: Inline[], opts: { inCell?: boolean } = {}): string {
  let out = "";
  for (const inl of inlines) {
    if (inl.t === "br") {
      out += opts.inCell ? "<br>" : "  \n";
      continue;
    }
    if (inl.t === "link") {
      out += `[${esc(inl.text)}](${inl.href})`;
      continue;
    }
    let t = esc(inl.text);
    if (inl.bold) t = `**${t}**`;
    if (inl.color) t = `<span style="color:${inl.color}">${t}</span>`;
    out += t;
  }
  return out;
}

function table(rows: string[][], header = true): string[] {
  if (!rows.length) return [];
  const ncols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(ncols - r.length).fill("")];
  const lines = [`| ${pad(rows[0]).join(" | ")} |`];
  if (header) lines.push(`|${Array(ncols).fill("---").join("|")}|`);
  for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
  return lines;
}

function pressHead(meta: PressMeta): string[] {
  const rows: string[][] = [
    ["구분", "내용"],
    ["기관", meta.기관],
    ["배포일", meta.배포일],
    ["보도시점", meta.보도시점],
    ["담당부서", meta.담당부서],
    ["담당자", `${meta.담당자} (${meta.연락처}${meta.이메일 ? `, ${meta.이메일}` : ""})`],
  ];
  if (meta.사진) rows.push(["사진", "있음"]);
  return ["> **보도자료**", "", ...table(rows), ""];
}

function noticeHead(meta: NoticeMeta): string[] {
  return [
    `**(재)경상북도경제진흥원 공고 제${meta.공고번호}호**`,
    "",
    `# 「${meta.사업명}」 ${meta.모집대상} 모집 공고${meta.부제 ? `(${meta.부제})` : ""}`,
    "",
    `${meta.주관기관}와 (재)경상북도경제진흥원에서 추진하는 「${meta.사업명}」${meta.모집대상}을 모집하오니 ${greetingScope(meta.지역, meta.대상기업군)}의 많은 참여를 바랍니다.`,
    "",
    `${meta.공고연월}  `,
    `**${meta.기관장}**`,
    "",
  ];
}

export function blockToMarkdown(b: Block, doc: DocModel): string[] {
  switch (b.k) {
    case "para": {
      const text = inlinesToMarkdown(b.inlines);
      switch (b.role) {
        case "pressTitle":
        case "coverTitle":
          return [`# ${text}`, ""];
        case "pressSubtitle":
          return [`## ${text}`, ""];
        case "unitCaption":
          return [`<div align="right">${text}</div>`, ""];
        case "attachmentHeading":
          return [`### ${text}`, ""];
        default: {
          const glyph = b.glyph && b.glyph !== "none" ? `${b.glyph} ` : "";
          return [`${glyph}${text}`, ""];
        }
      }
    }
    case "blank":
      return [];
    case "pageBreak":
      return ["---", ""];
    case "image":
      return [`![${b.asset}](${b.asset})`, ""];
    case "table": {
      const rows = b.rows.map((r) => r.cells.map((c) => (c.covered ? "" : inlinesToMarkdown(c.inlines, { inCell: true }))));
      return [...(b.caption ? [b.caption, ""] : []), ...table(rows, (b.headerRows ?? 1) >= 1), ""];
    }
    case "chapterBand":
      return [`## ${b.numeral}. ${b.title}`, ""];
    case "sectionBar":
      return [`## ${b.number}. ${b.title}`, ""];
    case "sectionChip":
      return [`### ${b.label ? `${b.label} ` : ""}${b.title}`, ""];
    case "summaryBox":
      return [...b.lines.map((l, i) => `> ${i === 0 && b.glyph && b.glyph !== "none" ? `${b.glyph} ` : ""}${inlinesToMarkdown(l)}`), ""];
    case "approvalBlock":
      return [];
    case "coverTitle":
      return [`# ${inlinesToMarkdown(b.inlines)}`, ""];
    case "infoBox":
      return [...b.groups.flatMap((g) => [`**□ ${g.heading}**`, ...g.items.map((it) => `- ${inlinesToMarkdown(it).replace(/ {2}\n/g, " ")}`), ""])];
    case "overviewTable":
      return [...table([["항목", "내용"], ...b.rows.filter((r): r is Exclude<typeof r, "spacer"> => r !== "spacer").map((r) => [r.label, inlinesToMarkdown(r.value, { inCell: true })])]), ""];
    case "procedureFlow":
      return [b.stages.map((s) => `**${s.name}** (${s.when})`).join(" → "), ""];
    case "noticeHeader":
      return doc.family === "notice" ? noticeHead(doc.meta as NoticeMeta) : [];
    case "pressHeader":
      return doc.family === "press" ? pressHead(doc.meta as PressMeta) : [];
    case "attachmentList":
      return [...b.items.map((it, i) => (/^붙임/.test(it) ? it : `붙임 ${i + 1}. ${it}`)), "", "끝.", ""];
  }
}

export function toMarkdown(doc: DocModel): string {
  const lines: string[] = [];
  for (const b of doc.blocks) lines.push(...blockToMarkdown(b, doc));
  if (doc.family === "press") {
    const meta = doc.meta as PressMeta;
    if (meta.붙임?.length && !doc.blocks.some((b) => b.k === "attachmentList")) {
      lines.push(...meta.붙임.map((it, i) => (/^붙임/.test(it) ? it : `붙임 ${i + 1}. ${it}`)), "", "끝.", "");
    }
  }
  const out: string[] = [];
  for (const l of lines) {
    if (l === "" && out[out.length - 1] === "") continue;
    out.push(l);
  }
  return out.join("\n").replace(/\s+$/, "") + "\n";
}
