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
