import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";

const dir = join(process.cwd(), "templates", "notice");
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[‧]/g, "·").trim();

describe("golden: 6-1 공고문 reproduced from DSL", () => {
  const dsl = readFileSync(join(dir, "golden", "6-1.dsl.md"), "utf8");
  const { doc, warnings } = parseDsl(dsl);
  const { bytes, report } = buildHwpx(doc, { now: new Date("2026-09-15T00:00:00Z") });

  it("parses without warnings and builds without writer warnings", () => {
    expect(warnings).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.tables).toBe(20); // 9 section bars + info box + overview + flow + docs + support + eval + 5 nested 배점표
    expect(report.pictures).toBe(3);
  });

  it("validates with the same page count as the reference (7)", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.contentLoss?.count).toBe(0);
    expect(v.pageCount).toBe(7);
  }, 60_000);

  it("contains the reference text (allowing for the reference's manual line wraps)", async () => {
    const ref = readFileSync(join(dir, "reference.text.txt"), "utf8").split("\n").map(norm).filter(Boolean);
    const gotText = await extractText(bytes);
    const gotJoined = norm(gotText.replace(/\n/g, " "));
    // every reference line of ≥ 12 chars must appear somewhere in the generated text,
    // except the flattened nested score tables (short cells) and the reference's own wrap fragments
    const long = ref.filter((l) => l.length >= 12);
    const missing = long.filter((l) => !gotJoined.includes(l));
    // tolerate the handful of lines the transcription deliberately changed (wrapped fragments)
    expect(missing.length).toBeLessThanOrEqual(12);
    for (const must of ["기업게좌", "www.gepa.kr", "※ 상기 일정은 추진 상황에 따라 변경될 수 있음", "◦ 휴업 중인 기업", "[별첨1]정량평가 기준", "합  계"]) expect(gotText).toContain(must);
  });

  it("keeps literal leading-space ladder like the reference", async () => {
    const text = await extractText(bytes);
    const lines = text.split("\n");
    const find = (s: string) => lines.find((l) => l.includes(s)) ?? "";
    const lead = (l: string) => l.length - l.trimStart().length;
    expect(lead(find("□ (지원대상)"))).toBe(0);
    expect(lead(find("ㅇ 「중소기업기본법」"))).toBe(1);
    expect(lead(find("- 가족친화인증기업"))).toBe(3);
    expect(lead(find("※ 한국표준산업분류"))).toBe(4); // note under a ㅇ item
    expect(lead(find("※ 예산상황에 따라"))).toBe(2); // note under a □ item
    expect(lead(find("◦ 휴업 중인 기업"))).toBe(1);
    expect(lead(find("* 건축물관리대장"))).toBe(1);
  });
});
