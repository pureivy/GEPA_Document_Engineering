import { readFileSync } from "node:fs";
import { parseXml, childrenNamed, child, findFirst, textOf, isNode } from "../lib/hwpx/xml";
const p = parseXml(readFileSync(process.argv[2], "utf8"));
const tbl = findFirst(p, "hp:tbl")!;
const sz = child(tbl, "hp:sz")!, pos = child(tbl, "hp:pos")!, im = child(tbl, "hp:inMargin")!, om = child(tbl, "hp:outMargin")!;
console.log("p attrs", JSON.stringify(p.attrs), "run charPr", childrenNamed(p, "hp:run")[0]?.attrs.charPrIDRef);
console.log("tbl", JSON.stringify(tbl.attrs));
console.log("sz", JSON.stringify(sz.attrs), "pos", JSON.stringify(pos.attrs));
console.log("inMargin", JSON.stringify(im.attrs), "outMargin", JSON.stringify(om.attrs));
const rows = childrenNamed(tbl, "hp:tr");
rows.forEach((tr, ri) => {
  for (const tc of childrenNamed(tr, "hp:tc")) {
    const addr = child(tc, "hp:cellAddr")!.attrs, span = child(tc, "hp:cellSpan")!.attrs, csz = child(tc, "hp:cellSz")!.attrs, cm = child(tc, "hp:cellMargin")!.attrs;
    const sl = child(tc, "hp:subList")!;
    const ps = childrenNamed(sl, "hp:p").map((pp) => {
      const runs = childrenNamed(pp, "hp:run").map((r) => `c${r.attrs.charPrIDRef}${r.children.some((c) => isNode(c) && c.name === "hp:pic") ? "[PIC]" : ""}:${JSON.stringify(textOf(r)).slice(0, 40)}`);
      return `p${pp.attrs.paraPrIDRef}(${runs.join(" + ")})`;
    });
    console.log(`r${ri}c${addr.colAddr} bf=${tc.attrs.borderFillIDRef} span=${span.colSpan}x${span.rowSpan} sz=${csz.width}x${csz.height} m=${cm.left}/${cm.right}/${cm.top}/${cm.bottom} va=${sl.attrs.vertAlign} :: ${ps.join(" | ")}`);
  }
});
