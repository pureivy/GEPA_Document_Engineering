/**
 * Minimal ordered XML node model used by the HWPX writer.
 * Parsing goes through fast-xml-parser (preserveOrder) and is converted into this
 * model; serialization is our own so that output is deterministic and matches the
 * shape Hancom writes (no pretty-printing, explicit empty elements for <hp:t>).
 */
import { XMLParser } from "fast-xml-parser";

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlChild[];
}
export type XmlChild = XmlNode | string;

export function el(name: string, attrs: Record<string, string | number> = {}, children: XmlChild[] = []): XmlNode {
  const a: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) a[k] = String(v);
  return { name, attrs: a, children };
}

export function isNode(c: XmlChild): c is XmlNode {
  return typeof c !== "string";
}

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;");
}
function decodeNumericEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

/** Elements that must always be written as <x></x> rather than <x/> (Hancom style). */
const NEVER_SELF_CLOSE = new Set(["hp:t", "hp:effects"]);

export function serialize(node: XmlNode): string {
  const parts: string[] = [];
  write(node, parts);
  return parts.join("");
}

function write(node: XmlNode, out: string[]) {
  out.push("<", node.name);
  for (const [k, v] of Object.entries(node.attrs)) out.push(" ", k, '="', escapeAttr(v), '"');
  if (node.children.length === 0 && !NEVER_SELF_CLOSE.has(node.name)) {
    out.push("/>");
    return;
  }
  out.push(">");
  for (const c of node.children) {
    if (typeof c === "string") out.push(escapeText(c));
    else write(c, out);
  }
  out.push("</", node.name, ">");
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  attributesGroupName: false,
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  alwaysCreateTextNode: true,
});

type POItem = Record<string, unknown> & { ":@"?: Record<string, string> };

function fromPreserveOrder(item: POItem): XmlChild {
  const keys = Object.keys(item).filter((k) => k !== ":@");
  const name = keys[0];
  if (name === "#text") return decodeNumericEntities(String(item["#text"] ?? ""));
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(item[":@"] ?? {})) attrs[k] = decodeNumericEntities(String(v));
  const kids = (item[name] as POItem[]) ?? [];
  return { name, attrs, children: kids.map(fromPreserveOrder) };
}

/** Parse an XML document (or fragment with one root) into an XmlNode. */
export function parseXml(xml: string): XmlNode {
  const arr = parser.parse(xml) as POItem[];
  const roots = arr.map(fromPreserveOrder).filter(isNode);
  if (roots.length !== 1) throw new Error(`expected one root element, got ${roots.length}`);
  return roots[0];
}

export function attr(node: XmlNode, name: string): string | undefined {
  return node.attrs[name];
}
export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c): c is XmlNode => isNode(c) && c.name === name);
}
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c): c is XmlNode => isNode(c) && c.name === name);
}
export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (!isNode(c)) continue;
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
export function findFirst(node: XmlNode, name: string): XmlNode | undefined {
  for (const c of node.children) {
    if (!isNode(c)) continue;
    if (c.name === name) return c;
    const r = findFirst(c, name);
    if (r) return r;
  }
  return undefined;
}
/** Concatenated text of all descendant text nodes (hp:t content, with lineBreak → \n). */
export function textOf(node: XmlNode): string {
  let s = "";
  for (const c of node.children) {
    if (typeof c === "string") s += c;
    else if (c.name === "hp:lineBreak") s += "\n";
    else s += textOf(c);
  }
  return s;
}
export function clone<T extends XmlChild>(c: T): T {
  if (typeof c === "string") return c;
  return { name: c.name, attrs: { ...c.attrs }, children: c.children.map(clone) } as T;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
