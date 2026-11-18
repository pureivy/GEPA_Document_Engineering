import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";

/** 담당자 2026-11-18: 한 장 조이기 — ※ 줄을 윗줄·표에 붙이고(1단계), 머리말 여백 20→15mm(2단계) */
const DSL = `---\nfamily: report\n형태: 간략\n제목: 시험 보고\n부서: 전략기획팀\n---\n## 현황\n● **(가)** 하나\n| 구분 | 값 |\n|---|---|\n| 가 | 1 |\n※ 출처: 시험\n● **(나)** 둘\n`;
const parts = (squeeze: number) => {
  const z = unzipSync(buildHwpx(parseDsl(DSL).doc, { squeeze }).bytes);
  return { sec: strFromU8(z["Contents/section0.xml"]), hdr: strFromU8(z["Contents/header.xml"]) };
};
const gapOf = (hdr: string, id: string, side: "prev" | "next") => {
  const k = hdr.indexOf(`<hh:paraPr id="${id}"`);
  return new RegExp(`<hc:${side} value="([0-9]+)"`).exec(hdr.slice(k))?.[1];
};

describe("한 장 조이기 단계", () => {
  it("0단계는 그대로, 1단계는 ※ 줄 위 간격과 표 아래 간격을 없앤다", () => {
    for (const [lv, want] of [[0, false], [1, true]] as const) {
      const { sec, hdr } = parts(lv);
      const i = sec.indexOf("※ 출처");
      const note = /paraPrIDRef="(\d+)"/.exec(sec.slice(sec.lastIndexOf("<hp:p ", i)))![1];
      const anchors = [...sec.slice(0, sec.lastIndexOf("<hp:tbl ", i)).matchAll(/<hp:p id="\d+" paraPrIDRef="(\d+)"/g)];
      const anchor = anchors[anchors.length - 1][1];
      expect(gapOf(hdr, note, "prev") === "0").toBe(want);
      expect(gapOf(hdr, anchor, "next") === "0").toBe(want);
    }
  });
  it("2단계는 머리말 여백을 15mm로", () => {
    expect(/<hp:margin header="(\d+)"/.exec(parts(1).sec)?.[1]).toBe("5669");
    expect(/<hp:margin header="(\d+)"/.exec(parts(2).sec)?.[1]).toBe("4252");
  });
});
