import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDsl } from "../../lib/docmodel/dsl";
import { toDsl, collapseBoilerplate } from "../../lib/docmodel/serialize/toDsl";
import { NOTICE_참여제한대상 } from "../../lib/docmodel/boilerplate";

describe("toDsl collapses expanded boilerplate back to macros", () => {
  const golden = readFileSync("templates/notice/golden/6-1.dsl.md", "utf8");
  const macroName = (l: string) => /\{\{boilerplate:([^\s}]+)/.exec(l)?.[1];
  const wanted = golden.split("\n").filter((l) => l.startsWith("{{boilerplate:")).map(macroName);

  it("the golden notice keeps every macro through parse → toDsl (unused args such as 지급방법 이메일= are dropped)", () => {
    const { doc } = parseDsl(golden);
    const out = toDsl(doc);
    const got = out.split("\n").filter((l) => l.startsWith("{{boilerplate:")).map(macroName);
    expect(got).toEqual(wanted);
    expect(out).toContain("{{boilerplate:기타유의사항 주관기관=안동시}}");
    // the fixed text itself is no longer spelled out
    expect(out).not.toContain("기업게좌로 직접 송금");
    expect(out).not.toContain(NOTICE_참여제한대상[1]);
    // and the round trip is stable
    const again = toDsl(parseDsl(out).doc);
    expect(again).toBe(out);
  });

  it("keeps the argument of 기타유의사항 and leaves edited passages explicit", () => {
    const src = `---\nfamily: plan\n제목: t\n---\n{{boilerplate:기타유의사항 주관기관=영주시}}\n{{boilerplate:예산상황}}\n`;
    const { doc } = parseDsl(src);
    expect(toDsl(doc)).toContain("{{boilerplate:기타유의사항 주관기관=영주시}}");
    expect(toDsl(doc)).toContain("{{boilerplate:예산상황}}");
    // edit one fixed line → that passage must stay as typed text
    const para = doc.blocks.find((b) => b.k === "para" && JSON.stringify(b).includes("휴업")) ?? doc.blocks.find((b) => b.k === "para");
    const lines = collapseBoilerplate(["※ 예산상황에 따라 선정기업은 변동될 수 있음", "※ 예산상황에 따라 선정기업은 변동될 수 있음(수정)"]);
    expect(lines).toEqual(["{{boilerplate:예산상황}}", "※ 예산상황에 따라 선정기업은 변동될 수 있음(수정)"]);
    expect(para).toBeDefined();
  });
});

describe("institutional macro variants collapse with their 대상=기관 argument", () => {
  it("round-trips the five 기관 macros and keeps 주관기관", () => {
    const src = `---\nfamily: plan\n제목: t\n---\n{{boilerplate:참여제한대상 대상=기관}}\n{{boilerplate:예산상황 대상=기관}}\n{{boilerplate:기업부담금 대상=기관}}\n{{boilerplate:지급방법 대상=기관}}\n{{boilerplate:기타유의사항 대상=기관 주관기관=경상북도}}\n{{boilerplate:참여제한대상}}\n`;
    const out = toDsl(parseDsl(src).doc);
    expect(out).toContain("{{boilerplate:참여제한대상 대상=기관}}");
    expect(out).toContain("{{boilerplate:예산상황 대상=기관}}");
    expect(out).toContain("{{boilerplate:기업부담금 대상=기관}}");
    expect(out).toContain("{{boilerplate:지급방법 대상=기관}}");
    expect(out).toContain("{{boilerplate:기타유의사항 대상=기관 주관기관=경상북도}}");
    expect(out).toContain("\n{{boilerplate:참여제한대상}}\n"); // the 기업 variant next to it is still recognized
    expect(out).not.toContain("지방보조금 관리 조례");
    expect(toDsl(parseDsl(out).doc)).toBe(out);
  });
});
