/**
 * 양식 맞춰 쓰기 엔진 — 원본을 버리지 않고 글자만 바꾼다(lib/template/engine.ts).
 * 2026-11-16 경영목표: 시스템은 원본과 전혀 다른 문서를 냈고, VS 는 서식이 바이트까지 같은 파일을 냈다.
 * 여기서는 그 차이를 만드는 성질 — 목록에 없는 곳은 그대로, 서식 파일은 그대로 — 를 잠근다.
 */
import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { applyEdits, fillEmptyBoxes, listParagraphs, readTemplate } from "@/lib/template/engine";

const HEADER = `<hh:head><hh:charProperties><hh:charPr id="0" height="1500" textColor="#000000"></hh:charPr><hh:charPr id="1" height="1500" textColor="#000000"><hh:bold/></hh:charPr></hh:charProperties></hh:head>`;
const p = (runs: [number, string][], extra = "") =>
  `<hp:p id="0" paraPrIDRef="1">${runs.map(([c, t]) => `<hp:run charPrIDRef="${c}">${t ? `<hp:t>${t}</hp:t>` : "<hp:t/>"}</hp:run>`).join("")}${extra}<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>`;
const cell = (row: number, col: number, inner: string) => `<hp:tc><hp:subList>${inner}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/></hp:tc>`;
const SECTION =
  `<hs:sec>` +
  `<hp:p id="0"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>첫 문단</hp:t></hp:run></hp:p>` + // 0
  p([[0, "□ "], [1, "(전략방향)"], [0, " 경북도와 현장 요구에 부응"]]) + // 1
  p([[0, "   - "], [1, "(지속가능 경영)"], [0, " ESG &amp; 윤리"]]) + // 2
  `<hp:p id="0"><hp:run charPrIDRef="0"><hp:tbl><hp:tr>${cell(0, 0, p([[0, "전략과제"]]))}${cell(0, 1, p([[0, ""]]))}</hp:tr></hp:tbl><hp:t/></hp:run></hp:p>` + // 3(표) 4 5
  p([[0, "경영지원팀 내용"]]) + // 6
  `</hs:sec>`;

function hwpx(): Uint8Array {
  return zipSync({
    mimetype: [strToU8("application/hwp+zip"), { level: 0 }],
    "Contents/header.xml": strToU8(HEADER),
    "Contents/section0.xml": strToU8(SECTION),
  });
}
const sectionOf = (bytes: Uint8Array) => new TextDecoder().decode(unzipSync(bytes)["Contents/section0.xml"]);

describe("readTemplate / listParagraphs", () => {
  it("문단마다 번호를 매기고 표 칸·굵게를 보인다", () => {
    const d = readTemplate(hwpx());
    expect(d.paragraphs.map((x) => x.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(d.paragraphs[4].cell).toEqual({ table: 1, row: 0, col: 0 });
    expect(d.paragraphs[3].tables).toEqual([1]);
    expect(d.paragraphs[2].runs[2].text).toBe(" ESG & 윤리");
    const md = listParagraphs(d);
    expect(md).toContain("1 ⟦0⟧□ ⟦1 굵게⟧(전략방향)⟦2⟧ 경북도와 현장 요구에 부응");
    expect(md).toContain("4 [표1 1행1열] ⟦0⟧전략과제");
    expect(md).toContain("5 [표1 1행2열] ⟦0⟧(빈 칸)");
  });
});

describe("applyEdits", () => {
  it("목록에 없는 문단과 서식 파일은 원본 그대로다", () => {
    const src = hwpx();
    const r = applyEdits(readTemplate(src), { edits: [{ p: 1, runs: { "2": " 신뢰받는 조직문화 <AI>" } }] });
    const out = sectionOf(r.bytes);
    expect(out).toContain("<hp:t> 신뢰받는 조직문화 &lt;AI&gt;</hp:t>");
    // 바꾼 문단 밖(경영지원팀)은 그대로, 머리말·서식도 그대로
    expect(out).toContain("<hp:t>경영지원팀 내용</hp:t>");
    expect(out).toContain('<hp:run charPrIDRef="1"><hp:t>(전략방향)</hp:t>');
    expect(unzipSync(r.bytes)["Contents/header.xml"]).toEqual(unzipSync(src)["Contents/header.xml"]);
    // 바꾼 문단의 줄 나눔 정보만 지워 한글이 다시 나누게 한다 — 다른 문단의 것은 남는다
    expect(out.split("<hp:linesegarray>").length - 1).toBe(4);
    expect(r.changes).toEqual([{ p: 1, kind: "고침", before: "□ (전략방향) 경북도와 현장 요구에 부응", after: "□ (전략방향) 신뢰받는 조직문화 <AI>" }]);
    expect(r.errors).toEqual([]);
  });

  it("빈 표 칸을 채우고, 문단을 지우고, 이웃 문단을 본떠 넣는다", () => {
    const d = readTemplate(hwpx());
    const r = applyEdits(d, {
      edits: [
        { p: 5, runs: { "0": "AI 혁신" } },
        { p: 2, delete: true },
        { insertAfter: 1, like: 1, runs: { "1": "(새 항목)", "2": " 넣은 문단" } },
      ],
    });
    const after = readTemplate(r.bytes);
    const texts = after.paragraphs.map((x) => x.runs.map((t) => t.text).join(""));
    expect(texts).toEqual(["첫 문단", "□ (전략방향) 경북도와 현장 요구에 부응", "□ (새 항목) 넣은 문단", "", "전략과제", "AI 혁신", "경영지원팀 내용"]);
    // 넣은 문단은 본뜬 문단의 글자 모양(굵게 머리말)을 그대로 가진다
    expect(after.paragraphs[2].runs.map((t) => t.charPr)).toEqual(["0", "1", "0"]);
  });

  /** 담당자 2026-11-18: 줄마다 빈 문단으로 띄운 양식에서 넣은 줄은 붙고 지운 줄 자리는 벌어졌다 */
  it("줄 사이 띄움 줄(빈 문단)을 지킨다 — 지운 줄의 띄움 줄은 같이 빼고, 넣은 줄 앞에는 띄움 줄을 둔다", () => {
    const sec =
      `<hs:sec><hp:p id="0"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>제목</hp:t></hp:run></hp:p>` +
      p([[0, " ㅇ (일시) 11. 24.(화)"]]) + p([[0, ""]]) + // 1 2
      p([[0, " ㅇ (장소) 브리핑룸"]]) + p([[0, ""]]) + // 3 4
      p([[0, " ㅇ (내용) 브리핑"]]) + p([[0, ""]]) + // 5 6
      p([[0, "□ 일정"]]) + `</hs:sec>`; // 7
    const bytes = zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }], "Contents/header.xml": strToU8(HEADER), "Contents/section0.xml": strToU8(sec) });
    const d = readTemplate(bytes);
    const r = applyEdits(d, { edits: [{ p: 3, delete: true }, { insertAfter: 5, like: 5, runs: { "0": " ㅇ (비고) 새 줄" } }] });
    expect(r.errors).toEqual([]);
    const texts = readTemplate(r.bytes).paragraphs.map((x) => x.runs.map((t) => t.text).join(""));
    expect(texts).toEqual(["제목", " ㅇ (일시) 11. 24.(화)", "", " ㅇ (내용) 브리핑", "", " ㅇ (비고) 새 줄", "", "□ 일정"]);
  });

  it("무리 끝 줄 뒤에 넣을 때는 다음 □ 앞의 넓은 띄움 줄이 아니라 본뜬 줄 앞의 띄움 줄을 쓴다", () => {
    const sp = (pp: number) => `<hp:p id="0" paraPrIDRef="${pp}"><hp:run charPrIDRef="0"/></hp:p>`;
    const sec =
      `<hs:sec><hp:p id="0"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>제목</hp:t></hp:run></hp:p>` +
      p([[0, " - (대상) 전 부서"]]) + sp(36) + p([[0, " - (자료) 사업별 1장"]]) + sp(39) + p([[0, "□ 일정"]]) + `</hs:sec>`;
    const bytes = zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }], "Contents/header.xml": strToU8(HEADER), "Contents/section0.xml": strToU8(sec) });
    const r = applyEdits(readTemplate(bytes), { edits: [{ insertAfter: 3, like: 3, runs: { "0": " - (기한) 11. 19.(목)" } }] });
    const out = sectionOf(r.bytes);
    const order = [...out.matchAll(/paraPrIDRef="(\d+)"|<hp:t>([^<]*)<\/hp:t>/g)].map((m) => m[1] ?? m[2]).filter((x) => x !== "1");
    expect(order).toEqual(["제목", " - (대상) 전 부서", "36", " - (자료) 사업별 1장", "36", " - (기한) 11. 19.(목)", "39", "□ 일정"]);
  });

  it("없는 번호·지울 수 없는 문단은 적용하지 않고 까닭을 남긴다", () => {
    const d = readTemplate(hwpx());
    const r = applyEdits(d, {
      edits: [
        { p: 99, runs: { "0": "x" } },
        { p: 1, runs: { "7": "x" } },
        { p: 0, delete: true },
        { p: 4, delete: true },
        { insertAfter: 1, like: 3, runs: {} },
      ],
    });
    expect(r.changes).toEqual([]);
    expect(r.errors).toHaveLength(5);
    expect(r.errors.join("\n")).toMatch(/문단 99 이 없습니다[\s\S]*칸 7 이 없습니다[\s\S]*첫 문단[\s\S]*하나뿐인 문단[\s\S]*본뜰 수 없습니다/);
    expect(sectionOf(r.bytes)).toBe(SECTION);
  });

  it("표를 품은 문단을 지우면 표가 통째로 빠진다", () => {
    const r = applyEdits(readTemplate(hwpx()), { edits: [{ p: 3, delete: true }] });
    expect(sectionOf(r.bytes)).not.toContain("<hp:tbl>");
    expect(r.changes[0]).toMatchObject({ p: 3, kind: "지움", before: "[표1]" });
  });

  it("문단이 크게 길어지면 쪽 밀림을 경고한다", () => {
    const r = applyEdits(readTemplate(hwpx()), { edits: [{ p: 1, runs: { "2": " 경북도와 현장 요구에 부응하는 디지털 경영혁신 모델을 추구하고 그 성과를 확산한다" } }] });
    expect(r.warnings[0]).toMatch(/^\[길이\] 문단 1:/);
  });
});

/**
 * 2026-11-27 「중소기업 AX 대전환 지원 계획」(새로 쓰기): 표지 글상자 4개의 하나뿐인 문단을 지워 빈 <hp:subList> 가 남았고,
 * 한글이 파일을 열다 닫혔다. 상자(표 칸·글상자)는 문단이 하나도 없으면 안 된다.
 */
describe("빈 상자 막기", () => {
  const boxSection =
    `<hs:sec>` +
    `<hp:p id="0"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>첫 문단</hp:t></hp:run></hp:p>` + // 0
    `<hp:p id="0"><hp:run charPrIDRef="0"><hp:rect><hp:drawText><hp:subList>${p([[0, "□□"]])}</hp:subList></hp:drawText></hp:rect><hp:t>표지</hp:t></hp:run></hp:p>` + // 1(글상자) 2
    `<hp:p id="0"><hp:run charPrIDRef="0"><hp:tbl><hp:tr>${cell(0, 0, p([[0, "가"]]) + p([[0, "나"]]))}</hp:tr></hp:tbl><hp:t/></hp:run></hp:p>` + // 3(표) 4 5
    `</hs:sec>`;
  const boxHwpx = () => zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }], "Contents/header.xml": strToU8(HEADER), "Contents/section0.xml": strToU8(boxSection) });
  const emptyBoxes = (xml: string) => (xml.match(/<hp:subList\b[^>]*>\s*<\/hp:subList>/g) ?? []).length;

  it("글상자의 하나뿐인 문단을 지우라 해도 글자만 비우고 문단은 남긴다", () => {
    const d = readTemplate(boxHwpx());
    expect(d.paragraphs[2].box).toBeDefined();
    const r = applyEdits(d, { edits: [{ p: 2, delete: true }] });
    const xml = sectionOf(r.bytes);
    expect(emptyBoxes(xml)).toBe(0);
    expect(xml).not.toContain("□□");
    expect(r.warnings.some((w) => w.startsWith("[빈 상자] 문단 2"))).toBe(true);
  });

  it("표 칸의 문단을 모두 지우라 해도 첫 문단은 남긴다", () => {
    const r = applyEdits(readTemplate(boxHwpx()), { edits: [{ p: 4, delete: true }, { p: 5, delete: true }] });
    const xml = sectionOf(r.bytes);
    expect(emptyBoxes(xml)).toBe(0);
    expect(xml).not.toContain("<hp:t>가</hp:t>");
    expect(xml).not.toContain("<hp:t>나</hp:t>");
  });

  it("상자를 품은 문단째 지우면 상자가 통째로 빠진다", () => {
    const r = applyEdits(readTemplate(boxHwpx()), { edits: [{ p: 1, delete: true }, { p: 2, delete: true }] });
    const xml = sectionOf(r.bytes);
    expect(xml).not.toContain("<hp:rect>");
    expect(r.warnings.some((w) => w.startsWith("[빈 상자]"))).toBe(false);
  });

  it("fillEmptyBoxes 는 남은 빈 상자에 빈 문단을 넣는다", () => {
    const broken = zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }], "Contents/section0.xml": strToU8(`<hs:sec><hp:subList id=""></hp:subList><hp:subList/><hp:subList>${p([[0, "x"]])}</hp:subList></hs:sec>`) });
    const r = fillEmptyBoxes(broken);
    expect(r.filled).toBe(2);
    expect(emptyBoxes(sectionOf(r.bytes))).toBe(0);
    expect(sectionOf(r.bytes)).toContain("<hp:t>x</hp:t>");
  });
});
