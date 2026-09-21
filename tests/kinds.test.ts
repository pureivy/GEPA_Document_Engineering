import { describe, expect, it } from "vitest";
import { KIND_STAGES, isProjectKind, stagesOf, type ProjectKind } from "../lib/kinds";
import { serializeProject } from "../lib/db/serialize";
import type { ProjectRow } from "../lib/db/schema";
import { STAGE_FAMILY, isDocStage } from "../lib/contracts";

describe("stagesOf", () => {
  it("program 은 기존 4단계", () => {
    expect(stagesOf("program")).toEqual(["research", "plan", "notice", "press"]);
  });
  it("official 은 단일 단계", () => {
    expect(stagesOf("official")).toEqual(["official"]);
  });
  it("모든 kind 의 모든 단계는 알려진 단계다", () => {
    for (const kind of Object.keys(KIND_STAGES) as ProjectKind[]) {
      for (const s of stagesOf(kind)) expect(typeof s).toBe("string");
    }
  });
  it("official 단계는 문서 단계다 — 스트리밍·저장·내보내기가 켜져야 한다", () => {
    expect(STAGE_FAMILY.official).toBe("official");
    expect(isDocStage("official")).toBe(true);
  });
});

describe("isProjectKind — 생성 요청과 DB 행의 kind 를 거르는 유일한 관문", () => {
  it("알려진 종류만 통과시킨다", () => {
    expect(isProjectKind("program")).toBe(true);
    expect(isProjectKind("official")).toBe(true);
    for (const v of ["report", "", "PROGRAM", null, undefined, 1, {}]) expect(isProjectKind(v)).toBe(false);
  });
});

describe("serializeProject 의 kind", () => {
  const row = (kind: string): ProjectRow => ({
    id: "p1",
    kind,
    title: "t",
    topic: "t",
    region: "",
    organizer: "",
    contact: "{}",
    referenceName: null,
    referenceChanges: null,
    createdAt: "",
    updatedAt: "",
  });
  it("저장된 종류를 그대로 내려준다", () => {
    expect(serializeProject(row("official")).kind).toBe("official");
  });
  it("모르는 값은 사업으로 떨어뜨린다 — 단계 목록이 비면 화면이 빈다", () => {
    expect(serializeProject(row("report")).kind).toBe("program");
    expect(serializeProject(row("")).kind).toBe("program");
  });
});
