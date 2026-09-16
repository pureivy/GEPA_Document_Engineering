import { el, type XmlNode } from "./xml";
import { LINESEG_WIDTH } from "./units";

/**
 * One approximate hp:lineseg per paragraph. Hancom recomputes layout on open; rhwp's own
 * writers emit the same placeholder shape. vertsize = char height (HWPUNIT), spacing =
 * extra leading from the percent line spacing.
 */
export function linesegArray(vertsize: number, lineSpacingPct: number, horzsize = LINESEG_WIDTH): XmlNode {
  const spacing = Math.round((vertsize * Math.max(lineSpacingPct - 100, 0)) / 100);
  return el("hp:linesegarray", {}, [
    el("hp:lineseg", {
      textpos: 0,
      vertpos: 0,
      vertsize,
      textheight: vertsize,
      baseline: Math.round(vertsize * 0.85),
      spacing,
      horzpos: 0,
      horzsize,
      flags: 393216,
    }),
  ]);
}
