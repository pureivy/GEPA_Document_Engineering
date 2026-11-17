/**
 * 표 행 넣기·빼기(lib/template/rows.ts) — 월별 현황처럼 사업 수가 바뀌면 표 행 수도 바뀐다(2026-11-17 10월 현황: 표9 한 행 모자람,
 * 표12 열한 행 남음). 위아래로 합친 칸이 걸린 자리는 표가 깨지므로 하지 않는다.
 */
import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { readTemplate } from "@/lib/template/engine";
import { applyRowOps } from "@/lib/template/rows";

const cell = (row: number, col: number, text: string, rowSpan = 1) =>
  `<hp:tc><hp:subList><hp:p id="0"><hp:run charPrIDRef="0">${text ? `<hp:t>${text}</hp:t>` : "<hp:t/>"}</hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p></hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="${rowSpan}"/></hp:tc>`;
const table = (rows: string[]) => `<hp:p id="0"><hp:run charPrIDRef="0"><hp:tbl rowCnt="${rows.length}" colCnt="2">${rows.map((r) => `<hp:tr>${r}</hp:tr>`).join("")}</hp:tbl><hp:t/></hp:run></hp:p>`;
// 표1: 머리 + 사업 3행. 표2: 첫 칸이 아래로 두 행을 덮는다
const T1 = table([cell(0, 0, "사업") + cell(0, 1, "예산"), cell(1, 0, "가") + cell(1, 1, "10"), cell(2, 0, "나") + cell(2, 1, "20"), cell(3, 0, "다") + cell(3, 1, "30")]);
const T2 = table([cell(0, 0, "묶음", 2) + cell(0, 1, "a"), cell(1, 1, "b"), cell(2, 0, "끝") + cell(2, 1, "c")]);
const SECTION = `<hs:sec><hp:p id="0"><hp:run charPrIDRef="0"><hp:secPr/><hp:t>첫</hp:t></hp:run></hp:p>${T1}${T2}</hs:sec>`;
const hwpx = () => zipSync({ mimetype: [strToU8("application/hwp+zip"), { level: 0 }], "Contents/header.xml": strToU8("<hh:head/>"), "Contents/section0.xml": strToU8(SECTION) });
const sec = (b: Uint8Array) => new TextDecoder().decode(unzipSync(b)["Contents/section0.xml"]);
const cellsOf = (b: Uint8Array, table: number) =>
  readTemplate(b)
    .paragraphs.filter((p) => p.cell?.table === table)
    .map((p) => `${p.cell!.row}:${p.runs.map((r) => r.text).join("")}`);

describe("applyRowOps", () => {
  it("행을 본떠 넣고 칸을 채우며, 행 번호·행 수를 다시 매긴다", () => {
    const r = applyRowOps(hwpx(), [{ table: 1, insertRowAfter: 2, cells: ["새", "15"] }]);
    expect(r.errors).toEqual([]);
    expect(cellsOf(r.bytes, 1)).toEqual(["0:사업", "0:예산", "1:가", "1:10", "2:새", "2:15", "3:나", "3:20", "4:다", "4:30"]);
    expect(sec(r.bytes)).toContain('rowCnt="5"');
    expect(readTemplate(r.bytes).tableDims[1]).toEqual({ rows: 5, cols: 2 });
    expect(r.changes).toEqual([{ table: 1, kind: "행 넣음", row: 3, text: "새 | 15" }]);
  });

  it("남는 행을 빼고, 같은 자리에 여러 행을 넣으면 적은 순서대로 들어간다", () => {
    const r = applyRowOps(hwpx(), [
      { table: 1, deleteRow: 4 },
      { table: 1, insertRowAfter: 1, cells: ["첫째", null] },
      { table: 1, insertRowAfter: 1, cells: ["둘째", "2"] },
    ]);
    expect(r.errors).toEqual([]);
    expect(cellsOf(r.bytes, 1)).toEqual(["0:사업", "0:예산", "1:첫째", "1:예산", "2:둘째", "2:2", "3:가", "3:10", "4:나", "4:20"]);
  });

  it("합친 칸이 걸린 자리는 하지 않고 까닭을 남긴다 — 표는 그대로", () => {
    const before = sec(hwpx());
    const r = applyRowOps(hwpx(), [
      { table: 2, insertRowAfter: 1, cells: ["x", "y"] }, // 1·2행 사이를 합친 칸이 가로지른다
      { table: 2, deleteRow: 2 }, // 2행은 합친 칸에 덮여 있다
      { table: 2, insertRowAfter: 3, like: 1, cells: ["x", "y"] }, // 1행은 합친 칸이 있어 본뜰 수 없다
      { table: 9, deleteRow: 1 },
    ]);
    expect(r.changes).toEqual([]);
    expect(r.errors).toHaveLength(4);
    expect(sec(r.bytes)).toBe(before);
  });

  it("합친 칸이 끝난 아래는 넣을 수 있다", () => {
    const r = applyRowOps(hwpx(), [{ table: 2, insertRowAfter: 3, cells: ["새끝", "d"] }]);
    expect(r.errors).toEqual([]);
    expect(cellsOf(r.bytes, 2).slice(-2)).toEqual(["3:새끝", "3:d"]);
  });
});
