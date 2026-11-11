import { describe, expect, it } from "vitest";
import { buildHwpx } from "../../lib/hwpx/build";
import { parseDsl } from "../../lib/docmodel/dsl";
import { findAll, parseXml, type XmlNode } from "../../lib/hwpx/xml";

/**
 * 업무보고 표의 (단위) 줄과 수치 칸은 오른쪽 정렬(담당자 2026-11-10).
 * "(단위: 개, %) 이런 표 위에 들어가는 단위는 오른쪽 정렬 … 표 안에 숫자가 있는 경우도 오른쪽 정렬"
 */
const dsl = (형태: string) => `---
family: report
${형태}
제목: 도내 중소기업 현황
부서: 전략기획팀
---
## 현황
● 경북 중소기업 수
(단위: 개, %)
| 구분 | 2022년 | 2023년 | 증가율 |
|---|---|---|---|
| 전국 | 7,713,895 | 8,041,045 | 4.2% |
| 경북 | 401,605 | 412 | 88.0 |
| 비고 | 해당 없음 | - | △1.5%p |
| 증감 | 해당 없음 | 2.7% ↑ | 3 |
`;

function textOf(n: XmlNode): string {
  return findAll(n, "hp:t").map((t) => t.children.filter((c) => typeof c === "string").join("")).join("");
}

function alignOf(header: string, idRef: string): string | undefined {
  const pp = findAll(parseXml(header.replace(/^<\?xml[^>]*\?>/, "")), "hh:paraPr").find((n) => n.attrs.id === idRef);
  return pp ? findAll(pp, "hh:align")[0]?.attrs.horizontal : undefined;
}

for (const 형태 of ["형태: 간략", ""]) {
  describe(`표 수치·단위 오른쪽 정렬 (${형태 || "전체 보고"})`, () => {
    const out = buildHwpx(parseDsl(dsl(형태)).doc, { now: new Date("2026-11-10T00:00:00Z") });
    const root = parseXml(out.sectionXml);
    const header = out.headerXml ?? "";
    const paraWith = (s: string, inCell: boolean) =>
      findAll(root, "hp:p").find((p) => findAll(p, "hp:tbl").length === 0 && textOf(p) === s);

    it("(단위: 개, %) 줄은 오른쪽", () => {
      const p = paraWith("(단위: 개, %)", false);
      expect(p).toBeDefined();
      expect(alignOf(header, String(p!.attrs.paraPrIDRef))).toBe("RIGHT");
    });

    it("수치 칸(큰 수·작은 수·비율·소수·△)은 오른쪽, 글 칸·첫 열·머리행은 가운데", () => {
      const al = (s: string) => alignOf(header, String(paraWith(s, true)!.attrs.paraPrIDRef));
      for (const n of ["7,713,895", "412", "4.2%", "88.0", "△1.5%p", "2.7% ↑"]) expect([n, al(n)]).toEqual([n, "RIGHT"]);
      for (const t of ["전국", "2022년", "해당 없음"]) expect([t, al(t)]).toEqual([t, "CENTER"]);
    });
  });
}

describe("간략 보고 날짜·부서 줄 (본보기: 「2026. 11. 9.(월) 전략기획팀」)", async () => {
  const { briefDate } = await import("../../lib/hwpx/writers/report");
  it("보고일이 비면 만든 날(한국 시각)을 요일과 함께", () => {
    expect(briefDate("", new Date("2026-11-09T16:00:00Z"))).toBe("2026. 11. 10.(화)");
    expect(briefDate("", new Date("2026-11-09T03:00:00Z"))).toBe("2026. 11. 9.(월)");
  });
  it("적힌 날짜는 같은 꼴로, 날짜가 아니면 그대로", () => {
    expect(briefDate("2026-11-09", new Date())).toBe("2026. 11. 9.(월)");
    expect(briefDate("26. 11. 9.", new Date())).toBe("2026. 11. 9.(월)");
    expect(briefDate("2026년 11월 9일", new Date())).toBe("2026. 11. 9.(월)");
    expect(briefDate("11월 중", new Date())).toBe("11월 중");
  });
  it("문서 제목 아래에 날짜 + 부서가 한 줄로 나간다", () => {
    const out = buildHwpx(parseDsl(dsl("형태: 간략")).doc, { now: new Date("2026-11-09T03:00:00Z") });
    expect(out.sectionXml).toContain("2026. 11. 9.(월) 전략기획팀");
  });
});

describe("(단위) 줄 글자 크기 — 표 글자보다 작게", () => {
  for (const 형태 of ["형태: 간략", ""]) {
    it(형태 || "전체 보고", () => {
      const out = buildHwpx(parseDsl(dsl(형태)).doc, { now: new Date("2026-11-10T00:00:00Z") });
      const root = parseXml(out.sectionXml);
      const p = findAll(root, "hp:p").find((n) => findAll(n, "hp:tbl").length === 0 && textOf(n) === "(단위: 개, %)")!;
      const cp = findAll(p, "hp:run")[0].attrs.charPrIDRef;
      const cell = findAll(root, "hp:p").find((n) => findAll(n, "hp:tbl").length === 0 && textOf(n) === "7,713,895")!;
      const cp2 = findAll(cell, "hp:run")[0].attrs.charPrIDRef;
      const h = parseXml((out.headerXml ?? "").replace(/^<\?xml[^>]*\?>/, ""));
      const height = (id: unknown) => Number(findAll(h, "hh:charPr").find((n) => n.attrs.id === id)!.attrs.height);
      expect(height(cp)).toBeLessThan(height(cp2));
      expect(height(cp)).toBeLessThanOrEqual(1000);
    });
  }
});
