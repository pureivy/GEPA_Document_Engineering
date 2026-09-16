/** HWPUNIT = 1/7200 inch. 1 pt = 100 HWPUNIT. 1 mm = 283.465 HWPUNIT. */
export const HWPUNIT_PER_PT = 100;
export const HWPUNIT_PER_MM = 7200 / 25.4;
export const ptToHwp = (pt: number) => Math.round(pt * HWPUNIT_PER_PT);
export const mmToHwp = (mm: number) => Math.round(mm * HWPUNIT_PER_MM);
export const hwpToPt = (u: number) => u / HWPUNIT_PER_PT;
export const hwpToMm = (u: number) => u / HWPUNIT_PER_MM;
/** A4 text column used by every GEPA reference (59528 − 2×5669). */
export const TEXT_WIDTH = 48190;
/** Width Hancom writes into lineseg horzsize for body paragraphs. */
export const LINESEG_WIDTH = 48188;
export function normColor(c: string): string {
  const s = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return ("#" + s).toUpperCase();
  return s;
}
