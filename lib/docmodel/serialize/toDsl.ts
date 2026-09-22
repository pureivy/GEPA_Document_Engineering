/**
 * DocModel → DSL text. The output re-parses (parseDsl) to an equivalent DocModel.
 *
 * Blocks synthesized from front-matter (grammar rule 13) are not serialized: the family
 * expander is replayed on `doc.meta` and, when the document starts with exactly those block
 * kinds, that prefix is skipped. Everything else is written explicitly (numerals, chip labels,
 * table attributes) so that the round trip does not depend on auto-numbering.
 */
import { stringify as stringifyYaml } from "yaml";
import type { Block, Cell, DocModel, Glyph, Inline, ParaRole } from "../schema";
import { familyContext } from "../dsl/expanders";
import { DOC_FAMILIES } from "../families";
import { serializeInlines, inlinesToPlain } from "../dsl/inline";
import { GLYPH_CHARS, ROMAN_NUMERALS, splitLeadingNumeral } from "../dsl/parser";
import { parseDsl } from "../dsl";

const ROLE_GLYPH: Partial<Record<ParaRole, Glyph>> = { body1: "□", body2: "ㅇ", body3: "-", body4: "·", note: "※", footnote: "*" };
const GLYPH_SET = new Set<string>(GLYPH_CHARS);
const UNIT_CAPTION_RE = /^\(\s*단위\s*[:：]\s*[^)]+\)$/;
const ATTACH_HEADING_RE = /^\[\s*별\s*첨\s*\d*\s*\]/;

export function metaToYaml(doc: DocModel): string {
  const obj: Record<string, unknown> = { family: doc.family, ...(doc.meta as Record<string, unknown>) };
  return stringifyYaml(obj, { lineWidth: 0, defaultKeyType: "PLAIN" });
}

/** True when the document starts with the blocks the family expander would synthesize. */
export function preludeLength(doc: DocModel): number {
  const ctx = familyContext(doc.family, doc.meta);
  const n = ctx.prelude.length;
  if (doc.blocks.length < n) return 0;
  for (let i = 0; i < n; i++) if (doc.blocks[i].k !== ctx.prelude[i].k) return 0;
  return n;
}

/** Prefix a backslash when a paragraph line would otherwise be read as another construct. */
function guardLineStart(s: string): string {
  const t = s.replace(/^[ \t\u3000]+/, "");
  if (!t) return s;
  const c = t[0];
  const first = [...t][0];
  const second = [...t][1];
  const needs =
    ((GLYPH_SET.has(first) || ["•", "ㆍ", "‧", "–", "—", "ㅁ", "＊", "ο"].includes(first)) && second !== first) ||
    c === "#" ||
    c === "|" ||
    t.startsWith("```") ||
    t.startsWith("{{") ||
    /^\{table\b/.test(t) ||
    /^<pagebreak/i.test(t) ||
    UNIT_CAPTION_RE.test(t) ||
    ATTACH_HEADING_RE.test(t);
  return needs ? "\\" + t : t;
}

function paraLine(b: Extract<Block, { k: "para" }>): string {
  const body = serializeInlines(b.inlines);
  if (b.role === "unitCaption") {
    const plain = inlinesToPlain(b.inlines).trim();
    return UNIT_CAPTION_RE.test(plain) ? plain : `(단위: ${plain.replace(/^\(|\)$/g, "")})`;
  }
  if (b.role === "attachmentHeading") return ATTACH_HEADING_RE.test(body) ? body : `[별첨] ${body}`;
  const glyph = b.glyph && b.glyph !== "none" ? b.glyph : undefined;
  if (glyph) return body ? `${glyph} ${body}` : glyph;
  const fallback = ROLE_GLYPH[b.role];
  if (fallback) return body ? `${fallback} ${body}` : fallback;
  return guardLineStart(body);
}

function cellText(c: Cell): string {
  const s = serializeInlines(c.inlines, { inCell: true });
  if (s === "^" || s === "<") return "\\" + s;
  return s;
}

function tableLines(b: Extract<Block, { k: "table" }>): string[] {
  const out: string[] = [];
  const attrs: string[] = [];
  if (b.role !== "generic") attrs.push(`role=${b.role}`);
  if (b.widthsPt?.length) attrs.push(`widths=${b.widthsPt.join(",")}`);
  if (b.style?.headerFill) attrs.push(`header-fill=${b.style.headerFill}`);
  if (b.style?.totalFill) attrs.push(`total-fill=${b.style.totalFill}`);
  if (b.style?.padding) attrs.push(`padding=${b.style.padding}`);
  if (b.style?.fontPt !== undefined) attrs.push(`font=${b.style.fontPt}`);
  if (b.style?.headerFontPt !== undefined) attrs.push(`header-font=${b.style.headerFontPt}`);
  if (b.style?.lineSpacing !== undefined) attrs.push(`line-spacing=${b.style.lineSpacing}`);
  if (b.style?.border) attrs.push(`border=${b.style.border}`);
  if (b.style?.borderColor) attrs.push(`border-color=${b.style.borderColor}`);
  if (b.caption !== undefined) attrs.push(`caption="${b.caption.replace(/"/g, "'")}"`);
  if (b.headerRows !== undefined && b.headerRows !== 1) attrs.push(`header-rows=${b.headerRows}`);
  if (attrs.length) out.push(`{table ${attrs.join(" ")}}`);

  // anchor grid: covered position → anchor coordinates
  const anchorOf = new Map<string, { r: number; c: number }>();
  b.rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (cell.covered) return;
      const rs = cell.rowSpan ?? 1;
      const cs = cell.colSpan ?? 1;
      for (let rr = r; rr < r + rs; rr++) for (let cc = c; cc < c + cs; cc++) if (rr !== r || cc !== c) anchorOf.set(`${rr},${cc}`, { r, c });
    });
  });
  const ncols = Math.max(0, ...b.rows.map((r) => r.cells.length));
  b.rows.forEach((row, r) => {
    const cells: string[] = [];
    for (let c = 0; c < ncols; c++) {
      const cell = row.cells[c];
      if (!cell) {
        cells.push("");
        continue;
      }
      if (cell.covered) {
        const a = anchorOf.get(`${r},${c}`);
        cells.push(a ? (a.r < r ? "^" : "<") : "");
        continue;
      }
      cells.push(cellText(cell));
    }
    out.push(`| ${cells.join(" | ")} |`);
    if (r === 0) out.push(`|${cells.map(() => "---").join("|")}|`);
  });
  return out;
}

function chipHeading(label: string, title: string): string {
  if (label === "") return `## [] ${title}`;
  if (/^\d+$/.test(label)) return `## ${label}. ${title}`;
  const cps = [...label];
  if (cps.length === 1 && cps[0].codePointAt(0)! > 0x7f && !/[A-Za-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/.test(cps[0])) return `## ${label} ${title}`;
  return `## [${label}] ${title}`;
}

/**
 * Body lines with boilerplate collapsed back to `{{boilerplate:NAME …}}` macros: the parser
 * expands macros into ordinary blocks, so without this the editor's re-serialization would
 * turn every fixed passage into typed text (and the reviewer would flag it, rightly, as a
 * regulation breach). A run of lines is collapsed only when it is byte-identical to what the
 * macro expands to, so an edited passage stays explicit.
 */
export function bodyToDsl(doc: DocModel): string {
  const lines = collapseBoilerplate(bodyLines(doc));
  return lines.join("\n") + (lines.length ? "\n" : "");
}

const ARG_SENTINEL = "\u00a7ARG\u00a7";
/** macros with a fixed expansion (`끝` is special-cased by the parser and never collapsed) */
const MACRO_DEFS: ReadonlyArray<{ name: string; argKey?: string; fixedArgs?: string }> = [
  { name: "참여제한대상" },
  { name: "참여제한대상", fixedArgs: "대상=기관" },
  { name: "기타유의사항", argKey: "주관기관" },
  { name: "기타유의사항", argKey: "주관기관", fixedArgs: "대상=기관" },
  { name: "지급방법" },
  { name: "지급방법", fixedArgs: "대상=기관" },
  { name: "일정변경" },
  { name: "예산상황" },
  { name: "예산상황", fixedArgs: "대상=기관" },
  { name: "기업부담금" },
  { name: "기업부담금", fixedArgs: "대상=기관" },
  { name: "이의제기" },
  { name: "정산문구" },
];
interface MacroPattern {
  name: string;
  argKey?: string;
  /** literal arguments that select this variant (e.g. `대상=기관`), re-emitted on collapse */
  fixedArgs?: string;
  /** serialized expansion; the line with the argument holds a RegExp capturing its value */
  lines: Array<string | RegExp>;
}
let macroPatterns: MacroPattern[] | null = null;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Expansions are obtained through the parser itself, so they match whatever paraLine() emits. */
function patterns(): MacroPattern[] {
  if (macroPatterns) return macroPatterns;
  macroPatterns = MACRO_DEFS.map(({ name, argKey, fixedArgs }) => {
    const macro = `{{boilerplate:${name}${fixedArgs ? ` ${fixedArgs}` : ""}${argKey ? ` ${argKey}=${ARG_SENTINEL}` : ""}}}`;
    const { doc } = parseDsl(`---\nfamily: plan\n제목: _\n---\n${macro}\n`);
    const lines = bodyLines(doc).map((l): string | RegExp => {
      const at = l.indexOf(ARG_SENTINEL);
      if (at < 0) return l;
      return new RegExp(`^${escapeRe(l.slice(0, at))}(\\S+)${escapeRe(l.slice(at + ARG_SENTINEL.length))}$`);
    });
    return { name, argKey, fixedArgs, lines };
  }).sort((a, b) => b.lines.length - a.lines.length);
  return macroPatterns;
}

function matchAt(lines: string[], i: number, p: MacroPattern): { value?: string } | null {
  if (i + p.lines.length > lines.length) return null;
  let value: string | undefined;
  for (let k = 0; k < p.lines.length; k++) {
    const want = p.lines[k];
    const got = lines[i + k];
    if (typeof want === "string") {
      if (got !== want) return null;
    } else {
      const m = want.exec(got);
      if (!m) return null;
      value = m[1];
    }
  }
  return { value };
}

export function collapseBoilerplate(lines: string[]): string[] {
  const out: string[] = [];
  const ps = patterns();
  for (let i = 0; i < lines.length; ) {
    let hit: { p: MacroPattern; value?: string } | null = null;
    for (const p of ps) {
      const m = matchAt(lines, i, p);
      if (m) {
        hit = { p, value: m.value };
        break;
      }
    }
    if (!hit) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const fixed = hit.p.fixedArgs ? ` ${hit.p.fixedArgs}` : "";
    const arg = hit.p.argKey && hit.value ? ` ${hit.p.argKey}=${hit.value}` : "";
    out.push(`{{boilerplate:${hit.p.name}${fixed}${arg}}}`);
    i += hit.p.lines.length;
  }
  return out;
}

function bodyLines(doc: DocModel): string[] {
  const lines: string[] = [];
  const start = preludeLength(doc);
  const blocks = doc.blocks.slice(start);
  // 확장기가 제 meta 에서 정한 값을 읽는다 — parser.ts 의 장 띠 번호와 같은 출처다.
  // `doc.family === "plan" && meta.numbering !== "arabic"` 로 두면 chapterChip 을 쓰는
  // 다른 family(업무보고)가 조용히 아라비아 숫자로 직렬화되어, 파서가 만든 Ⅰ 과 어긋난다.
  //
  // headingStyle 조건을 함께 거는 이유: `numeralStyle` 은 chapterChip family 만 읽는데
  // (parser.ts:516) 공고문·보도자료·공문서도 값 자체는 "roman" 을 들고 있다. 그 조건 없이
  // numeralStyle 만 보면, 그 세 family 의 DocModel 에 chapterBand 가 들어 있을 때
  // (파서는 만들지 않지만 저장된 doc.json·편집기 왕복은 만들 수 있다) `# 1.` 이던 줄이
  // 조용히 `# Ⅰ.` 로 바뀐다.
  const isRoman = DOC_FAMILIES[doc.family].headingStyle === "chapterChip" && familyContext(doc.family, doc.meta).numeralStyle === "roman";

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    switch (b.k) {
      case "para": {
        if (b.role === "tocLine") {
          lines.push("```toc");
          while (i < blocks.length && blocks[i].k === "para" && (blocks[i] as Extract<Block, { k: "para" }>).role === "tocLine") {
            lines.push(serializeInlines((blocks[i] as Extract<Block, { k: "para" }>).inlines));
            i++;
          }
          i--;
          lines.push("```");
          break;
        }
        if (!b.inlines.length && !(b.glyph && b.glyph !== "none") && !ROLE_GLYPH[b.role]) break; // an empty glyph-less paragraph has no DSL form
        lines.push(paraLine(b));
        break;
      }
      case "blank":
        lines.push("");
        break;
      case "pageBreak":
        lines.push("<pagebreak>");
        break;
      case "image": {
        const parts = [b.asset];
        if (b.widthMm !== undefined) parts.push(`width=${b.widthMm}mm`);
        if (b.heightMm !== undefined) parts.push(`height=${b.heightMm}mm`);
        if (b.align) parts.push(`align=${b.align}`);
        lines.push("```image " + parts.join(" "), "```");
        break;
      }
      case "table":
        lines.push(...tableLines(b));
        break;
      case "chapterBand": {
        const n = splitLeadingNumeral(`${b.numeral} x`)?.n;
        if (n !== undefined) lines.push(`# ${isRoman ? (ROMAN_NUMERALS as readonly string[])[n - 1] ?? String(n) : String(n)}. ${b.title}`);
        else lines.push(`# ${b.numeral} ${b.title}`);
        break;
      }
      case "sectionBar":
        lines.push(`# ${b.number}. ${b.title}`);
        break;
      case "sectionChip":
        lines.push(chipHeading(b.label, b.title));
        break;
      case "summaryBox": {
        lines.push("```box");
        b.lines.forEach((l, idx) => {
          const s = serializeInlines(l);
          lines.push(idx === 0 && b.glyph && b.glyph !== "none" ? `${b.glyph} ${s}` : s);
        });
        lines.push("```");
        break;
      }
      case "infoBox": {
        lines.push("```infobox");
        for (const g of b.groups) {
          lines.push(`□ ${g.heading}`);
          for (const item of g.items) lines.push(`○ ${serializeInlines(item, { inCell: true })}`);
        }
        lines.push("```");
        break;
      }
      case "procedureFlow": {
        lines.push("```flow");
        for (const s of b.stages) lines.push(`${s.name} | ${s.when}`);
        lines.push("```");
        break;
      }
      case "attachmentList": {
        lines.push("```attach");
        for (const it of b.items) lines.push(it);
        lines.push("```");
        break;
      }
      case "coverTitle":
        lines.push(guardLineStart(serializeInlines(b.inlines)));
        break;
      case "approvalBlock":
      case "noticeHeader":
      case "pressHeader":
      case "officialHeader":
      case "officialFooter":
      case "overviewTable":
        // synthesized from meta; nothing to write
        break;
    }
  }
  return lines;
}

export function toDsl(doc: DocModel): string {
  return `---\n${metaToYaml(doc)}---\n${bodyToDsl(doc)}`;
}

export function inlineToDsl(inlines: Inline[]): string {
  return serializeInlines(inlines);
}
