/**
 * 새로 쓰기(모양만 빌린 양식)에서 원본 내용이 남으면 잡는다 — 담당자 2026-11-24: 행정안전부 업무보고 양식에 「'모두의 성장' 추진」을
 * 쓰라고 했는데 Ⅱ장만 바뀌고 Ⅰ·Ⅲ·Ⅳ장이 행안부 내용 그대로 나왔고, 결과 보고에는 경고가 없었다.
 */
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { applyEdits, readTemplate } from "@/lib/template/engine";
import { clearStaleRuns, leftoverByChapter, leftoverWarnings } from "@/lib/template/leftover";
import { templateStagePrompt } from "@/lib/agents/prompts/template";
import type { ProjectDTO } from "@/lib/contracts";

const HEADER = `<hh:head><hh:charProperties><hh:charPr id="0" height="1500" textColor="#000000"></hh:charPr></hh:charProperties></hh:head>`;
const p = (t: string) => `<hp:p id="0" paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:t>${t}</hp:t></hp:run></hp:p>`;
const SECTION =
  `<hs:sec>` +
  `<hp:p id="0"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>행정안전부 업무보고</hp:t></hp:run></hp:p>` + // 0
  p("2025. 12. 17.") + // 1
  p("Ⅰ. 일반 현황\t1") + // 2 차례 줄 — 장으로 세지 않는다
  p("Ⅰ. 일반현황") + // 3
  p("❖ 1차관 1본부 7실") + // 4
  p("□ 정원 3,867명") + // 5
  p("□ 예산 72조원") + // 6
  p("Ⅱ. 평가 및 방향") + // 7
  p("□ 헌정질서 회복") + // 8
  p("ㅇ 정부조직 개편") + // 9
  p("ㅇ 국민 임명식") + // 10
  `</hs:sec>`;
const doc = () =>
  readTemplate(zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }], "Contents/header.xml": strToU8(HEADER), "Contents/section0.xml": strToU8(SECTION) }));

describe("leftoverByChapter", () => {
  it("장마다 원본 그대로 남은 문단을 세고, 차례 줄은 장으로 보지 않는다", () => {
    const d = doc();
    const r = applyEdits(d, { edits: [{ p: 0, runs: { "0": "2027년 모두의 성장 추진" } }, { p: 7, runs: { "0": "Ⅱ. 경제 평가" } }, { p: 8, runs: { "0": "□ 강한 성장 흐름" } }, { p: 9, runs: { "0": "ㅇ 3%대 후반 성장" } }, { p: 10, delete: true }] });
    const l = leftoverByChapter(d, r.changes);
    expect(l.chapters.map((c) => [c.title, c.total, c.unchanged])).toEqual([
      ["앞부분", 3, 2],
      ["Ⅰ. 일반현황", 4, 4],
      ["Ⅱ. 평가 및 방향", 4, 0], // 장 제목은 원본 글로 센다(고친 문단도 원본 순서 그대로)
    ]);
    expect(l.staleDates).toEqual([{ p: 1, text: "2025. 12. 17." }]);
    const w = leftoverWarnings(l);
    expect(w.some((x) => x.startsWith("[원본 그대로] Ⅰ. 일반현황") && x.includes("4개 중 4개"))).toBe(true);
    expect(w.some((x) => x.includes("Ⅱ."))).toBe(false);
    expect(w.some((x) => x.startsWith("[원본 날짜] 문단 1"))).toBe(true);
  });

  it("지운 문단은 남은 것으로 세지 않는다", () => {
    const d = doc();
    const r = applyEdits(d, { edits: [3, 4, 5, 6].map((n) => ({ p: n, delete: true as const })) });
    const l = leftoverByChapter(d, r.changes);
    expect(l.chapters.find((c) => c.title.startsWith("Ⅰ"))?.unchanged).toBe(0);
  });
});

describe("clearStaleRuns", () => {
  it("고친 문단·본뜬 문단의 안 적은 칸에 남은 원본 글은 비우고, 글머리 칸은 둔다", () => {
    const HEAD = `<hh:head><hh:charProperties><hh:charPr id="0" height="1500" textColor="#000000"></hh:charPr><hh:charPr id="1" height="1500" textColor="#000000"><hh:bold/></hh:charPr></hh:charProperties></hh:head>`;
    const sec = `<hs:sec><hp:p id="0"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>표지</hp:t></hp:run></hp:p><hp:p id="0"><hp:run charPrIDRef="0"><hp:t>□ </hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>헌법정신 </hp:t></hp:run><hp:run charPrIDRef="0"><hp:t>계승과 K-민주주의 확산</hp:t></hp:run></hp:p></hs:sec>`;
    const d = readTemplate(zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }], "Contents/header.xml": strToU8(HEAD), "Contents/section0.xml": strToU8(sec) }));
    const r = clearStaleRuns(d, { edits: [{ p: 1, runs: { "1": "3대 분야 중심 정책과제 마련" } }, { insertAfter: 1, like: 1, runs: { "2": "새 줄" } }] });
    expect(r.edits.edits[0]).toEqual({ p: 1, runs: { "1": "3대 분야 중심 정책과제 마련", "2": "" } });
    expect(r.edits.edits[1]).toEqual({ insertAfter: 1, like: 1, runs: { "1": "", "2": "새 줄" } });
    expect(r.cleared.map((c) => c.text)).toEqual(["계승과 K-민주주의 확산", "헌법정신"]);
  });
});

describe("templateStagePrompt 양식 쓰임", () => {
  const project = (양식쓰임?: "고쳐 쓰기" | "새로 쓰기") => ({ id: "x", kind: "template", title: "t", topic: "t", region: "", organizer: "", contact: { 부서명: "", 전화: "", 이메일: "", ...(양식쓰임 ? { 양식쓰임 } : {}) }, createdAt: "", updatedAt: "" }) as unknown as ProjectDTO;
  const run = (m?: "고쳐 쓰기" | "새로 쓰기") => templateStagePrompt({ stage: "template", project: project(m), workspaceDir: "W", brief: "", common: "" }).prompt;

  it("없으면 고쳐 쓰기 — 근거 없는 원본 문장은 둔다", () => {
    expect(run()).toContain("근거 없이 원본대로 둔 문장");
    expect(run()).not.toContain("양식은 모양만 빌린다");
  });

  it("새로 쓰기는 원본 내용을 남기지 않고 구성·분량을 자료에 맞춘다", () => {
    const t = run("새로 쓰기");
    expect(t).toContain("양식은 모양만 빌린다");
    expect(t).toContain("하나도 남기지 않는다");
    expect(t).toContain("원본 쪽수에 맞추지 않는다");
    expect(t).not.toContain("그대로 두되, 마지막 답변에 \"근거 없이 원본대로 둔 문장\"");
  });
});
