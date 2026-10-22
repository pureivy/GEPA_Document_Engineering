import { describe, expect, it } from "vitest";
import { parseHwpTasklist } from "@/lib/hwpx/hangul";

// tasklist /V /FO CSV /NH — 창 없는 자동화 한글은 제목이 "N/A"(2026-10-22: 숨은 hwp.exe 12개)
describe("한글 프로세스 목록(parseHwpTasklist)", () => {
  it("pid 와 창 제목을 읽는다 — 창 없는 한글은 N/A", () => {
    const csv = [
      '"Hwp.exe","7996","Console","1","40,112 K","Running","PC-user","0:00:01","N/A"',
      '"Hwp.exe","9676","Console","1","52,004 K","Running","PC-user","0:00:03","결과보고.hwpx - 한글"',
      '"chrome.exe","123","Console","1","1 K","Running","PC-user","0:00:00","N/A"',
      "",
    ].join("\r\n");
    expect(parseHwpTasklist(csv)).toEqual([
      { pid: 7996, title: "N/A" },
      { pid: 9676, title: "결과보고.hwpx - 한글" },
    ]);
  });
  it("한글이 없으면(정보: 실행 중인 작업이 없습니다) 빈 목록", () => {
    expect(parseHwpTasklist("정보: 지정된 조건에 일치하는 작업이 실행되고 있지 않습니다.\r\n")).toEqual([]);
  });
});
