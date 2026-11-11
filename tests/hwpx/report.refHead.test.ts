import { describe, expect, it } from "vitest";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";
import { parseDsl } from "../../lib/docmodel/dsl";
import { toDsl } from "../../lib/docmodel/serialize/toDsl";
import { DocModelSchema, type Block, type DocModel } from "../../lib/docmodel/schema";
import { findAll, parseXml } from "../../lib/hwpx/xml";

/**
 * 업무보고 뒷장 「참고 N | 제목」 (2026-11-10).
 *
 * 한 장 보고서 본문에 다 못 담는 기준표(예: 중소기업기본법 시행령 별표 1 업종별 매출액 기준)를 뒷장으로
 * 뺀다. 본보기는 행감 예상질의답변(경영기획실 취합본)의 「☞ 참고 1」 → 새 쪽 「참고 1 | 제목」.
 */
const DSL = `---
family: report
형태: 간략
제목: 도내 중소기업 및 소상공인 현황
부서: 전략기획팀
---
## 중소기업의 정의
● **(중소기업)** 업종별 매출액 기준·자산총액·독립성 요건을 모두 갖춘 기업 ☞ 참고 1
- 3년 평균매출액등이 업종별 기준(400억~1,800억원) 이하
<참고 1 주된 업종별 중소기업 규모 기준>
## 평균매출액등 기준
| 규모 기준 | 해당 업종 |
|---|---|
| 1,800억원 이하 | 1차 금속, 전기장비 |
| 400억원 이하 | 숙박 및 음식점업 |
※ 출처: 「중소기업기본법 시행령」 [별표 1]
<참고 2: 시도별 현황>
● 경북 소상공인 401,605개
`;

const tables = (bs: Block[]) => bs.filter((b): b is Extract<Block, { k: "table" }> => b.k === "table");

describe("`<참고 N 제목>` 문법", () => {
  const { doc, warnings } = parseDsl(DSL);
  const refs = tables(doc.blocks).filter((t) => t.role === "refHead");

  it("경고 없이 refHead 표(1행 2칸)가 된다", () => {
    expect(warnings.filter((w) => w.severity === "error")).toEqual([]);
    expect(DocModelSchema.safeParse(doc).success).toBe(true);
    expect(refs.map((r) => r.rows[0].cells.map((c) => c.inlines.map((i) => ("text" in i ? i.text : "")).join("")))).toEqual([
      ["참고 1", "주된 업종별 중소기업 규모 기준"],
      ["참고 2", "시도별 현황"],
    ]);
  });

  it("DSL 로 되돌려도 같은 줄이다(왕복)", () => {
    const back = toDsl(doc as DocModel);
    expect(back).toContain("<참고 1 주된 업종별 중소기업 규모 기준>");
    expect(back).toContain("<참고 2 시도별 현황>");
    expect(tables(parseDsl(back).doc.blocks).filter((t) => t.role === "refHead")).toHaveLength(2);
  });

  it("다른 family 에서는 경고하고 건너뛴다", () => {
    const { doc: d, warnings: w } = parseDsl("---\nfamily: official\n제목: x\n---\n<참고 1 x>\n");
    expect(tables(d.blocks)).toHaveLength(0);
    expect(w.some((x) => x.message.includes("주요업무보고(report) 전용"))).toBe(true);
  });
});

describe("참고 띠 — 한글 파일", () => {
  const { doc } = parseDsl(DSL);
  const out = buildHwpx(doc, { now: new Date("2026-11-10T00:00:00Z") });

  it("유효한 hwpx 이고 글이 다 들어간다", async () => {
    const v = await validateHwpx(out.bytes);
    expect(v.errors ?? []).toEqual([]);
    const text = await extractText(out.bytes);
    expect(text).toContain("참고 1");
    expect(text).toContain("주된 업종별 중소기업 규모 기준");
    expect(text).toContain("숙박 및 음식점업");
  });

  it("참고 띠마다 새 쪽에서 열리고, 번호 칸은 남색 바탕이다", () => {
    const root = parseXml(out.sectionXml);
    const paras = findAll(root, "hp:p").filter((p) => findAll(p, "hp:t").some((t) => t.children.some((c) => typeof c === "string" && /^참고 \d$/.test(c))));
    // 띠의 바깥 문단(표를 담은 문단)이 쪽 나눔을 가진다
    const outer = findAll(root, "hp:p").filter((p) => p.attrs.pageBreak === "1" && findAll(p, "hp:tbl").length === 1 && findAll(p, "hp:t").some((t) => t.children.some((c) => typeof c === "string" && /^참고 \d$/.test(c))));
    expect(paras.length).toBeGreaterThanOrEqual(2);
    expect(outer).toHaveLength(2);
    expect(out.headerXml ?? "").toMatch(/1F3864/i);
  });
});

describe("목차 있는 업무보고 — 참고 아래 소제목은 본문 번호를 잇지 않는다", () => {
  const full = DSL.replace("형태: 간략\n", "").replace("## 중소기업의 정의", "# 사업 개요\n## 중소기업의 정의");
  const out = buildHwpx(parseDsl(full).doc, { now: new Date("2026-11-10T00:00:00Z") });
  it("「참고 1」 아래 ## 는 □ 소제목 줄로 나간다", async () => {
    const text = await extractText(out.bytes);
    expect(text).toContain("□ 평균매출액등 기준");
  });
});
