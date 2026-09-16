/** Shared build context passed to every block handler. */
import type { XmlNode } from "../xml";
import { StyleRegistry, type CharSpec, type FontRole, type ParaSpec } from "../registry";
import { IdGen } from "../ids";
import type { Template } from "../template";
import { paragraph, type RunSpec } from "../emit/paragraph";
import type { Inline, Family } from "../../docmodel/schema";
import { LINESEG_WIDTH } from "../units";

export interface BuildWarning {
  blockId?: string;
  message: string;
}

export class WriterContext {
  readonly reg: StyleRegistry;
  readonly ids = new IdGen();
  readonly warnings: BuildWarning[] = [];
  /** set by a pageBreak block; consumed by the next emitted top-level paragraph */
  pendingPageBreak = false;
  /** last body glyph emitted (□ ㅇ - …) — used for context-aware note indentation */
  prevGlyph: string | undefined;
  /** build option: emit approximate linesegs (see docs/adr/0003-lineseg.md) */
  lineseg = false;
  constructor(readonly tpl: Template, readonly family: Family, opts: { lineseg?: boolean } = {}) {
    this.reg = new StyleRegistry(tpl);
    this.lineseg = !!opts.lineseg;
  }

  /** Approximate advance width of a string in HWPUNIT at the given size (Hangul = 1em, ASCII = 0.5em). */
  textWidth(s: string, pt: number): number {
    let w = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      const full = cp > 0x2e7f || cp === 0x203b || cp === 0x25a1 || cp === 0x3147 || cp === 0x25cb || cp === 0x25e6;
      w += full ? pt * 100 : pt * 50;
    }
    return Math.round(w);
  }

  /** Estimate number of wrapped lines for a string in a given width. */
  lineCount(s: string, pt: number, width: number): number {
    return Math.max(
      1,
      s.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(this.textWidth(line, pt) / Math.max(width, 1))), 0),
    );
  }

  /** Build run specs for inlines using a base char spec (role font/size); bold/color/size overrides create variants. */
  runsFor(inlines: Inline[], base: CharSpec, baseCharPr?: number): RunSpec[] {
    const runs: RunSpec[] = [];
    for (const inl of inlines) {
      if (inl.t === "br") {
        const last = runs[runs.length - 1];
        if (last && last.text !== undefined && last.href === undefined) last.text += "\n";
        else runs.push({ charPr: baseCharPr ?? this.reg.charPr(base), text: "\n" });
        continue;
      }
      const overridden = inl.t === "text" && (inl.bold || inl.color || inl.size || inl.font);
      const spec: CharSpec = overridden
        ? {
            ...base,
            bold: inl.t === "text" && inl.bold ? true : base.bold,
            color: inl.t === "text" && inl.color ? inl.color : base.color,
            pt: inl.t === "text" && inl.size ? inl.size : base.pt,
            font: inl.t === "text" && inl.font ? (inl.font as FontRole) : base.font,
          }
        : base;
      const charPr = overridden || baseCharPr === undefined ? this.reg.charPr(spec) : baseCharPr;
      if (inl.t === "link") runs.push({ charPr, text: inl.text, href: inl.href, fieldId: this.ids.nextShapeId() });
      else runs.push({ charPr, text: inl.text });
    }
    if (runs.length === 0) runs.push({ charPr: baseCharPr ?? this.reg.charPr(base), text: "" });
    return runs;
  }

  /** Emit a top-level paragraph, consuming a pending page break. */
  para(opts: { paraPr: number; runs: RunSpec[]; vertsize?: number; lineSpacing?: number; horzsize?: number; forcePageBreak?: boolean }): XmlNode {
    const pb = opts.forcePageBreak || this.pendingPageBreak;
    this.pendingPageBreak = false;
    return paragraph({
      id: this.ids.nextParaId(),
      paraPr: opts.paraPr,
      runs: opts.runs,
      pageBreak: pb,
      vertsize: opts.vertsize,
      lineSpacing: opts.lineSpacing,
      horzsize: opts.horzsize ?? LINESEG_WIDTH,
      lineseg: this.lineseg,
    });
  }

  /** Paragraph inside a table cell (never consumes the page-break flag). */
  cellPara(opts: { paraPr: number; runs: RunSpec[]; vertsize?: number; lineSpacing?: number; horzsize: number }): XmlNode {
    return paragraph({ id: this.ids.nextParaId(), paraPr: opts.paraPr, runs: opts.runs, vertsize: opts.vertsize, lineSpacing: opts.lineSpacing, horzsize: opts.horzsize, lineseg: this.lineseg });
  }

  roleOr(name: string, fallback: { para: ParaSpec; char: CharSpec }): { paraPr: number; charPr: number } {
    const r = this.reg.role(name);
    if (r) return r;
    return { paraPr: this.reg.paraPr(fallback.para), charPr: this.reg.charPr(fallback.char) };
  }
}
