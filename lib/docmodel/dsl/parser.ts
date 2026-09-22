/**
 * Line-oriented DSL parser (grammar: lib/docmodel/dsl/grammar.md, rules 1–14).
 *
 * `LineParser` is a state machine fed one source line at a time. It is the single
 * implementation behind both `parseDsl` (one-shot) and `createStreamingParser` (chunked), so
 * both produce byte-identical DocModels and block ids. Every construct it does not understand
 * degrades to a plain paragraph with a warning; it never throws.
 */
import { TableRoleSchema, type Block, type Cell, type DocModel, type Family, type Glyph, type Inline, type ParaRole, type Row, type TableStyle } from "../schema";
import { glyphRole } from "../indent";
import { expandBoilerplate, 끝_LINE, 끝_SUFFIX, type MacroArgs } from "../boilerplate";
import { fallbackMeta, validateFrontMatter, normalizeNewlines } from "./frontmatter";
import { parseInlines, pushText, inlinesToPlain } from "./inline";
import { familyContext, type BlockInput, type FamilyContext } from "./expanders";
import { DOC_FAMILIES } from "../families";

// ---------------------------------------------------------------------------------------------
// public types

export interface DslWarning {
  /** 1-based line in the original DSL text */
  line: number;
  message: string;
  /** `error` = front-matter could not be validated (the doc carries a placeholder meta) */
  severity?: "warning" | "error";
}

export type DslEvent =
  | { type: "meta"; family: Family; meta: DocModel["meta"] }
  | { type: "block.open"; block: Block }
  | { type: "text.delta"; blockId: string; text: string }
  | { type: "block.upsert"; block: Block }
  | { type: "block.commit"; block: Block };

export type ParaBlock = Extract<Block, { k: "para" }>;
export type TableBlock = Extract<Block, { k: "table" }>;

// ---------------------------------------------------------------------------------------------
// glyphs / numerals

export const GLYPH_CHARS: readonly Glyph[] = ["□", "ㅇ", "○", "◦", "●", "-", "·", "※", "*", "❖", "◇", "■", "✔", "❍", "▪", "∙", "❶", "❷", "❸", "❹"];
const GLYPH_SET = new Set<string>(GLYPH_CHARS);
/** look-alike bullets the writer model tends to use; normalized with a warning */
const GLYPH_ALIASES: Record<string, Glyph> = { "•": "·", "ㆍ": "·", "‧": "·", "–": "-", "—": "-", "ㅁ": "□", "＊": "*", "ο": "○", "o": "ㅇ" };
/** these need a following space to count as a glyph (so `**bold**`, `---`, `-4%` are not bullets) */
const SPACE_REQUIRED = new Set(["-", "*", "o", "–", "—", "＊"]);

export const ROMAN_NUMERALS = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ"] as const;
const LATIN_ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

export function romanNumeral(n: number): string {
  if (n >= 1 && n <= ROMAN_NUMERALS.length) return ROMAN_NUMERALS[n - 1];
  if (n > ROMAN_NUMERALS.length) return "Ⅹ".repeat(Math.floor(n / 10)) + (n % 10 ? ROMAN_NUMERALS[(n % 10) - 1] : "");
  return String(n);
}

/** `Ⅲ 제목` / `Ⅲ. 제목` / `3. 제목` / `3 제목` / `III. 제목` → { n: 3, title }. */
export function splitLeadingNumeral(title: string): { n: number; title: string } | null {
  const m = /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]|[IVX]{1,4}\.|\d{1,2})\.?\s+(.+)$/.exec(title.trim());
  if (!m) return null;
  const tok = m[1].replace(/\.$/, "");
  let n: number;
  const ri = (ROMAN_NUMERALS as readonly string[]).indexOf(tok);
  if (ri >= 0) n = ri + 1;
  else if (/^\d+$/.test(tok)) n = parseInt(tok, 10);
  else if (LATIN_ROMAN[tok]) n = LATIN_ROMAN[tok];
  else return null;
  return { n, title: m[2].trim() };
}

export interface GlyphSplit {
  glyph?: Glyph;
  /** text after the glyph (leading whitespace removed) */
  rest: string;
  /** set when a look-alike bullet was normalized */
  normalizedFrom?: string;
}

/** Detect the leading glyph of a body line (rule 4). Leading spaces are ignored. */
export function splitGlyph(line: string): GlyphSplit {
  const t = line.replace(/^[ \t\u3000]+/, "");
  if (!t) return { rest: "" };
  const c = t[0];
  const after = t[1];
  const spaceOk = after === undefined || after === " " || after === "\t" || after === "\u3000";
  // `○○○ 원장`, `□□` … : a repeated glyph character is text (masked names), not a bullet
  if (after === c) return { rest: t };
  if (GLYPH_SET.has(c)) {
    if (SPACE_REQUIRED.has(c) && !spaceOk) return { rest: t };
    return { glyph: c as Glyph, rest: t.slice(1).replace(/^[ \t\u3000]+/, "") };
  }
  const alias = GLYPH_ALIASES[c];
  if (alias && (!SPACE_REQUIRED.has(c) || spaceOk)) {
    return { glyph: alias, rest: t.slice(1).replace(/^[ \t\u3000]+/, ""), normalizedFrom: c };
  }
  return { rest: t };
}

// ---------------------------------------------------------------------------------------------
// small helpers

const TABLE_ATTR_RE = /^\{table\b([^}]*)\}\s*$/;
const MACRO_RE = /^\{\{\s*boilerplate\s*:\s*([^\s}]+)\s*([^}]*?)\s*\}\}\s*$/;
const FENCE_OPEN_RE = /^```\s*([A-Za-z_][\w-]*)?\s*(.*?)\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;
const PAGEBREAK_RE = /^<pagebreak\s*\/?>\s*$/i;
/** 조직도 자리표 — 내용은 참고본 조각에 굳어 있어 DSL 은 자리만 찍는다(schema.ts:TableRoleSchema). */
const ORGCHART_RE = /^<(?:orgchart|조직도)\s*\/?>\s*$/i;
const UNIT_CAPTION_RE = /^\(\s*단위\s*[:：]\s*[^)]+\)$/;
const ATTACH_HEADING_RE = /^\[\s*별\s*첨\s*\d*\s*\]/;
const HEADING_RE = /^(#{1,6})[ \t\u3000]+(.*?)\s*$/;
const TOTAL_RE = /^(합\s*계|계|총\s*계)$/;

export function parseKeyValues(s: string): MacroArgs {
  const out: MacroArgs = {};
  const re = /([^\s=]+)=(?:"([^"]*)"|'([^']*)'|(\S*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function isLetterOrDigit(cp: string): boolean {
  return /[A-Za-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/.test(cp);
}

/** Split `## 󰊱 제목` / `## [사업개요] 제목` / `## 1. 제목` into label + title. */
export function splitChipLabel(title: string): { label: string | null; title: string } {
  const t = title.trim();
  const br = /^\[([^\]]*)\]\s*(.*)$/.exec(t);
  if (br) return { label: br[1].trim(), title: br[2].trim() };
  const num = /^(\d{1,2})\.?\s+(.+)$/.exec(t);
  if (num) return { label: num[1], title: num[2].trim() };
  const cps = [...t];
  if (cps.length >= 2) {
    const first = cps[0];
    const isSymbol = first.codePointAt(0)! > 0x7f && !isLetterOrDigit(first) && !"「『【《〈（(".includes(first);
    if (isSymbol) return { label: first, title: cps.slice(1).join("").trim() };
  }
  return { label: null, title: t };
}

/** Streaming helper: can this (possibly incomplete) line only be a paragraph? */
export function classifyPrefix(partial: string): "para" | "other" | "unknown" {
  const t = partial.replace(/^[ \t\u3000]+/, "");
  if (!t) return "unknown";
  const c = t[0];
  if (c === "|" || c === "#") return "other";
  if (c === "`") {
    if (t.startsWith("```")) return "other";
    return "```".startsWith(t) ? "unknown" : "para";
  }
  if (c === "{") {
    if (t.startsWith("{{")) return "other";
    if (t.startsWith("{table") && (t.length === 6 || /[\s}]/.test(t[6]))) return "other";
    if ("{{".startsWith(t) || "{table".startsWith(t)) return "unknown";
    return "para";
  }
  if (c === "<") {
    const l = t.toLowerCase();
    const macros = ["<pagebreak", "<orgchart", "<조직도"];
    if (macros.some((m) => l.startsWith(m))) return "other";
    return macros.some((m) => m.startsWith(l)) ? "unknown" : "para";
  }
  if (c === "(") {
    const head = t.replace(/^\(\s*/, "(");
    if (head.startsWith("(단위") || "(단위".startsWith(head)) return "unknown";
    return "para";
  }
  return "para";
}

// ---------------------------------------------------------------------------------------------
// the machine

interface OpenPara {
  block: ParaBlock;
  line: number;
}
interface OpenTable {
  block: TableBlock;
  /** covered positions → anchor coordinates */
  covered: Map<string, { r: number; c: number }>;
  ncols: number;
  headerRows: number;
  line: number;
}
interface OpenFence {
  name: string;
  args: string;
  line: number;
  block: Block | null;
  count: number;
}
interface PendingAttrs {
  role: TableBlock["role"];
  widthsPt?: number[];
  style?: TableStyle;
  caption?: string;
  headerRows: number;
  line: number;
}

export class LineParser {
  readonly blocks: Block[] = [];
  readonly warnings: DslWarning[] = [];
  phase: "start" | "front" | "body" = "start";
  family: Family = "plan";
  meta: DocModel["meta"] | null = null;

  private ctx: FamilyContext | null = null;
  private fmLines: string[] = [];
  private fmStartLine = 2;
  private idCounter = 0;
  private chapterCounter = 0;
  private chipCounter = 0;
  private sectionCounter = 0;
  private openPara: OpenPara | null = null;
  private table: OpenTable | null = null;
  private pendingAttrs: PendingAttrs | null = null;
  private fence: OpenFence | null = null;
  private swallowFenceClose = false;

  // ---- id / state accessors used by the streaming wrapper -----------------------------------
  peekNextId(): string {
    return formatId(this.idCounter + 1);
  }
  private nextId(): string {
    this.idCounter += 1;
    return formatId(this.idCounter);
  }
  inFence(): boolean {
    return this.fence !== null;
  }
  openParaId(): string | null {
    return this.openPara?.block.id ?? null;
  }
  plainRole(): ParaRole {
    return this.ctx?.plainRole ?? "plain";
  }

  warn(line: number, message: string, severity?: "warning" | "error"): void {
    this.warnings.push(severity ? { line, message, severity } : { line, message });
  }

  doc(): DocModel {
    const meta = this.meta ?? fallbackMeta(this.family);
    return { version: 1, family: this.family, meta, blocks: this.blocks } as DocModel;
  }

  // ---- feeding ------------------------------------------------------------------------------
  /** Feed one source line (without its newline). `line` is the 1-based source line number. */
  feedLine(raw: string, line: number): DslEvent[] {
    const ev: DslEvent[] = [];
    const text = raw.replace(/\r$/, "");
    if (this.phase === "start") {
      if (text.trim() === "") return ev; // leading blank lines before the front-matter are ignored
      if (/^---\s*$/.test(text)) {
        this.phase = "front";
        this.fmStartLine = line + 1;
        return ev;
      }
      this.warn(1, "문서 맨 앞에 --- 로 감싼 YAML front-matter가 없습니다. family=plan 으로 가정합니다", "error");
      ev.push(...this.startBody(undefined));
      ev.push(...this.processBodyLine(text, line, 0));
      return ev;
    }
    if (this.phase === "front") {
      if (/^(---|\.\.\.)\s*$/.test(text)) {
        ev.push(...this.startBody(this.fmLines.join("\n")));
        return ev;
      }
      this.fmLines.push(text);
      return ev;
    }
    return this.processBodyLine(text, line, 0);
  }

  /** Flush everything that is still open. */
  finish(): DslEvent[] {
    const ev: DslEvent[] = [];
    if (this.phase === "start") {
      this.warn(1, "빈 문서입니다 (front-matter 없음). family=plan 으로 가정합니다", "error");
      ev.push(...this.startBody(undefined));
    } else if (this.phase === "front") {
      this.warn(this.fmStartLine - 1, "front-matter가 닫히지 않았습니다 (--- 누락)", "error");
      ev.push(...this.startBody(this.fmLines.join("\n")));
    }
    ev.push(...this.closeFence(this.blocks.length + 1));
    ev.push(...this.closePara());
    ev.push(...this.closeTable());
    return ev;
  }

  private startBody(fmText: string | undefined): DslEvent[] {
    const ev: DslEvent[] = [];
    let family: Family = "plan";
    let meta: DocModel["meta"] | undefined;
    if (fmText !== undefined) {
      const v = validateFrontMatter(fmText, this.fmStartLine);
      for (const w of v.warnings) this.warn(w.line, w.message);
      for (const e of v.errors) this.warn(e.line, e.message, "error");
      family = v.family ?? "plan";
      meta = v.meta ?? fallbackMeta(family, v.raw);
    } else {
      meta = fallbackMeta(family);
    }
    this.family = family;
    this.meta = meta;
    this.ctx = familyContext(family, meta);
    this.phase = "body";
    ev.push({ type: "meta", family, meta: clone(meta) });
    for (const b of this.ctx.prelude) ev.push(this.commitNew(b));
    this.sectionCounter = this.ctx.firstSectionNumber - 1;
    return ev;
  }

  // ---- block emission -----------------------------------------------------------------------
  private commitNew(input: BlockInput): DslEvent {
    const block = { ...input, id: this.nextId() } as Block;
    this.blocks.push(block);
    return { type: "block.commit", block: clone(block) };
  }
  private openNew(input: BlockInput): { block: Block; event: DslEvent } {
    const block = { ...input, id: this.nextId() } as Block;
    this.blocks.push(block);
    return { block, event: { type: "block.open", block: clone(block) } };
  }
  private upsert(block: Block): DslEvent {
    return { type: "block.upsert", block: clone(block) };
  }
  private commit(block: Block): DslEvent {
    return { type: "block.commit", block: clone(block) };
  }

  /** close the open table, if any */
  closeTable(): DslEvent[] {
    if (!this.table) return [];
    const block = this.table.block;
    this.table = null;
    return [this.commit(block)];
  }
  private closePara(): DslEvent[] {
    if (!this.openPara) return [];
    const block = this.openPara.block;
    this.openPara = null;
    // drop a dangling trailing br left by `\` on the final line
    const last = block.inlines[block.inlines.length - 1];
    if (last && last.t === "br") block.inlines.pop();
    return [this.commit(block)];
  }
  private closeFence(line: number): DslEvent[] {
    if (!this.fence) return [];
    const f = this.fence;
    this.fence = null;
    if (f.name === "box" && f.block && f.block.k === "summaryBox" && f.block.lines.length === 0) this.warn(f.line, "```box 안에 내용이 없습니다");
    if (f.name === "image" && f.count > 0) this.warn(f.line, "```image 펜스 안의 내용은 무시됩니다");
    void line;
    return f.block ? [this.commit(f.block)] : [];
  }
  private pushBlank(): DslEvent[] {
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.k === "blank") return [];
    return [this.commitNew({ k: "blank" })];
  }

  // ---- body line dispatcher -----------------------------------------------------------------
  private processBodyLine(text: string, line: number, depth: number): DslEvent[] {
    const ev: DslEvent[] = [];
    const trimmed = text.trim();

    // 1. inside a fenced directive block
    if (this.fence) return this.fenceLine(text, line);
    if (this.swallowFenceClose && FENCE_CLOSE_RE.test(trimmed)) {
      this.swallowFenceClose = false;
      return ev;
    }

    // 2. blank line
    if (trimmed === "") {
      ev.push(...this.closePara(), ...this.closeTable());
      ev.push(...this.dropPendingAttrs(line));
      ev.push(...this.pushBlank());
      return ev;
    }

    // 3. paragraph continuation after a trailing `\`
    if (this.openPara) {
      const p = this.openPara.block;
      const { inlines, continues } = parseInlines(text.replace(/^[ \t\u3000]+/, ""), (m) => this.warn(line, m));
      appendInlines(p.inlines, inlines);
      if (continues) {
        p.inlines.push({ t: "br" });
        return ev;
      }
      ev.push(...this.closePara());
      return ev;
    }

    // 4. macros (expanded before tokenizing)
    const macro = MACRO_RE.exec(trimmed);
    if (macro) {
      ev.push(...this.closeTable(), ...this.dropPendingAttrs(line));
      const name = macro[1];
      const args = parseKeyValues(macro[2] ?? "");
      if (name === "끝") return [...ev, ...this.macro끝(line)];
      const lines = expandBoilerplate(name, args);
      if (!lines) {
        this.warn(line, `알 수 없는 boilerplate 매크로: ${name} (일반 문단으로 처리)`);
        ev.push(this.commitNew({ k: "para", role: this.plainRole(), inlines: [{ t: "text", text: trimmed }] }));
        return ev;
      }
      if (depth >= 3) {
        this.warn(line, `boilerplate 매크로 중첩이 너무 깊습니다: ${name}`);
        return ev;
      }
      for (const l of lines) ev.push(...this.processBodyLine(l, line, depth + 1));
      return ev;
    }

    // 5. page break
    if (PAGEBREAK_RE.test(trimmed)) {
      ev.push(...this.closeTable(), ...this.dropPendingAttrs(line));
      ev.push(this.commitNew({ k: "pageBreak" }));
      return ev;
    }

    // 5b. 조직도 자리표 — 조각이 report 템플릿에만 있어 다른 family 에서는 낼 것이 없다.
    // 여기서 끊지 않으면 칸 없는 표가 작성기까지 흘러가 아무 말 없이 사라진다.
    if (ORGCHART_RE.test(trimmed)) {
      ev.push(...this.closeTable(), ...this.dropPendingAttrs(line));
      if (this.family !== "report") {
        this.warn(line, `<조직도> 는 주요업무보고(report) 전용입니다 (${this.family} 에서는 건너뜁니다)`);
        return ev;
      }
      ev.push(this.commitNew({ k: "table", role: "orgChart", rows: [] }));
      return ev;
    }

    // 6. fenced directive open
    if (trimmed.startsWith("```")) {
      ev.push(...this.closeTable(), ...this.dropPendingAttrs(line));
      ev.push(...this.openFence(trimmed, line));
      return ev;
    }

    // 7. table attribute line
    const attr = TABLE_ATTR_RE.exec(trimmed);
    if (attr) {
      ev.push(...this.closeTable(), ...this.dropPendingAttrs(line));
      this.pendingAttrs = this.parseTableAttrs(attr[1], line);
      return ev;
    }

    // 8. table row
    if (trimmed.startsWith("|")) {
      ev.push(...this.tableRow(trimmed, line));
      return ev;
    }

    // anything below ends an open table
    ev.push(...this.closeTable(), ...this.dropPendingAttrs(line));

    // 9. headings
    const h = HEADING_RE.exec(trimmed);
    if (h) {
      ev.push(...this.heading(h[1].length, h[2], line));
      return ev;
    }

    // 10. (단위: 천원)
    if (UNIT_CAPTION_RE.test(trimmed)) {
      ev.push(this.commitNew({ k: "para", role: "unitCaption", inlines: [{ t: "text", text: trimmed }], align: "right" }));
      return ev;
    }

    // 11. [별첨1] …
    if (ATTACH_HEADING_RE.test(trimmed)) {
      const { inlines } = parseInlines(trimmed, (m) => this.warn(line, m));
      ev.push(this.commitNew({ k: "para", role: "attachmentHeading", inlines }));
      return ev;
    }

    // 12. glyph / plain paragraph
    ev.push(...this.paragraph(text, line));
    return ev;
  }

  private dropPendingAttrs(line: number): DslEvent[] {
    if (this.pendingAttrs) {
      this.warn(this.pendingAttrs.line, "{table …} 속성 행 바로 아래에 표가 없어 속성을 무시합니다");
      this.pendingAttrs = null;
    }
    void line;
    return [];
  }

  // ---- paragraphs ---------------------------------------------------------------------------
  private paragraph(text: string, line: number): DslEvent[] {
    const { glyph, rest, normalizedFrom } = splitGlyph(text);
    if (normalizedFrom) this.warn(line, `글머리 기호 '${normalizedFrom}' 를 '${glyph}' 로 정규화했습니다`);
    const { inlines, continues } = parseInlines(rest, (m) => this.warn(line, m));
    const role: ParaRole = glyph ? glyphRole(glyph) : this.plainRole();
    const input: BlockInput = glyph ? { k: "para", role, glyph, inlines } : { k: "para", role, inlines };
    if (continues) {
      const { block, event } = this.openNew(input);
      (block as ParaBlock).inlines.push({ t: "br" });
      this.openPara = { block: block as ParaBlock, line };
      return [event];
    }
    return [this.commitNew(input)];
  }

  private heading(level: number, rawTitle: string, line: number): DslEvent[] {
    const title = rawTitle.trim();
    const ctx = this.ctx!;
    const boldPara = (role: ParaRole, glyph?: Glyph): DslEvent => {
      const { inlines } = parseInlines(title, (m) => this.warn(line, m));
      for (const i of inlines) if (i.t === "text") i.bold = true;
      return this.commitNew(glyph ? { k: "para", role, glyph, inlines } : { k: "para", role, inlines });
    };
    if (!ctx.allowHeadings) {
      this.warn(line, `${this.family} 본문에서는 # 제목을 사용할 수 없습니다 (굵은 문단으로 처리)`);
      return [boldPara(ctx.plainRole)];
    }
    if (level === 1) {
      const num = splitLeadingNumeral(title);
      if (DOC_FAMILIES[this.family].headingStyle === "chapterChip") {
        const n = num ? num.n : this.chapterCounter + 1;
        this.chapterCounter = n;
        this.chipCounter = 0;
        const numeral = ctx.numeralStyle === "arabic" ? String(n) : romanNumeral(n);
        return [this.commitNew({ k: "chapterBand", numeral, title: num ? num.title : title })];
      }
      // notice
      const n = num ? num.n : this.sectionCounter + 1;
      this.sectionCounter = n;
      return [this.commitNew({ k: "sectionBar", number: n, title: num ? num.title : title })];
    }
    if (level === 2) {
      if (DOC_FAMILIES[this.family].headingStyle === "chapterChip") {
        const { label, title: t } = splitChipLabel(title);
        let lbl = label;
        if (lbl === null) {
          this.chipCounter += 1;
          lbl = String(this.chipCounter);
        } else if (/^\d+$/.test(lbl)) {
          this.chipCounter = parseInt(lbl, 10);
        }
        return [this.commitNew({ k: "sectionChip", label: lbl, title: t })];
      }
      // notice: bold body1 label line
      return [boldPara("body1", "□")];
    }
    this.warn(line, `${"#".repeat(level)} 제목은 지원하지 않습니다 (굵은 문단으로 처리)`);
    return [boldPara(ctx.plainRole)];
  }

  private macro끝(line: number): DslEvent[] {
    let i = this.blocks.length - 1;
    while (i >= 0 && this.blocks[i].k === "blank") i--;
    const target = i >= 0 ? this.blocks[i] : undefined;
    if (target && target.k === "para" && target.role !== "unitCaption" && target.role !== "tocLine") {
      const plain = inlinesToPlain(target.inlines).replace(/\s+$/, "");
      if (/끝\.$/.test(plain)) return [];
      const suffix = plain.endsWith(".") ? 끝_SUFFIX.slice(1) : 끝_SUFFIX;
      const last = target.inlines[target.inlines.length - 1];
      if (last && last.t === "text") last.text = last.text.replace(/\s+$/, "") + suffix;
      else target.inlines.push({ t: "text", text: suffix.replace(/^\./, "") });
      return [this.commit(target)];
    }
    void line;
    return [this.commitNew({ k: "para", role: this.plainRole(), inlines: [{ t: "text", text: 끝_LINE }] })];
  }

  // ---- tables -------------------------------------------------------------------------------
  private parseTableAttrs(s: string, line: number): PendingAttrs {
    const kv = parseKeyValues(s);
    const out: PendingAttrs = { role: "generic", headerRows: 1, line };
    const style: TableStyle = {};
    for (const [k, v] of Object.entries(kv)) {
      switch (k) {
        case "role": {
          const r = TableRoleSchema.safeParse(v);
          if (r.success) out.role = r.data;
          else this.warn(line, `알 수 없는 표 role: ${v} (generic 으로 처리)`);
          break;
        }
        case "widths": {
          const nums = v.split(",").map((x) => parseFloat(x.trim()));
          if (nums.length && nums.every((n) => Number.isFinite(n) && n > 0)) out.widthsPt = nums;
          else this.warn(line, `widths 값이 올바르지 않습니다: ${v}`);
          break;
        }
        case "header-fill":
          style.headerFill = normalizeColor(v);
          break;
        case "total-fill":
          style.totalFill = normalizeColor(v);
          break;
        case "padding":
          if (v === "tight" || v === "text") style.padding = v;
          else this.warn(line, `padding 은 tight | text 만 가능합니다: ${v}`);
          break;
        case "font": {
          const n = parseFloat(v);
          if (Number.isFinite(n)) style.fontPt = n;
          else this.warn(line, `font 값이 올바르지 않습니다: ${v}`);
          break;
        }
        case "header-font": {
          const n = parseFloat(v);
          if (Number.isFinite(n)) style.headerFontPt = n;
          else this.warn(line, `header-font 값이 올바르지 않습니다: ${v}`);
          break;
        }
        case "line-spacing": {
          const n = parseFloat(v);
          if (Number.isFinite(n)) style.lineSpacing = n;
          else this.warn(line, `line-spacing 값이 올바르지 않습니다: ${v}`);
          break;
        }
        case "border":
          if (v === "grid012" || v === "grey012" || v === "none") style.border = v;
          else this.warn(line, `border 는 grid012 | grey012 | none 만 가능합니다: ${v}`);
          break;
        case "border-color":
          style.borderColor = normalizeColor(v);
          break;
        case "caption":
          out.caption = v;
          break;
        case "header-rows": {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n >= 0) out.headerRows = n;
          else this.warn(line, `header-rows 값이 올바르지 않습니다: ${v}`);
          break;
        }
        default:
          this.warn(line, `알 수 없는 표 속성: ${k}`);
      }
    }
    if (Object.keys(style).length) out.style = style;
    return out;
  }

  private tableRow(trimmed: string, line: number): DslEvent[] {
    const ev: DslEvent[] = [];
    const cells = splitPipeRow(trimmed);
    // separator row |---|---| (also sets the column count)
    if (cells.length && cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "")) {
      if (cells.some((c) => c !== "")) {
        if (this.table) this.table.ncols = Math.max(this.table.ncols, cells.length);
        else this.warn(line, "표 구분 행(|---|) 앞에 머리글 행이 없습니다");
        return ev;
      }
    }
    if (!this.table) {
      const attrs = this.pendingAttrs ?? { role: "generic" as const, headerRows: 1, line };
      this.pendingAttrs = null;
      const input: BlockInput = { k: "table", role: attrs.role, rows: [], headerRows: attrs.headerRows };
      if (attrs.caption !== undefined) (input as TableBlock).caption = attrs.caption;
      if (attrs.widthsPt) (input as TableBlock).widthsPt = attrs.widthsPt;
      if (attrs.style) (input as TableBlock).style = attrs.style;
      const { block, event } = this.openNew(input);
      ev.push(event);
      this.table = { block: block as TableBlock, covered: new Map(), ncols: cells.length, headerRows: attrs.headerRows, line };
    }
    const t = this.table;
    if (cells.length > t.ncols && t.block.rows.length > 0) {
      this.warn(line, `표의 열 수가 머리글보다 많습니다 (${cells.length} > ${t.ncols})`);
    }
    t.ncols = Math.max(t.ncols, cells.length);
    const r = t.block.rows.length;
    const row: Row = { cells: [] };
    for (let c = 0; c < t.ncols; c++) {
      const raw = cells[c] ?? "";
      const key = `${r},${c}`;
      if (t.covered.has(key)) {
        if (raw !== "" && raw !== "^" && raw !== "<") this.warn(line, `병합 영역과 겹치는 셀 내용이 무시되었습니다: ${raw}`);
        row.cells.push({ inlines: [], covered: true });
        continue;
      }
      if (raw === "^" && r > 0) {
        const a = t.covered.get(`${r - 1},${c}`) ?? { r: r - 1, c };
        const anchor = t.block.rows[a.r].cells[a.c];
        anchor.rowSpan = Math.max(anchor.rowSpan ?? 1, r - a.r + 1);
        const w = anchor.colSpan ?? 1;
        for (let cc = a.c; cc < a.c + w; cc++) {
          t.covered.set(`${r},${cc}`, a);
          if (cc < c) {
            const prev = row.cells[cc];
            if (prev && !prev.covered && prev.inlines.length) this.warn(line, "병합 영역과 겹치는 셀 내용이 무시되었습니다");
            row.cells[cc] = { inlines: [], covered: true };
          }
        }
        row.cells.push({ inlines: [], covered: true });
        continue;
      }
      if (raw === "<" && c > 0) {
        const a = t.covered.get(`${r},${c - 1}`) ?? { r, c: c - 1 };
        const anchor = t.block.rows[a.r]?.cells[a.c] ?? row.cells[a.c];
        if (a.r === r) {
          anchor.colSpan = Math.max(anchor.colSpan ?? 1, c - a.c + 1);
          t.covered.set(key, a);
          row.cells.push({ inlines: [], covered: true });
          continue;
        }
        if (a.c + (anchor.colSpan ?? 1) - 1 >= c) {
          anchor.rowSpan = Math.max(anchor.rowSpan ?? 1, r - a.r + 1);
          t.covered.set(key, a);
          row.cells.push({ inlines: [], covered: true });
          continue;
        }
        this.warn(line, "'<' 병합이 올바르지 않습니다 (왼쪽 셀이 위 행과 병합된 셀입니다). 문자 그대로 처리");
      } else if (raw === "^" && r === 0) {
        this.warn(line, "첫 행에서는 '^' 병합을 쓸 수 없습니다. 문자 그대로 처리");
      } else if (raw === "<" && c === 0) {
        this.warn(line, "첫 열에서는 '<' 병합을 쓸 수 없습니다. 문자 그대로 처리");
      }
      const { inlines } = parseInlines(raw, (m) => this.warn(line, m));
      const cell: Cell = { inlines };
      row.cells.push(cell);
    }
    if (r < t.headerRows) row.isHeader = true;
    const firstText = row.cells.find((c) => !c.covered);
    if (firstText && r >= t.headerRows && TOTAL_RE.test(inlinesToPlain(firstText.inlines).trim())) row.isTotal = true;
    t.block.rows.push(row);
    ev.push(this.upsert(t.block));
    return ev;
  }

  // ---- fenced directives --------------------------------------------------------------------
  private openFence(trimmed: string, line: number): DslEvent[] {
    const m = FENCE_OPEN_RE.exec(trimmed);
    const name = (m?.[1] ?? "").toLowerCase();
    const args = m?.[2] ?? "";
    const ev: DslEvent[] = [];
    switch (name) {
      case "box": {
        const { block, event } = this.openNew({ k: "summaryBox", lines: [] });
        this.fence = { name, args, line, block, count: 0 };
        ev.push(event);
        break;
      }
      case "infobox": {
        if (this.family === "notice" && this.blocks.some((b) => b.k === "infoBox")) this.warn(line, "안내박스는 front-matter(접수)에서 이미 합성되었습니다. ```infobox 가 중복됩니다");
        const { block, event } = this.openNew({ k: "infoBox", groups: [] });
        this.fence = { name, args, line, block, count: 0 };
        ev.push(event);
        break;
      }
      case "flow": {
        const { block, event } = this.openNew({ k: "procedureFlow", stages: [] });
        this.fence = { name, args, line, block, count: 0 };
        ev.push(event);
        break;
      }
      case "attach": {
        const { block, event } = this.openNew({ k: "attachmentList", items: [] });
        this.fence = { name, args, line, block, count: 0 };
        ev.push(event);
        break;
      }
      case "image": {
        const input = this.parseImageArgs(args, line);
        if (!input) {
          this.swallowFenceClose = true;
          break;
        }
        const { block, event } = this.openNew(input);
        this.fence = { name, args, line, block, count: 0 };
        ev.push(event);
        break;
      }
      case "toc":
        this.fence = { name, args, line, block: null, count: 0 };
        break;
      default:
        this.warn(line, name ? `알 수 없는 펜스 블록: \`\`\`${name} (내용을 일반 본문으로 해석)` : "이름 없는 ``` 펜스는 무시합니다 (내용을 일반 본문으로 해석)");
        this.swallowFenceClose = true;
    }
    return ev;
  }

  private parseImageArgs(args: string, line: number): BlockInput | null {
    const tokens = args.split(/\s+/).filter(Boolean);
    const asset = tokens.find((t) => !t.includes("="));
    if (!asset) {
      this.warn(line, "```image 에 자산 이름이 없습니다 (예: ```image logo width=92.3mm)");
      return null;
    }
    const kv = parseKeyValues(tokens.filter((t) => t.includes("=")).join(" "));
    const img: Extract<BlockInput, { k: "image" }> = { k: "image", asset };
    const len = (v: string | undefined): number | undefined => {
      if (v === undefined) return undefined;
      const m = /^(\d+(?:\.\d+)?)\s*(mm|pt)?$/i.exec(v);
      if (!m) {
        this.warn(line, `image 크기 값이 올바르지 않습니다: ${v}`);
        return undefined;
      }
      const n = parseFloat(m[1]);
      return (m[2] ?? "mm").toLowerCase() === "pt" ? Math.round(n * (25.4 / 72) * 100) / 100 : n;
    };
    const w = len(kv.width);
    const h = len(kv.height);
    if (w !== undefined) img.widthMm = w;
    if (h !== undefined) img.heightMm = h;
    if (asset === "logo" && w === undefined && h === undefined) {
      img.widthMm = 92.3;
      img.heightMm = 13.3;
    }
    if (kv.align === "left" || kv.align === "center") img.align = kv.align;
    else if (kv.align) this.warn(line, `image align 은 left | center 만 가능합니다: ${kv.align}`);
    for (const k of Object.keys(kv)) if (!["width", "height", "align"].includes(k)) this.warn(line, `알 수 없는 image 속성: ${k}`);
    return img;
  }

  private fenceLine(text: string, line: number): DslEvent[] {
    const f = this.fence!;
    const trimmed = text.trim();
    if (FENCE_CLOSE_RE.test(trimmed)) return this.closeFence(line);
    f.count += 1;
    switch (f.name) {
      case "box": {
        const b = f.block as Extract<Block, { k: "summaryBox" }>;
        if (trimmed === "") return [];
        let content = trimmed;
        if (b.lines.length === 0 && (content.startsWith("❖") || content.startsWith("◇"))) {
          b.glyph = content[0] as "❖" | "◇";
          content = content.slice(1).trim();
        }
        b.lines.push(parseInlines(content, (m) => this.warn(line, m)).inlines);
        return [this.upsert(b)];
      }
      case "infobox": {
        const b = f.block as Extract<Block, { k: "infoBox" }>;
        if (trimmed === "") return [];
        const { glyph, rest } = splitGlyph(trimmed);
        if (glyph === "□" || glyph === "■") {
          b.groups.push({ heading: rest, items: [] });
        } else {
          if (!b.groups.length) b.groups.push({ heading: "", items: [] });
          b.groups[b.groups.length - 1].items.push(parseInlines(rest, (m) => this.warn(line, m)).inlines);
        }
        return [this.upsert(b)];
      }
      case "flow": {
        const b = f.block as Extract<Block, { k: "procedureFlow" }>;
        if (trimmed === "") return [];
        const parts = splitPipeRow(trimmed);
        b.stages.push({ name: parts[0] ?? "", when: parts.slice(1).join(" | ") });
        return [this.upsert(b)];
      }
      case "attach": {
        const b = f.block as Extract<Block, { k: "attachmentList" }>;
        if (trimmed === "" || /^끝\.?$/.test(trimmed)) return [];
        b.items.push(trimmed);
        return [this.upsert(b)];
      }
      case "image": {
        // an ```image directive is normally followed directly by the closing fence; if a
        // real body line shows up instead, close the image and process the line normally
        this.fence = null;
        const ev = f.block ? [this.commit(f.block)] : [];
        this.warn(f.line, "```image 펜스가 닫히지 않았습니다 (자동으로 닫음)");
        return [...ev, ...this.processBodyLine(text, line, 0)];
      }
      case "toc": {
        if (trimmed === "") return [];
        const { inlines } = parseInlines(trimmed, (m) => this.warn(line, m));
        return [this.commitNew({ k: "para", role: "tocLine", inlines })];
      }
    }
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// utilities

export function formatId(n: number): string {
  return "b" + String(n).padStart(3, "0");
}

function normalizeColor(v: string): string {
  const s = v.trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : s;
}

/** Split a GFM pipe row into trimmed cell strings; `\|` is a literal pipe. */
export function splitPipeRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "\\|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function appendInlines(target: Inline[], add: Inline[]): void {
  for (const inl of add) {
    if (inl.t === "text") pushText(target, inl.text, { bold: inl.bold, color: inl.color });
    else target.push(inl);
  }
}

/** Convenience used by tests/tools: split text into lines the way the parser does. */
export function splitLines(text: string): string[] {
  const lines = normalizeNewlines(text).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
