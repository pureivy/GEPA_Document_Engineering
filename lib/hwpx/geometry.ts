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
  // 배치 캐시는 셀 **밖**에서만 버린다 — 셀 안은 셀 기준이라 유효하고, 지우면
  // 조직도가 닻 문단의 내어쓰기(101.8pt)만큼 오른쪽으로 밀린다(stripOuterLinesegs 주석).
  stripOuterLinesegs(n);
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

/**
 * 배치 캐시를 **셀 밖에서만** 지운다.
 *
 * 조각을 옮기면 쪽 안 세로 위치가 달라지므로 최상위 문단의 `hp:linesegarray` 는 버려야 한다
 * (`vertpos` 가 쪽 기준이다). 그런데 **표 셀 안의 `vertpos` 는 셀 기준이라 옮겨도 유효하고**,
 * 오히려 지우면 탈이 난다: 조직도(`t09`)의 닻 문단은 참고본에서 `paraPr 56`(내어쓰기 101.8pt)을
 * 쓰는데, 캐시가 있으면 한글이 그대로 그리고 없으면 그 내어쓰기를 적용해 표를 오른쪽으로
 * 101.8pt 밀어 낸다 — 담당자가 한글에서 "표 정렬이 이상하다"고 찾아낸 것이 이것이다.
 * `t09` 의 lineseg 96개 중 95개가 `vertpos="0"`(셀 기준)이고 쪽 절대 좌표는 하나뿐이다.
 *
 * 글자를 갈아 끼우는 쪽(`setCellText`·`setShapeText`·`setCellParagraphs`)은 저마다 그 문단의
 * 캐시를 지우므로, 바뀐 칸에 낡은 배치가 남는 일은 없다.
 */
export function stripOuterLinesegs(n: XmlNode): void {
  n.children = n.children.filter((c) => typeof c === "string" || c.name !== "hp:linesegarray");
  for (const c of n.children) {
    if (typeof c === "string") continue;
    if (c.name === "hp:subList") continue; // 셀 안 — 캐시를 그대로 둔다
    stripOuterLinesegs(c);
  }
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

/**
 * Replace the text inside a drawing's `hp:drawText` — the shape's own text box.
 *
 * 표 셀(`setCellText`)과 같은 규칙이다: 첫 문단의 paraPr 과 첫 run 의 charPr 을 지키고
 * 나머지 run 과 **`hp:linesegarray` 를 지운다.** 그 배열은 한글이 캐시해 둔 줄 배치라서,
 * 글자를 갈아 끼우고 그대로 두면 새 글이 옛 자리 폭에 맞춰 잘못 놓인다.
 */
export function setShapeText(frag: XmlNode, text: string): boolean {
  const dt = findAll(frag, "hp:drawText")[0];
  if (!dt) return false;
  const sl = child(dt, "hp:subList");
  if (!sl) return false;
  const p0 = childrenNamed(sl, "hp:p")[0];
  if (!p0) return false;
  const charPr = childrenNamed(p0, "hp:run")[0]?.attrs.charPrIDRef ?? "0";
  sl.children = sl.children.filter((c) => !(isNode(c) && c.name === "hp:p"));
  p0.children = p0.children.filter((c) => !(isNode(c) && (c.name === "hp:run" || c.name === "hp:linesegarray")));
  p0.children.unshift(el("hp:run", { charPrIDRef: charPr }, [el("hp:t", {}, text ? [text] : [])]));
  sl.children.push(p0);
  return true;
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
