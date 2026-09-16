import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";
import { splitPerson, headerDate, fitTitle, titleWidth } from "../../lib/hwpx/writers/press";
import { WriterContext } from "../../lib/hwpx/writers/context";
import { loadTemplate } from "../../lib/hwpx/template";

const dir = join(process.cwd(), "templates", "press");
// the reference writes the date with full-width spaces (hp:fwSpace, dropped by extractText) → compare without spaces
const norm = (s: string) => s.replace(/\s+/g, "").trim();

describe("golden: 2023.02.17 보도자료 reproduced from DSL", () => {
  const dsl = readFileSync(join(dir, "golden", "2023-02-17.dsl.md"), "utf8");
  const { doc, warnings } = parseDsl(dsl);
  const { bytes, report, headerXml } = buildHwpx(doc, { now: new Date("2026-09-16T00:00:00Z") });

  it("parses and builds without warnings; 3 tables + 2 pictures like the reference", () => {
    expect(warnings).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.tables).toBe(3);
    expect(report.pictures).toBe(2);
  });

  it("reuses the reference styles: no borderFill appended; only the fitted title charPr may be new", () => {
    expect(report.appendedStyles.filter((a) => a.kind === "charPr").length).toBeLessThanOrEqual(2);
    expect(report.appendedStyles.filter((a) => a.kind === "borderFill")).toEqual([]);
    expect(report.appendedStyles.filter((a) => a.kind === "paraPr")).toEqual([]);
    expect(headerXml).toContain('face="함초롬바탕"');
  });

  it("validates with the reference page count (2) and zero content loss", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.contentLoss?.count).toBe(0);
    expect(v.pageCount).toBe(2);
  }, 60_000);

  it("contains every reference line in order (e-mail moves beside the 담당 name; date year is 2-digit)", async () => {
    const ref = readFileSync(join(dir, "reference.text.txt"), "utf8").split("\n").map(norm).filter(Boolean);
    const got = norm((await extractText(bytes)).replace(/\n/g, " "));
    let cursor = 0;
    const missing: string[] = [];
    for (const line of ref) {
      const idx = got.indexOf(line, cursor);
      if (idx < 0) missing.push(line);
      else cursor = idx + line.length;
    }
    expect(missing).toEqual([]);
    expect(got).toContain("박용식(pys8072@gepa.kr)");
  });
});

describe("fitTitle", () => {
  const ctx = new WriterContext(loadTemplate("press"), "press");
  const width = 47909 - 282;
  it("keeps 100 % / 0 % when the title fits", () => {
    expect(fitTitle(ctx, "경북경제진흥원, 참여기업 모집", 18, width)).toEqual({ ratio: 100, spacing: 0 });
  });
  it("tightens 자간 first, then 장평, within 90 % / −20 %", () => {
    const f = fitTitle(ctx, "경북도, 실리콘밸리 유망 벤처기업 ‘베어로보틱스’와 비즈니스 미팅 열어", 18, width);
    expect(f.ratio).toBeGreaterThanOrEqual(90);
    expect(f.spacing).toBeGreaterThanOrEqual(-20);
    expect(f.ratio < 100 || f.spacing < 0).toBe(true);
    expect(titleWidth(ctx, "경북도, 실리콘밸리 유망 벤처기업 ‘베어로보틱스’와 비즈니스 미팅 열어", 18, f.ratio, f.spacing)).toBeLessThanOrEqual(width);
  });
  it("falls back to the defaults when even the limits cannot fit one line", () => {
    expect(fitTitle(ctx, "가".repeat(40), 18, width)).toEqual({ ratio: 100, spacing: 0 });
  });
});

describe("headerDate", () => {
  it("2-digit year, no period before the weekday", () => {
    expect(headerDate("2027. 3. 15.(월)")).toBe("27. 3. 15(월)");
    expect(headerDate("2026. 7. 1.(수)")).toBe("26. 7. 1(수)");
    expect(headerDate("23. 2. 28(화)")).toBe("23. 2. 28(화)");
    expect(headerDate("2027년 3월 15일(월)")).toBe("27. 3월 15일(월)");
  });
});

describe("splitPerson", () => {
  it("label first / label last / no label", () => {
    expect(splitPerson("실장 남상범", "실장")).toEqual({ label: "실장", name: "남상범" });
    expect(splitPerson("김OO 팀장", "담당")).toEqual({ label: "팀장", name: "김OO" });
    expect(splitPerson("담당 박용식", "담당")).toEqual({ label: "담당", name: "박용식" });
    expect(splitPerson("박용식", "담당")).toEqual({ label: "담당", name: "박용식" });
    expect(splitPerson("홍길동 주무관", "담당")).toEqual({ label: "주무관", name: "홍길동" });
    expect(splitPerson("김지원 팀장", "담당")).toEqual({ label: "팀장", name: "김지원" });
    expect(splitPerson("팀장 박정원", "담당")).toEqual({ label: "팀장", name: "박정원" });
  });
});
