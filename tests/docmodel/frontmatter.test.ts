import { describe, expect, it } from "vitest";
import { parseFrontMatter, splitFrontMatter, validateFrontMatter, fallbackMeta } from "../../lib/docmodel/dsl/frontmatter";
import { DocModelSchema, NoticeMetaSchema, PlanMetaSchema, PressMetaSchema } from "../../lib/docmodel/schema";
import { parseDsl } from "../../lib/docmodel/dsl";
import { fixture } from "./helpers";

describe("splitFrontMatter", () => {
  it("splits --- fences and reports body start line", () => {
    const r = splitFrontMatter("---\nfamily: plan\n제목: x\n---\n# 장\n본문\n");
    expect(r.fmText).toBe("family: plan\n제목: x");
    expect(r.fmStartLine).toBe(2);
    expect(r.body).toBe("# 장\n본문\n");
    expect(r.bodyStartLine).toBe(5);
  });
  it("tolerates BOM, CRLF and leading blank lines", () => {
    const r = splitFrontMatter("﻿\r\n---\r\nfamily: press\r\n---\r\nbody\r\n");
    expect(r.fmText).toBe("family: press");
    expect(r.body).toBe("body\n");
  });
  it("returns the whole text as body when there is no front-matter", () => {
    const r = splitFrontMatter("□ 본문만\n");
    expect(r.fmText).toBeNull();
    expect(r.body).toBe("□ 본문만\n");
  });
});

describe("validateFrontMatter", () => {
  it("validates the notice example with NoticeMetaSchema and coerces numbers to strings", () => {
    const r = parseFrontMatter(fixture("notice"));
    expect(r.errors).toEqual([]);
    expect(r.family).toBe("notice");
    const meta = NoticeMetaSchema.parse(r.meta);
    expect(meta.공고번호).toBe("2026070000");
    expect(meta.모집대상).toBe("참여기업");
    expect(meta.기관장).toBe("(재)경상북도경제진흥원장");
    expect(meta.로고).toBe(true);
    expect(meta.접수.선정결과통보).toBe("기업별 개별통보(필요시 접수 홈페이지 공고)");
    expect(meta.모집개요).toHaveLength(11);
    expect(meta.모집개요[8]).toBe("spacer");
    expect(meta.모집개요[5]).toEqual({ 라벨: "대상자별지원금액", 값: "기업별 최대 3백만원(공급가액의 80% 이내)", 불릿: false });
    expect(meta.절차도[1]).toEqual({ 단계: "신청·접수", 일정: "’26. 07. 01. ~ 07. 15." });
  });
  it("validates the plan and press examples", () => {
    const p = parseFrontMatter(fixture("plan"));
    expect(p.errors).toEqual([]);
    const pm = PlanMetaSchema.parse(p.meta);
    expect(pm.연도).toBe("2026");
    expect(pm.numbering).toBe("roman");
    expect(pm.lineSpacing).toBe(160);
    expect(pm.요약?.추진일정).toContain("→");

    const s = parseFrontMatter(fixture("press"));
    expect(s.errors).toEqual([]);
    const sm = PressMetaSchema.parse(s.meta);
    expect(sm.배포일).toBe("2026. 7. 1.(수)");
    expect(sm.붙임).toEqual(["사업 공고문 1부"]);
    expect(sm.사진).toBe(false);
  });
  it("reports a missing family", () => {
    const r = validateFrontMatter("제목: x");
    expect(r.family).toBeUndefined();
    expect(r.errors[0].message).toContain("family");
  });
  it("reports schema violations with the line of the offending key", () => {
    const r = validateFrontMatter("family: notice\n공고번호: 1\n사업명: x\n주관기관: y\n지역: z\n공고연월: 2026. 7.\n접수:\n  이메일: a@b.c\n모집개요: []\n절차도: []", 2);
    expect(r.meta).toBeUndefined();
    expect(r.errors.some((e) => e.path?.startsWith("접수"))).toBe(true);
    expect(r.errors.find((e) => e.path?.startsWith("접수"))?.line).toBe(8);
  });
  it("warns about unknown keys (the unquoted-comma trap)", () => {
    const r = validateFrontMatter("family: press\n배포일: x\n담당부서: x\n담당자: x\n연락처: x\n제목: t\n색상: 파랑\n붙임: [a]");
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.path)).toContain("색상");
    const n = validateFrontMatter("family: notice\n공고번호: 1\n사업명: x\n주관기관: y\n지역: z\n공고연월: 2026. 7.\n접수: { 이메일: a, 우편주소: b, 부서명: c, 전화: d }\n모집개요:\n  - { 라벨: 사업내용, 값: 수출용 홍보물 제작, 제품생산 지원 }\n절차도: []");
    expect(n.warnings.some((w) => w.message.includes("따옴표"))).toBe(true);
  });
  it("reports YAML syntax errors instead of throwing", () => {
    const r = validateFrontMatter("family: plan\n제목: [unclosed");
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].message).toContain("YAML");
  });
  it("fallbackMeta always satisfies the schema", () => {
    for (const family of ["notice", "plan", "press"] as const) {
      const meta = fallbackMeta(family, { 제목: "hello", 사업명: "biz" });
      expect(DocModelSchema.safeParse({ version: 1, family, meta, blocks: [] }).success).toBe(true);
    }
  });
});

describe("parseDsl with broken front-matter", () => {
  it("still returns a schema-valid DocModel and an error-severity warning", () => {
    const { doc, warnings } = parseDsl("---\nfamily: notice\n사업명: x\n---\n# 사업목적\n□ 내용\n");
    expect(DocModelSchema.safeParse(doc).success).toBe(true);
    expect(warnings.some((w) => w.severity === "error")).toBe(true);
    expect(doc.family).toBe("notice");
    expect(doc.blocks.some((b) => b.k === "sectionBar" && b.title === "사업목적")).toBe(true);
  });
  it("assumes plan when the front-matter is missing", () => {
    const { doc, warnings } = parseDsl("□ 본문\n");
    expect(doc.family).toBe("plan");
    expect(warnings[0].severity).toBe("error");
    expect(doc.blocks.filter((b) => b.k === "para").length).toBe(1);
  });
});
