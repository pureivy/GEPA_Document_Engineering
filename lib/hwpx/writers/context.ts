/** Shared build context passed to every block handler. */
import type { XmlNode } from "../xml";
import { StyleRegistry, type CharSpec, type FontRole, type ParaSpec } from "../registry";
import { IdGen } from "../ids";
import type { Template } from "../template";
import { paragraph, type RunSpec } from "../emit/paragraph";
import type { Inline, Family } from "../../docmodel/schema";
import { LINESEG_WIDTH } from "../units";
import type { LineFit } from "../build";

export interface BuildWarning {
  blockId?: string;
  message: string;
}

/** 문서 밖 그림(사진 대지)의 바이트 — build 가 BinData 로 싣는다 */
export interface BinaryAsset {
  id: string;
  href: string;
  mediaType: string;
  bytes: Uint8Array;
}
export type AssetResolver = (src: string) => { bytes: Uint8Array; mediaType: string } | undefined;

/** 글자 위치(문단 처음부터, 한 글자씩)에 줄 바꿈을 넣는다 — 뒤에서부터 넣어 앞 위치가 밀리지 않게 */
function insertBreaks(runs: RunSpec[], breaks: number[]): RunSpec[] {
  const out = runs.map((r) => ({ ...r }));
  for (const at of [...breaks].sort((a, b) => b - a)) {
    let pos = 0;
    for (const r of out) {
      if (r.text === undefined || r.nodes?.length) continue;
      const len = [...r.text].length;
      if (at > pos && at <= pos + len) {
        const chars = [...r.text];
        chars.splice(at - pos, 0, "\n");
        r.text = chars.join("");
        break;
      }
      pos += len;
    }
  }
  return out;
}

export class WriterContext {
  readonly reg: StyleRegistry;
  /** 사진 대지 등 문서가 새로 싣는 그림(BinData) — 같은 src 는 한 번만 */
  readonly binaries: BinaryAsset[] = [];
  private readonly binBySrc = new Map<string, BinaryAsset>();
  /** src → 그림 바이트. 없으면 사진을 싣지 못하고 경고만 남긴다 */
  assets?: AssetResolver;
  readonly ids = new IdGen();
  readonly warnings: BuildWarning[] = [];
  /** set by a pageBreak block; consumed by the next emitted top-level paragraph */
  pendingPageBreak = false;
  /** last body glyph emitted (□ ㅇ - …) — used for context-aware note indentation */
  prevGlyph: string | undefined;
  /** "(단위: 원)" 줄 문단과 표 앵커 문단 — build 가 나뉘는 표 앞의 (단위) 줄에 다음 문단과 함께를 건다(mergeCaptionTables) */
  readonly captionParas = new WeakSet<object>();
  readonly inlineTableAnchors = new WeakSet<object>();
  readonly splitTableAnchors = new WeakSet<object>();
  /** 쪽 아래 끝까지 채울 표(블록 id·hp:tbl id) — buildLaidOut 이 줄 간격을 키워 다시 빌드한다(keepPass.ts) */
  readonly fillPageTables: { blockId: string; tblId: string }[] = [];
  /** 채울 표의 줄 간격(블록 id → %) — buildLaidOut 이 배치를 재 보고 정한다 */
  fillSpacing: Record<string, number> = {};
  /** 본문 줄 간격 배율(hp:p id → 배율) — 쪽 아래가 크게 비는 쪽을 채운다(keepPass.buildLaidOut) */
  spacingBoost: Record<string, number> = {};
  /** 문단 위 간격을 없앨 문단(hp:p id) — 쪽 맨 위에 온 제목·띠는 위 여백 없이(담당자 2026-10-13) */
  noPrev = new Set<string>();
  /** 문단별 줄 맞춤(hp:p id → 내어쓰기 HWPUNIT·자간 %) — 실제 배치로 재서 정한다(keepPass.fitLines) */
  lineFit: Record<string, LineFit> = {};
  /** build option: emit approximate linesegs (see docs/adr/0003-lineseg.md) */
  lineseg = false;
  constructor(readonly tpl: Template, readonly family: Family, opts: { lineseg?: boolean } = {}) {
    this.reg = new StyleRegistry(tpl);
    this.lineseg = !!opts.lineseg;
  }

  /** 사진 파일을 BinData 로 등록하고 id(binaryItemIDRef)를 돌려준다. 읽을 수 없으면 undefined */
  addBinary(src: string): BinaryAsset | undefined {
    const hit = this.binBySrc.get(src);
    if (hit) return hit;
    const a = this.assets?.(src);
    if (!a) return undefined;
    const used = new Set([...Object.keys(this.tpl.pics), ...Object.keys(this.tpl.files).map((f) => f.replace(/^BinData\/|\.[^.]+$/g, ""))]);
    let n = this.binaries.length + 1;
    while (used.has(`photo${n}`)) n++;
    const ext = a.mediaType === "image/png" ? "png" : a.mediaType === "image/bmp" ? "bmp" : "jpg";
    const asset: BinaryAsset = { id: `photo${n}`, href: `BinData/photo${n}.${ext}`, mediaType: a.mediaType, bytes: a.bytes };
    this.binaries.push(asset);
    this.binBySrc.set(src, asset);
    return asset;
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

  /**
   * 어절 단위 줄 바꿈으로 센 줄 수 — 한글은 어절을 쪼개지 않고(breakNonLatinWord KEEP_WORD) 다음 줄로 넘긴다.
   * 글자 폭 합만으로 세면(lineCount) 줄 끝 빈자리를 놓쳐 표 칸 높이가 모자랐다("비용 지원"이 잘림, 2026-10-12).
   */
  wrapLines(s: string, pt: number, width: number): number {
    const w = Math.max(width, 1);
    const space = this.textWidth(" ", pt);
    let total = 0;
    for (const line of s.split("\n")) {
      let n = 1, x = 0;
      for (const word of line.split(" ").filter(Boolean)) {
        let ww = this.textWidth(word, pt);
        const need = x === 0 ? ww : x + space + ww;
        if (need <= w) { x = need; continue; }
        if (x > 0) n++;
        // 한 줄보다 긴 어절은 글자 단위로 꺾인다
        while (ww > w) { n++; ww -= w; }
        x = ww;
      }
      total += n;
    }
    return Math.max(1, total);
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
    const id = this.ids.nextParaId();
    let { paraPr, lineSpacing } = opts;
    // 쪽 채우기 — 글 문단(표·그림을 품지 않은 문단)만 줄 간격을 늘린다
    const boost = this.spacingBoost[String(id)];
    if (boost && opts.runs.every((r) => !r.nodes?.length)) {
      const ls = this.reg.paraPrInfo(paraPr)?.lineSpacing;
      if (ls) {
        paraPr = this.reg.withLineSpacing(paraPr, Math.round(ls * boost));
        lineSpacing = Math.round((lineSpacing ?? ls) * boost);
      }
    }
    if (this.noPrev.has(String(id))) paraPr = this.reg.withoutPrev(paraPr);
    const fitted = this.applyLineFit(id, paraPr, opts.runs);
    paraPr = fitted.paraPr;
    const runs = fitted.runs;
    return paragraph({
      id,
      paraPr,
      runs,
      pageBreak: pb,
      vertsize: opts.vertsize,
      lineSpacing,
      horzsize: opts.horzsize ?? LINESEG_WIDTH,
      lineseg: this.lineseg,
    });
  }

  /** 줄 맞춤(내어쓰기·자간) — keepPass.fitLines 가 잰 값을 문단 모양·글자 모양 변형으로 */
  private applyLineFit(id: number, paraPr: number, runs: RunSpec[]): { paraPr: number; runs: RunSpec[] } {
    const fit = this.lineFit[String(id)];
    if (!fit) return { paraPr, runs };
    if (fit.hanging !== undefined && (this.reg.paraPrInfo(paraPr)?.intent ?? 0) < 0) paraPr = this.reg.withHanging(paraPr, fit.hanging);
    if (fit.charSpacing) runs = runs.map((r) => (r.text !== undefined && !r.nodes?.length ? { ...r, charPr: this.reg.withCharSpacing(r.charPr, fit.charSpacing!) } : r));
    if (fit.sizePct && fit.sizePct !== 100) runs = runs.map((r) => (r.text !== undefined && !r.nodes?.length ? { ...r, charPr: this.reg.withCharScale(r.charPr, fit.sizePct!) } : r));
    if (fit.breaks?.length) runs = insertBreaks(runs, fit.breaks);
    return { paraPr, runs };
  }

  /** Paragraph inside a table cell (never consumes the page-break flag). */
  cellPara(opts: { paraPr: number; runs: RunSpec[]; vertsize?: number; lineSpacing?: number; horzsize: number }): XmlNode {
    const id = this.ids.nextParaId();
    const { paraPr, runs } = this.applyLineFit(id, opts.paraPr, opts.runs);
    return paragraph({ id, paraPr, runs, vertsize: opts.vertsize, lineSpacing: opts.lineSpacing, horzsize: opts.horzsize, lineseg: this.lineseg });
  }

  roleOr(name: string, fallback: { para: ParaSpec; char: CharSpec }): { paraPr: number; charPr: number } {
    const r = this.reg.role(name);
    if (r) return r;
    return { paraPr: this.reg.paraPr(fallback.para), charPr: this.reg.charPr(fallback.char) };
  }
}
