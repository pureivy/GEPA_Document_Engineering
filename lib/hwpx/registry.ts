/**
 * StyleRegistry resolves style *meaning* → header ids. It first looks the normalized
 * signature up in the template catalog; on a miss it clones the closest catalogued
 * element, edits the differing attributes, appends it to header.xml (bumping itemCnt)
 * and records the addition in the build report. This is the only header mutation.
 */
import { child, childrenNamed, clone, el, isNode, type XmlNode } from "./xml";
import {
  borderFillSignature,
  charPrSignature,
  paraPrSignature,
  refList,
  type BorderFillSig,
  type BorderSide,
  type CharPrSig,
  type FontLang,
  type HeaderCatalog,
  type ParaPrSig,
  FONT_LANGS,
} from "./header";
import { normColor } from "./units";
import type { Template } from "./template";

export type FontRole = "heading" | "body" | "table" | "note" | "approval" | "gulim" | "batang" | "moum";
const FACE: Record<FontRole, string> = {
  heading: "HY헤드라인M",
  body: "휴먼명조",
  table: "맑은 고딕",
  note: "한양중고딕",
  approval: "돋움",
  gulim: "굴림",
  /** 함초롬바탕 — 보도자료 본문/제목 (press reference) */
  batang: "함초롬바탕",
  /** 휴먼모음T — 보도자료 머리표 배포일 */
  moum: "휴먼모음T",
};
const LATIN_PARTNER: Record<string, string> = { 휴먼명조: "HCI Poppy" };

export interface CharSpec {
  font?: FontRole | string; // role or explicit face
  pt: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  spacing?: number; // %
  ratio?: number; // %
  underline?: boolean;
}
export interface ParaSpec {
  align?: "JUSTIFY" | "LEFT" | "CENTER" | "RIGHT" | "DISTRIBUTE";
  lineSpacing?: number; // percent
  /** hanging indent in HWPUNIT (positive number = 내어쓰기 amount) */
  hanging?: number;
  /** first-line indent in HWPUNIT */
  firstLine?: number;
  left?: number;
  right?: number;
  prev?: number; // space before, HWPUNIT
  next?: number;
  keepWithNext?: boolean;
}
export type SideSpec = "none" | { type?: "SOLID" | "DASH" | "DOT" | "DOUBLE_SLIM" | "NONE"; widthMm?: number; color?: string };
export interface BorderFillSpec {
  l?: SideSpec;
  r?: SideSpec;
  t?: SideSpec;
  b?: SideSpec;
  fill?: string | null;
  gradient?: { colors: string[]; angle?: string } | null;
}

export interface AppendedStyle {
  kind: "charPr" | "paraPr" | "borderFill";
  id: number;
  sig: string;
}

function fmtWidth(mm: number): string {
  return `${mm} mm`;
}

export class StyleRegistry {
  readonly header: XmlNode;
  private cat: HeaderCatalog;
  private charBySig = new Map<string, number>();
  private paraBySig = new Map<string, number>();
  private bfBySig = new Map<string, number>();
  readonly appended: AppendedStyle[] = [];
  readonly warnings: string[] = [];

  constructor(private tpl: Template) {
    this.header = clone(tpl.header);
    this.cat = structuredClone(tpl.catalog); // per-build copy: appends must not leak into the shared template
    for (const c of this.cat.charPr) if (!this.charBySig.has(charPrSignature(c))) this.charBySig.set(charPrSignature(c), c.id);
    for (const p of this.cat.paraPr) if (!this.paraBySig.has(paraPrSignature(p))) this.paraBySig.set(paraPrSignature(p), p.id);
    for (const b of this.cat.borderFill) if (!this.bfBySig.has(borderFillSignature(b))) this.bfBySig.set(borderFillSignature(b), b.id);
  }

  /** role lookup from the hand-curated style-map; undefined when not mapped */
  role(name: string): { paraPr: number; charPr: number } | undefined {
    return this.tpl.roles.para[name];
  }
  roleBorderFill(name: string): number | undefined {
    return this.tpl.roles.borderFill[name];
  }
  charPrInfo(id: number): CharPrSig | undefined {
    return this.cat.charPr.find((c) => c.id === id);
  }
  paraPrInfo(id: number): ParaPrSig | undefined {
    return this.cat.paraPr.find((p) => p.id === id);
  }

  private resolveFace(font: FontRole | string | undefined): string {
    if (!font) return FACE.body;
    return (FACE as Record<string, string>)[font] ?? font;
  }
  /** Whether the template's Hangul font table contains this face. */
  hasFace(face: string): boolean {
    return this.cat.fontIdByFace.HANGUL?.[face] !== undefined;
  }
  /** Hangul face name for a font role (or an explicit face). */
  faceOf(font: FontRole | string | undefined): string {
    return this.resolveFace(font);
  }

  charPr(spec: CharSpec): number {
    const face = this.resolveFace(spec.font);
    const latinWanted = LATIN_PARTNER[face] ?? face;
    const want: Omit<CharPrSig, "id" | "fontRefs"> = {
      pt: spec.pt,
      hangul: face,
      latin: latinWanted,
      bold: !!spec.bold,
      italic: !!spec.italic,
      color: normColor(spec.color ?? "#000000"),
      spacing: spec.spacing ?? 0,
      ratio: spec.ratio ?? 100,
      underline: spec.underline ? "BOTTOM" : "NONE",
    };
    const sig = charPrSignature(want);
    const hit = this.charBySig.get(sig);
    if (hit !== undefined) return hit;
    // also accept a catalogued entry whose latin partner differs but everything else matches
    const loose = this.cat.charPr.find(
      (c) => c.hangul === face && c.pt === want.pt && c.bold === want.bold && c.italic === want.italic && c.color === want.color && c.spacing === want.spacing && c.ratio === want.ratio && c.underline === want.underline,
    );
    if (loose) {
      this.charBySig.set(sig, loose.id);
      return loose.id;
    }
    return this.appendCharPr(want, sig);
  }

  private appendCharPr(want: Omit<CharPrSig, "id" | "fontRefs">, sig: string): number {
    const list = child(refList(this.header), "hh:charProperties");
    if (!list) throw new Error("header: no hh:charProperties");
    const proto = this.cat.charPr.find((c) => c.hangul === want.hangul) ?? this.cat.charPr.find((c) => c.hangul === FACE.body) ?? this.cat.charPr[0];
    const protoNode = childrenNamed(list, "hh:charPr").find((n) => Number(n.attrs.id) === proto.id);
    if (!protoNode) throw new Error(`header: charPr ${proto.id} not found`);
    const node = clone(protoNode);
    const id = childrenNamed(list, "hh:charPr").length;
    node.attrs.id = String(id);
    node.attrs.height = String(Math.round(want.pt * 100));
    node.attrs.textColor = want.color;
    // font refs: keep the prototype's when faces match, else map by face name per language
    if (proto.hangul !== want.hangul) {
      const fr = child(node, "hh:fontRef");
      if (fr) for (const l of FONT_LANGS) {
        const id2 = this.cat.fontIdByFace[l]?.[want.hangul] ?? this.cat.fontIdByFace[l]?.[FACE.table] ?? 0;
        fr.attrs[l.toLowerCase()] = String(id2);
      }
      if (!this.cat.fontIdByFace.HANGUL?.[want.hangul]) this.warnings.push(`font face "${want.hangul}" not in template; substituted`);
    }
    const setAll = (name: string, v: number) => {
      const n = child(node, name);
      if (n) for (const l of FONT_LANGS) n.attrs[l.toLowerCase()] = String(v);
    };
    setAll("hh:spacing", want.spacing);
    setAll("hh:ratio", want.ratio);
    // bold / italic flags are empty child elements placed before hh:underline
    node.children = node.children.filter((c) => !(isNode(c) && (c.name === "hh:bold" || c.name === "hh:italic")));
    const ulIdx = node.children.findIndex((c) => isNode(c) && c.name === "hh:underline");
    const flags: XmlNode[] = [];
    if (want.bold) flags.push(el("hh:bold"));
    if (want.italic) flags.push(el("hh:italic"));
    node.children.splice(ulIdx < 0 ? node.children.length : ulIdx, 0, ...flags);
    const ul = child(node, "hh:underline");
    if (ul) ul.attrs.type = want.underline;
    list.children.push(node);
    list.attrs.itemCnt = String(id + 1);
    const fontRefs = {} as Record<FontLang, number>;
    const fr = child(node, "hh:fontRef");
    for (const l of FONT_LANGS) fontRefs[l] = Number(fr?.attrs[l.toLowerCase()] ?? 0);
    this.cat.charPr.push({ ...want, id, fontRefs });
    this.charBySig.set(sig, id);
    this.appended.push({ kind: "charPr", id, sig });
    return id;
  }

  paraPr(spec: ParaSpec): number {
    const want: Omit<ParaPrSig, "id"> = {
      align: spec.align ?? "JUSTIFY",
      lineSpacingType: "PERCENT",
      lineSpacing: spec.lineSpacing ?? 160,
      // header.xml hp:default stores 2× HWPUNIT
      intent: 2 * (spec.hanging ? -Math.round(spec.hanging) : Math.round(spec.firstLine ?? 0)),
      left: 2 * Math.round(spec.left ?? 0),
      right: 2 * Math.round(spec.right ?? 0),
      prev: 2 * Math.round(spec.prev ?? 0),
      next: 2 * Math.round(spec.next ?? 0),
      keepWithNext: !!spec.keepWithNext,
    };
    const sig = paraPrSignature(want);
    const hit = this.paraBySig.get(sig);
    if (hit !== undefined) return hit;
    return this.appendParaPr(want, sig);
  }

  private appendParaPr(want: Omit<ParaPrSig, "id">, sig: string): number {
    const list = child(refList(this.header), "hh:paraProperties");
    if (!list) throw new Error("header: no hh:paraProperties");
    // prototype: same alignment & line spacing if possible, else the body paraPr
    const proto =
      this.cat.paraPr.find((p) => p.align === want.align && p.lineSpacing === want.lineSpacing) ?? this.cat.paraPr.find((p) => p.align === "JUSTIFY") ?? this.cat.paraPr[0];
    const protoNode = childrenNamed(list, "hh:paraPr").find((n) => Number(n.attrs.id) === proto.id);
    if (!protoNode) throw new Error(`header: paraPr ${proto.id} not found`);
    const node = clone(protoNode);
    const id = childrenNamed(list, "hh:paraPr").length;
    node.attrs.id = String(id);
    const align = child(node, "hh:align");
    if (align) align.attrs.horizontal = want.align;
    const brk = child(node, "hh:breakSetting");
    if (brk) brk.attrs.keepWithNext = want.keepWithNext ? "1" : "0";
    const apply = (container: XmlNode | undefined, factor: number) => {
      if (!container) return;
      const m = child(container, "hh:margin");
      const set = (n: string, v: number) => {
        const c = m ? child(m, `hc:${n}`) : undefined;
        if (c) c.attrs.value = String(Math.round(v * factor));
      };
      set("intent", want.intent);
      set("left", want.left);
      set("right", want.right);
      set("prev", want.prev);
      set("next", want.next);
      const ls = child(container, "hh:lineSpacing");
      if (ls) {
        ls.attrs.type = "PERCENT";
        ls.attrs.value = String(want.lineSpacing);
      }
    };
    const sw = child(node, "hp:switch");
    if (sw) {
      apply(child(sw, "hp:case"), 0.5);
      apply(child(sw, "hp:default"), 1);
    } else apply(node, 1);
    list.children.push(node);
    list.attrs.itemCnt = String(id + 1);
    this.cat.paraPr.push({ ...want, id });
    this.paraBySig.set(sig, id);
    this.appended.push({ kind: "paraPr", id, sig });
    return id;
  }

  borderFill(spec: BorderFillSpec): number {
    const side = (s: SideSpec | undefined): BorderSide => {
      if (!s || s === "none") return { type: "NONE", width: "0.12 mm", color: "#000000" };
      return { type: s.type ?? "SOLID", width: fmtWidth(s.widthMm ?? 0.12), color: normColor(s.color ?? "#000000") };
    };
    const want: Omit<BorderFillSig, "id"> = {
      left: side(spec.l),
      right: side(spec.r),
      top: side(spec.t),
      bottom: side(spec.b),
      fill: spec.fill ? normColor(spec.fill) : null,
      gradient: spec.gradient ? { colors: spec.gradient.colors.map(normColor), angle: spec.gradient.angle ?? "90" } : null,
    };
    const sig = borderFillSignature(want);
    const hit = this.bfBySig.get(sig);
    if (hit !== undefined) return hit;
    return this.appendBorderFill(want, sig);
  }

  private appendBorderFill(want: Omit<BorderFillSig, "id">, sig: string): number {
    const list = child(refList(this.header), "hh:borderFills");
    if (!list) throw new Error("header: no hh:borderFills");
    const nodes = childrenNamed(list, "hh:borderFill");
    // prototype: a plain solid-grid fill (id with all SOLID 0.12 mm) or the first
    const proto = nodes.find((n) => childrenNamed(n, "hh:leftBorder")[0]?.attrs.type === "SOLID") ?? nodes[0];
    const node = clone(proto);
    const id = nodes.length + 1; // borderFill ids are 1-based in HWPX
    node.attrs.id = String(id);
    const setSide = (name: string, s: BorderSide) => {
      const n = child(node, name);
      if (!n) return;
      n.attrs.type = s.type;
      n.attrs.width = s.width;
      n.attrs.color = s.color;
    };
    setSide("hh:leftBorder", want.left);
    setSide("hh:rightBorder", want.right);
    setSide("hh:topBorder", want.top);
    setSide("hh:bottomBorder", want.bottom);
    node.children = node.children.filter((c) => !(isNode(c) && c.name === "hc:fillBrush"));
    if (want.fill) node.children.push(el("hc:fillBrush", {}, [el("hc:winBrush", { faceColor: want.fill, hatchColor: "#999999", alpha: "0" })]));
    else if (want.gradient)
      node.children.push(
        el("hc:fillBrush", {}, [
          el("hc:gradation", { type: "LINEAR", angle: want.gradient.angle, centerX: "0", centerY: "0", step: "50", stepCenter: "50", alpha: "0" }, want.gradient.colors.map((c) => el("hc:color", { value: c }))),
        ]),
      );
    list.children.push(node);
    list.attrs.itemCnt = String(id);
    this.cat.borderFill.push({ ...want, id });
    this.bfBySig.set(sig, id);
    this.appended.push({ kind: "borderFill", id, sig });
    return id;
  }

  /** Convenience: the standard solid black 0.12 mm grid on all sides (template id 4 in both families). */
  gridBorderFill(): number {
    return this.borderFill({ l: {}, r: {}, t: {}, b: {} });
  }
  noneBorderFill(): number {
    return this.borderFill({ l: "none", r: "none", t: "none", b: "none" });
  }
}
