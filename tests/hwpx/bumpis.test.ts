import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";

const dsl = `---
family: plan
제목: 범정부오피스 활용 영상회의 개최 계획
house: bumpis
---
\`\`\`box
학습을 통해 업무효율성 증진
\`\`\`
□ 회의개요
ㅇ **목적:** 추진 현황 공유
* 중앙행정기관 및 지방자치단체
※ 기관별 1명 참석 가능
- 세부내용
## 시간계획
{table role=schedule widths=80,40,270,90}
| 시 간 | | 주요 내용 | 비 고 |
|---|---|---|---|
| 14:00~14:05 | 5′ | 인사 말씀 | 국장 |
`;

describe("범정부오피스(범피스) 프로필", () => {
  const { doc, warnings } = parseDsl(dsl);
  const { bytes, report } = buildHwpx(doc, { now: new Date("2026-09-15T00:00:00Z") });
  const header = new TextDecoder().decode(unzipSync(bytes)["Contents/header.xml"]);
  const section = new TextDecoder().decode(unzipSync(bytes)["Contents/section0.xml"]);

  it("parses and validates", async () => {
    expect(warnings).toEqual([]);
    expect(report.warnings).toEqual([]);
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
  }, 60_000);

  it("uses the 범피스 ladder: □0 ○1 -3, notes 4 under ○, glyph ㅇ→○", async () => {
    const text = await extractText(bytes);
    const lines = text.split("\n");
    const find = (s: string) => lines.find((l) => l.includes(s)) ?? "";
    const lead = (l: string) => l.length - l.trimStart().length;
    expect(lead(find("□ 회의개요"))).toBe(0);
    expect(find("목적:")).toMatch(/^ ○ /);
    expect(lead(find("* 중앙행정기관"))).toBe(4);
    expect(lead(find("※ 기관별"))).toBe(4);
    expect(lead(find("- 세부내용"))).toBe(3);
  });

  it("applies fonts (□ HY헤드라인M 16, ※ 맑은 고딕 12), page margins (bottom 10mm) and 0.5mm table header rules", () => {
    // the □ run must reference a charPr with height 1600 whose hangul font is HY헤드라인M (font id 6 in the plan template? resolve by name)
    const fontIds = [...header.matchAll(/<hh:font id="(\d+)" face="([^"]+)"/g)].map((m) => [Number(m[1]), m[2]] as const);
    // hangul fontface ids come first in header.xml; several ids may carry the same face
    const hangulCount = Number(header.match(/<hh:fontface lang="HANGUL" fontCnt="(\d+)"/)![1]);
    const hangul = fontIds.slice(0, hangulCount);
    const idsOf = (face: string) => hangul.filter(([, f]) => f === face).map(([id]) => id);
    const hyIds = idsOf("HY헤드라인M");
    const malgunIds = idsOf("맑은 고딕");
    const charPr = (id: string) => header.match(new RegExp(`<hh:charPr id="${id}" height="(\\d+)"[^>]*><hh:fontRef hangul="(\\d+)"`));
    const runOf = (text: string) => section.match(new RegExp(`<hp:run charPrIDRef="(\\d+)"><hp:t>[^<]*${text}`))?.[1];
    const sq = charPr(runOf("□ 회의개요")!)!;
    expect(sq[1]).toBe("1600");
    expect(hyIds).toContain(Number(sq[2]));
    const note = charPr(runOf("※ 기관별")!)!;
    expect(note[1]).toBe("1200");
    expect(malgunIds).toContain(Number(note[2]));
    expect(section).toMatch(/<hp:margin header="2835" footer="2835" gutter="0" left="5669" right="5669" top="4252" bottom="2835"\/>/);
    expect(header).toContain('<hh:topBorder type="SOLID" width="0.5 mm" color="#000000"/>');
    expect(header).toContain('<hc:winBrush faceColor="#E6E6F5"');
    expect(header).toContain('<hh:leftBorder type="DOUBLE_SLIM" width="0.5 mm" color="#1F3864"/>');
  });
});
