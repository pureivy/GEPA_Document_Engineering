/** Reference table fragments (templates/<family>/geometry/tNN.xml) cloned with fresh ids. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseXml, findAll, findFirst, childrenNamed, child, clone, el, isNode, type XmlNode } from "./xml";
import type { IdGen } from "./ids";

const cache = new Map<string, XmlNode>();

export function loadGeometry(dir: string, name: string): XmlNode | undefined {
  const p = join(dir, "geometry", `${name}.xml`);
  if (!existsSync(p)) return undefined;
  const key = p;
  let n = cache.get(key);
  if (!n) {
    n = parseXml(readFileSync(p, "utf8"));
    cache.set(key, n);
  }
  return n;
}

/** Deep clone a reference paragraph (with its table/pictures) and renumber all ids. */
export function cloneFragment(ref: XmlNode, ids: IdGen): XmlNode {
  const n = clone(ref);
  for (const p of [n, ...findAll(n, "hp:p")]) p.attrs.id = String(ids.nextParaId());
  for (const t of findAll(n, "hp:tbl")) {
    t.attrs.id = String(ids.nextShapeId());
    t.attrs.zOrder = String(ids.nextZOrder());
  }
  for (const pic of findAll(n, "hp:pic")) {
    pic.attrs.id = String(ids.nextShapeId());
    pic.attrs.instid = String(ids.nextShapeId());
    pic.attrs.zOrder = String(ids.nextZOrder());
    pic.children = pic.children.filter((c) => typeof c === "string" || c.name !== "hp:shapeComment");
  }
  for (const f of findAll(n, "hp:fieldBegin")) f.attrs.id = String(ids.nextShapeId());
  // drop layout caches so the reader re-flows
  stripLinesegs(n);
  // section-scoped controls must appear exactly once per section (build.ts inserts the
  // template's own secPr run). A fragment taken from the reference's first paragraph would
  // otherwise duplicate them — rhwp tolerates that, Hancom refuses to open the file.
  stripSectionControls(n);
  return n;
}

/** Controls that belong to the section (first paragraph) and must not be cloned with a fragment. */
const SECTION_CTRLS = new Set(["hp:colPr", "hp:pageNum", "hp:pageHiding", "hp:header", "hp:footer", "hp:footNote", "hp:endNote", "hp:newNum", "hp:pageNumCtrl"]);

export function stripSectionControls(n: XmlNode): void {
  for (const p of [n, ...findAll(n, "hp:p")]) {
    for (const run of childrenNamed(p, "hp:run")) {
      run.children = run.children.filter((c) => {
        if (!isNode(c)) return true;
        if (c.name === "hp:secPr") return false;
        if (c.name === "hp:ctrl") {
          const kids = c.children.filter(isNode);
          if (kids.length > 0 && kids.every((k) => SECTION_CTRLS.has(k.name))) return false;
        }
        return true;
      });
    }
    // a run left without any content (text, table, picture, control) is dropped unless it is the only run
    const runs = childrenNamed(p, "hp:run");
    if (runs.length > 1) p.children = p.children.filter((c) => !(isNode(c) && c.name === "hp:run" && c.children.filter(isNode).length === 0));
  }
}

export function stripLinesegs(n: XmlNode): void {
  n.children = n.children.filter((c) => typeof c === "string" || c.name !== "hp:linesegarray");
  for (const c of n.children) if (typeof c !== "string") stripLinesegs(c);
}

/** Find the cell at (row, col) by hp:cellAddr in the first table of a fragment. */
export function cellAt(frag: XmlNode, row: number, col: number): XmlNode | undefined {
  const tbl = findFirst(frag, "hp:tbl");
  if (!tbl) return undefined;
  for (const tr of childrenNamed(tbl, "hp:tr"))
    for (const tc of childrenNamed(tr, "hp:tc")) {
      const a = child(tc, "hp:cellAddr");
      if (a && Number(a.attrs.rowAddr) === row && Number(a.attrs.colAddr) === col) return tc;
    }
  return undefined;
}

/** Replace the text of a cell: keeps the first paragraph's paraPr and first run's charPr. */
export function setCellText(frag: XmlNode, row: number, col: number, text: string): boolean {
  const tc = cellAt(frag, row, col);
  if (!tc) return false;
  const sl = child(tc, "hp:subList");
  if (!sl) return false;
  const paras = childrenNamed(sl, "hp:p");
  const p0 = paras[0];
  if (!p0) return false;
  const run0 = childrenNamed(p0, "hp:run")[0];
  const charPr = run0?.attrs.charPrIDRef ?? "0";
  // keep only the first paragraph, replace its runs with one text run
  sl.children = sl.children.filter((c) => !(isNode(c) && c.name === "hp:p"));
  p0.children = p0.children.filter((c) => !(isNode(c) && (c.name === "hp:run" || c.name === "hp:linesegarray")));
  p0.children.unshift(el("hp:run", { charPrIDRef: charPr }, [el("hp:t", {}, text ? [text] : [])]));
  sl.children.push(p0);
  return true;
}
