/**
 * 새로 쓰기 뒷정리(tidy.ts)와 첨자 칸 옮기기(leftover.ts moveOutOfScript).
 * 2026-11-26 「'모두의 성장' 추진」: 지운 원본 사이 빈 문단 66개·남은 단 나눔·고정된 표 높이로 3쪽 분량이 5쪽에 흩어졌고,
 * 윗첨자 칸에 들어간 본문 글이 아주 작게 찍혔다.
 */
import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { readTemplate } from "@/lib/template/engine";
import { tidyNewWriting } from "@/lib/template/tidy";
import { moveOutOfScript } from "@/lib/template/leftover";

const HEADER = `<hh:head><hh:charProperties><hh:charPr id="0" height="1500" textColor="#000000"></hh:charPr><hh:charPr id="1" height="1500" textColor="#000000"><hh:supscript/></hh:charPr></hh:charProperties></hh:head>`;
const p = (t: string, attrs = "") => `<hp:p id="0" paraPrIDRef="1" pageBreak="0" columnBreak="0"${attrs}><hp:run charPrIDRef="0">${t ? `<hp:t>${t}</hp:t>` : "<hp:t/>"}</hp:run></hp:p>`;
const table = (t: string) =>
  `<hp:p id="0" paraPrIDRef="1" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0"><hp:tbl rowCnt="1" colCnt="1"><hp:sz width="100" height="9000"/><hp:tr><hp:tc><hp:subList>${p(t)}</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSz width="100" height="9000"/></hp:tc></hp:tr></hp:tbl><hp:t/></hp:run></hp:p>`;
const pack = (sec: string, header = HEADER) =>
  zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }], "Contents/header.xml": strToU8(header), "Contents/section0.xml": strToU8(sec) });
const sectionOf = (b: Uint8Array) => new TextDecoder().decode(unzipSync(b)["Contents/section0.xml"]);

describe("tidyNewWriting", () => {
  it("표지 앞 빈 줄은 두고, 표지 뒤 빈 줄을 지워 본문을 새 쪽에서 시작하고, 잇단 빈 문단·끝 빈 문단을 지우고, 쪽 나눔을 푼다", () => {
    const sec =
      `<hs:sec><hp:p id="0" paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:secPr/><hp:t/></hp:run></hp:p>` +
      p("") + p("") + p("") + table("표지 제목") + p("") + p("") +
      p("본문 A") + p("") + p("", ' columnBreak="1"').replace('columnBreak="0" columnBreak="1"', 'columnBreak="1"') + p("") +
      p("본문 B") + table("✔ 상자") + p("") + p("") + `</hs:sec>`;
    const r = tidyNewWriting(pack(sec));
    const out = readTemplate(r.bytes);
    const top = out.paragraphs.filter((x) => x.parent === undefined);
    const kinds = top.map((x) => (x.hasSecPr ? "S" : x.tables.length ? "T" : x.runs.map((u) => u.text).join("") || "_"));
    expect(kinds).toEqual(["S", "_", "_", "_", "T", "본문 A", "_", "본문 B", "T"]);
    const xml = sectionOf(r.bytes);
    expect(xml).not.toContain('columnBreak="1"');
    expect(/pageBreak="1"[^>]*><hp:run charPrIDRef="0"><hp:t>본문 A/.test(xml)).toBe(true);
    // 표지 표 높이는 두고 본문 표만 푼다
    expect(xml.match(/<hp:cellSz[^>]*height="(\d+)"/g)).toEqual(['<hp:cellSz width="100" height="9000"', '<hp:cellSz width="100" height="100"']);
  });
});

describe("moveOutOfScript", () => {
  it("윗첨자 칸에 넣은 긴 글은 앞 보통 칸에 붙이고, 짧은 각주 표시는 둔다", () => {
    const sec = `<hs:sec><hp:p id="0" paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>□ 과제</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>1)</hp:t></hp:run></hp:p></hs:sec>`;
    const d = readTemplate(pack(sec));
    const long = moveOutOfScript(d, { edits: [{ p: 0, runs: { "0": "□ 3대 분야", "1": " 중심 관계부처 합동 과제 마련" } }] });
    expect(long.edits.edits[0]).toEqual({ p: 0, runs: { "0": "□ 3대 분야 중심 관계부처 합동 과제 마련", "1": "" } });
    const short = moveOutOfScript(d, { edits: [{ p: 0, runs: { "1": "2)" } }] });
    expect(short.moved).toEqual([]);
  });

  it("보통 칸이 「※」 글머리뿐이면 그 뒤에 붙인다", () => {
    const sec = `<hs:sec><hp:p id="0" paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>    ※ </hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>옛 각주</hp:t></hp:run></hp:p></hs:sec>`;
    const r = moveOutOfScript(readTemplate(pack(sec)), { edits: [{ p: 0, runs: { "1": "5대 부문: 노동, 산업" } }] });
    expect(r.edits.edits[0]).toEqual({ p: 0, runs: { "0": "    ※ 5대 부문: 노동, 산업", "1": "" } });
  });
});
