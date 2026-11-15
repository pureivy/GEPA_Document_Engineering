import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";
import { splitPerson, personName, headerDate, provideDate, dottedPhone, fitTitle } from "../../lib/hwpx/writers/press";
import { WriterContext } from "../../lib/hwpx/writers/context";
import { loadTemplate } from "../../lib/hwpx/template";

const dir = join(process.cwd(), "templates", "press");
const norm = (s: string) => s.replace(/\s+/g, "").trim();

describe("golden: 2026.02.26 보도자료(CES 2026 리뷰 & 인사이트 콘서트) reproduced from DSL", () => {
  const dsl = readFileSync(join(dir, "golden", "2026-02-26.dsl.md"), "utf8");
  const { doc, warnings } = parseDsl(dsl);
  const { bytes, report, headerXml } = buildHwpx(doc, { now: new Date("2026-02-26T00:00:00Z") });

  it("parses and builds without warnings; 머리표·연락처·제목 표 3개 + 로고 그림 1개", () => {
    expect(warnings).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.tables).toBe(3);
    expect(report.pictures).toBe(1);
  });

  it("uses the 2026 faces: 맑은 고딕 본문 · HY헤드라인M 제목 · HY견고딕 연락처 · 휴먼모음T 날짜", () => {
    for (const face of ["맑은 고딕", "HY헤드라인M", "HY견고딕", "휴먼모음T"]) expect(headerXml).toContain(`face="${face}"`);
  });

  it("validates with the reference page count (2~3) and zero content loss", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.contentLoss?.count).toBe(0);
    expect(v.pageCount).toBeGreaterThanOrEqual(2);
    expect(v.pageCount).toBeLessThanOrEqual(3);
  }, 60_000);

  it("contains every reference line in order (머리표 4행 → 연락처 줄 → 제목·부제 → □ 리드 → ■ 소제목 → 인용문)", async () => {
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
  });
});

describe("splitPerson / personName", () => {
  it("splits title-first and name-first forms; a plain name keeps the fallback label", () => {
    expect(splitPerson("실장 남상범", "실장")).toEqual({ label: "실장", name: "남상범" });
    expect(splitPerson("김OO 팀장", "담당")).toEqual({ label: "팀장", name: "김OO" });
    expect(splitPerson("박용식", "담당")).toEqual({ label: "담당", name: "박용식" });
    expect(splitPerson("담당 박용식", "담당")).toEqual({ label: "담당", name: "박용식" });
    expect(splitPerson("남상원", "담당")).toEqual({ label: "담당", name: "남상원" });
  });
  it("머리표는 이름 직위 순서(장은영 팀장)", () => {
    expect(personName("실장 남상범")).toBe("남상범 실장");
    expect(personName("장은영 팀장")).toBe("장은영 팀장");
    expect(personName("박용식")).toBe("박용식");
    expect(personName(undefined)).toBe("");
  });
});

describe("dates and phone", () => {
  it("제공일자 keeps a 4-digit year and drops the weekday; 【】 date is 2-digit", () => {
    expect(provideDate("2027. 3. 15.(월)")).toBe("2027. 3. 15.");
    expect(provideDate("23. 2. 28(화)")).toBe("2023. 2. 28.");
    expect(headerDate("2027. 3. 15.(월)")).toBe("27. 3. 15.");
    expect(headerDate("2026. 7. 1.(수)")).toBe("26. 7. 1.");
    expect(headerDate("2026. 2. 26.")).toBe("26. 2. 26.");
  });
  it("phone numbers use dots", () => {
    expect(dottedPhone("054-470-8527")).toBe("054.470.8527");
  });
  it("fitTitle no longer squeezes — the 2026 layout allows two title lines", () => {
    const ctx = new WriterContext(loadTemplate("press"), "press");
    expect(fitTitle(ctx, "가".repeat(40), 20, 40000)).toEqual({ ratio: 100, spacing: 0 });
  });
});
