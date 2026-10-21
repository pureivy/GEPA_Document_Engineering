import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { parseDsl } from "@/lib/docmodel/dsl";
import { buildHwpx } from "@/lib/hwpx/build";

/** 표 칸 글자의 문단 정렬(header.xml 의 paraPr align) */
function alignOf(bytes: Uint8Array, cellText: string): string | undefined {
  const files = unzipSync(bytes);
  const sec = strFromU8(files["Contents/section0.xml"]);
  const hdr = strFromU8(files["Contents/header.xml"]);
  const align = new Map([...hdr.matchAll(/<hh:paraPr id="(\d+)"[\s\S]*?<hh:align horizontal="(\w+)"/g)].map((m) => [m[1], m[2]]));
  const esc = cellText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<hp:p [^>]*paraPrIDRef="(\\d+)"[^>]*>(?:(?!</hp:p>)[\\s\\S])*?<hp:t>${esc}</hp:t>`).exec(sec);
  return m ? align.get(m[1]) : undefined;
}

describe("표의 연도는 가운데, 금액은 오른쪽", () => {
  it("설립연도 1982 는 가운데, 지원금액 10,000,000 은 오른쪽 (담당자 2026-10-21)", () => {
    const dsl = [
      "---",
      "family: plan",
      "제목: 「2025년 시험 사업」 결과보고",
      "부서: ESG·기업지원팀",
      "---",
      "# 추진결과",
      "{table role=generic}",
      "| 연번 | 기업명 | 설립연도 | 지원금액 |",
      "|---|---|---|---|",
      "| 1 | ㈜영도벨벳 | 1982 | 10,000,000 |",
      "| 2 | ㈜삼진 | 2003 | 5,000,000 |",
      "",
    ].join("\n");
    const { bytes } = buildHwpx(parseDsl(dsl).doc);
    expect(alignOf(bytes, "1982")).toBe("CENTER");
    expect(alignOf(bytes, "2003")).toBe("CENTER");
    expect(alignOf(bytes, "10,000,000")).toBe("RIGHT");
  });
  it("금액 열의 0 표시 `-` 는 숫자처럼 오른쪽, 글자 열의 `-` 는 가운데 (담당자 2026-10-21)", () => {
    const dsl = [
      "---",
      "family: plan",
      "제목: 「2025년 시험 사업」 결과보고",
      "부서: ESG·기업지원팀",
      "---",
      "# 집행현황",
      "{table role=generic}",
      "| 구분 | 집행액 | 잔액 | 비고 |",
      "|---|---|---|---|",
      "| 운영비 | 6,480,000 | - | 변경 |",
      "| 여비 | 702,600 | 12,500 | — |",
      "",
    ].join("\n");
    const { bytes } = buildHwpx(parseDsl(dsl).doc);
    expect(alignOf(bytes, "-")).toBe("RIGHT");
    expect(alignOf(bytes, "12,500")).toBe("RIGHT");
    expect(alignOf(bytes, "—")).toBe("CENTER");
  });
});
