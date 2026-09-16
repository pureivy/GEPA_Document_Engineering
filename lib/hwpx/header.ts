/**
 * Parses Contents/header.xml into a style catalog: fonts, charPr, paraPr, borderFill
 * with normalized "signatures" so the writer can look styles up by meaning.
 */
import { attr, child, childrenNamed, findFirst, type XmlNode } from "./xml";

export type FontLang = "HANGUL" | "LATIN" | "HANJA" | "JAPANESE" | "OTHER" | "SYMBOL" | "USER";
export const FONT_LANGS: FontLang[] = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"];

export interface CharPrSig {
  id: number;
  pt: number; // height / 100
  hangul: string; // font face name
  latin: string;
  bold: boolean;
  italic: boolean;
  color: string;
  spacing: number; // hangul letter spacing %
  ratio: number; // hangul width %
  underline: string; // NONE | BOTTOM ...
  fontRefs: Record<FontLang, number>;
}
export interface ParaPrSig {
  id: number;
  align: string; // JUSTIFY | LEFT | CENTER | RIGHT | DISTRIBUTE
  lineSpacingType: string; // PERCENT | FIXED | BETWEEN_LINES
  lineSpacing: number;
  intent: number;
  left: number;
  right: number;
  prev: number;
  next: number;
  keepWithNext: boolean;
}
export interface BorderSide { type: string; width: string; color: string }
export interface BorderFillSig {
  id: number;
  left: BorderSide;
  right: BorderSide;
  top: BorderSide;
  bottom: BorderSide;
  fill: string | null; // #RRGGBB winBrush faceColor
  gradient: { colors: string[]; angle: string } | null;
}
export interface HeaderCatalog {
  fonts: Record<FontLang, Record<number, string>>;
  fontIdByFace: Record<FontLang, Record<string, number>>;
  charPr: CharPrSig[];
  paraPr: ParaPrSig[];
  borderFill: BorderFillSig[];
  counts: { charPr: number; paraPr: number; borderFill: number; style: number };
}

export function refList(head: XmlNode): XmlNode {
  const rl = child(head, "hh:refList");
  if (!rl) throw new Error("header.xml: missing hh:refList");
  return rl;
}

export function parseHeaderCatalog(head: XmlNode): HeaderCatalog {
  const rl = refList(head);
  const fonts = {} as HeaderCatalog["fonts"];
  const fontIdByFace = {} as HeaderCatalog["fontIdByFace"];
  const fontfaces = child(rl, "hh:fontfaces");
  for (const ff of fontfaces ? childrenNamed(fontfaces, "hh:fontface") : []) {
    const lang = attr(ff, "lang") as FontLang;
    fonts[lang] = {};
    fontIdByFace[lang] = {};
    for (const f of childrenNamed(ff, "hh:font")) {
      const id = Number(attr(f, "id"));
      const face = attr(f, "face") ?? "";
      fonts[lang][id] = face;
      fontIdByFace[lang][face] = id;
    }
  }

  const charPr: CharPrSig[] = [];
  const cps = child(rl, "hh:charProperties");
  for (const cp of cps ? childrenNamed(cps, "hh:charPr") : []) {
    const fr = child(cp, "hh:fontRef");
    const fontRefs = {} as Record<FontLang, number>;
    for (const l of FONT_LANGS) fontRefs[l] = Number(fr?.attrs[l.toLowerCase()] ?? 0);
    const sp = child(cp, "hh:spacing");
    const ra = child(cp, "hh:ratio");
    const ul = child(cp, "hh:underline");
    charPr.push({
      id: Number(attr(cp, "id")),
      pt: Number(attr(cp, "height")) / 100,
      hangul: fonts.HANGUL?.[fontRefs.HANGUL] ?? "",
      latin: fonts.LATIN?.[fontRefs.LATIN] ?? "",
      bold: !!child(cp, "hh:bold"),
      italic: !!child(cp, "hh:italic"),
      color: (attr(cp, "textColor") ?? "#000000").toUpperCase(),
      spacing: Number(sp?.attrs.hangul ?? 0),
      ratio: Number(ra?.attrs.hangul ?? 100),
      underline: ul?.attrs.type ?? "NONE",
      fontRefs,
    });
  }

  const paraPr: ParaPrSig[] = [];
  const pps = child(rl, "hh:paraProperties");
  for (const pp of pps ? childrenNamed(pps, "hh:paraPr") : []) {
    const align = child(pp, "hh:align");
    const brk = child(pp, "hh:breakSetting");
    // values live under hp:switch/hp:default (and hp:case); read the default branch
    const sw = child(pp, "hp:switch");
    const def = sw ? child(sw, "hp:default") : undefined;
    const margin = def ? child(def, "hh:margin") : child(pp, "hh:margin");
    const ls = def ? child(def, "hh:lineSpacing") : child(pp, "hh:lineSpacing");
    const m = (n: string) => Number((margin ? child(margin, `hc:${n}`) : undefined)?.attrs.value ?? 0);
    paraPr.push({
      id: Number(attr(pp, "id")),
      align: align?.attrs.horizontal ?? "JUSTIFY",
      lineSpacingType: ls?.attrs.type ?? "PERCENT",
      lineSpacing: Number(ls?.attrs.value ?? 160),
      intent: m("intent"),
      left: m("left"),
      right: m("right"),
      prev: m("prev"),
      next: m("next"),
      keepWithNext: brk?.attrs.keepWithNext === "1",
    });
  }

  const borderFill: BorderFillSig[] = [];
  const bfs = child(rl, "hh:borderFills");
  const side = (bf: XmlNode, n: string): BorderSide => {
    const s = child(bf, n);
    return { type: s?.attrs.type ?? "NONE", width: s?.attrs.width ?? "0.12 mm", color: (s?.attrs.color ?? "#000000").toUpperCase() };
  };
  for (const bf of bfs ? childrenNamed(bfs, "hh:borderFill") : []) {
    const fb = child(bf, "hc:fillBrush");
    const win = fb ? child(fb, "hc:winBrush") : undefined;
    const grad = fb ? child(fb, "hc:gradation") : undefined;
    borderFill.push({
      id: Number(attr(bf, "id")),
      left: side(bf, "hh:leftBorder"),
      right: side(bf, "hh:rightBorder"),
      top: side(bf, "hh:topBorder"),
      bottom: side(bf, "hh:bottomBorder"),
      fill: win ? (win.attrs.faceColor ?? "").toUpperCase() : null,
      gradient: grad ? { colors: childrenNamed(grad, "hc:color").map((c) => (c.attrs.value ?? "").toUpperCase()), angle: grad.attrs.angle ?? "0" } : null,
    });
  }
  const styles = child(rl, "hh:styles");
  return {
    fonts,
    fontIdByFace,
    charPr,
    paraPr,
    borderFill,
    counts: {
      charPr: charPr.length,
      paraPr: paraPr.length,
      borderFill: borderFill.length,
      style: styles ? childrenNamed(styles, "hh:style").length : 0,
    },
  };
}

export function charPrSignature(c: Omit<CharPrSig, "id" | "fontRefs">): string {
  return [c.hangul, c.latin, c.pt, c.bold ? "B" : "", c.italic ? "I" : "", c.color, c.spacing, c.ratio, c.underline].join("|");
}
export function paraPrSignature(p: Omit<ParaPrSig, "id">): string {
  return [p.align, p.lineSpacingType, p.lineSpacing, p.intent, p.left, p.right, p.prev, p.next, p.keepWithNext ? "K" : ""].join("|");
}
export function borderSideSignature(s: BorderSide): string {
  return s.type === "NONE" ? "NONE" : `${s.type} ${s.width} ${s.color}`;
}
export function borderFillSignature(b: Omit<BorderFillSig, "id">): string {
  return [borderSideSignature(b.left), borderSideSignature(b.right), borderSideSignature(b.top), borderSideSignature(b.bottom), b.fill ?? "", b.gradient ? `G:${b.gradient.colors.join(">")}@${b.gradient.angle}` : ""].join("|");
}

/** Section root helper: header.xml <hh:head> opening tag namespaces are reused for section0. */
export function headVersion(head: XmlNode): string {
  return attr(head, "version") ?? "1.2";
}
export { findFirst };
