import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relatedProjects, words } from "../../lib/report/related";

/** 같은 일의 이전 프로젝트(담당자 2026-11-18) — 계획안에 있는 예산·업체를 업무보고가 못 보던 구멍 */
function project(root: string, id: string, title: string, topic: string, kind = "report", extra: Record<string, string> = {}) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({ id, kind, title, topic, createdAt: "2026-11-09T00:00:00Z" }));
  for (const [rel, body] of Object.entries(extra)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
}

describe("같은 일의 이전 프로젝트", () => {
  it("연도·보고·현황 같은 어디에나 붙는 낱말은 세지 않는다", () => {
    expect([...words("2027년 주요사업 안내책자 제작 현황 보고")]).toEqual(["주요사업", "안내책자", "제작"]);
  });

  it("제목이 겹치는 계획안·공문을 찾고, 읽을 파일을 알려 준다. 흔한 낱말 하나만 겹치면 고르지 않는다", () => {
    const root = mkdtempSync(join(tmpdir(), "gepa-rel-"));
    project(root, "self", "2027년 주요사업 안내책자 제작 현황 보고", "19일까지 팀별로 자료를 취합중인데 향후 계획 보고");
    project(root, "plan", "2027년 주요사업 안내책자 제작", "1. 적요 2. 소요예산: 금19,450,000원", "report", { "report/draft.dsl.md": "x", "reference/.extracted/a.pdf.txt": "y", "report/out.hwpx": "z" });
    project(root, "off", "2027년 주요사업 안내책자 제작 용역 계약서류 제출", "계약서류", "official");
    project(root, "far", "도내 중소기업 및 소상공인 현황", "우리 도 현황");
    project(root, "one", "2026년 주요 업무보고", "주요사업 정리");
    const r = relatedProjects({ id: "self", kind: "report", title: "2027년 주요사업 안내책자 제작 현황 보고", topic: "19일까지 팀별로 자료를 취합중인데" }, root);
    expect(r.map((x) => x.id).sort()).toEqual(["off", "plan"]);
    const plan = r.find((x) => x.id === "plan")!;
    expect(plan.files).toEqual(expect.arrayContaining(["project.json", "report/draft.dsl.md", "reference/.extracted/a.pdf.txt"]));
    expect(plan.files).not.toContain("report/out.hwpx");
  });

  it("제목·지시가 똑같은 사본은 파일이 가장 많은 하나만", () => {
    const root = mkdtempSync(join(tmpdir(), "gepa-rel-"));
    project(root, "a", "2027년 주요사업 안내책자 제작", "책자 제작 계획");
    project(root, "b", "2027년 주요사업 안내책자 제작", "책자 제작 계획", "report", { "report/draft.dsl.md": "x" });
    const r = relatedProjects({ id: "self", kind: "report", title: "2027년 주요사업 안내책자 제작 현황 보고", topic: "" }, root);
    expect(r.map((x) => x.id)).toEqual(["b"]);
  });
});
