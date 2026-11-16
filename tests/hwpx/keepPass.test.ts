import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";
import { applyKeepWithNext, buildLaidOut, hangulParaPages } from "../../lib/hwpx/keepPass";
import { parseXml, childrenNamed } from "../../lib/hwpx/xml";
import { asLaidOutByHangul, rhwp } from "../../lib/hwpx/validate";
import { WriterContext } from "../../lib/hwpx/writers/context";
import { loadTemplate } from "../../lib/hwpx/template";

async function pageOfPara(bytes: Uint8Array, marker: string, sectionXml: string, hangulLike = false): Promise<number> {
  // 최상위 문단 순번 → rhwp 배치 쪽
  const body = sectionXml.slice(sectionXml.indexOf("<hs:sec"));
  let depth = 0, idx = -1, found = -1;
  for (const m of body.matchAll(/<(\/?)hp:p[ >]|<hp:t>([^<]*)/g)) {
    if (m[2] !== undefined) { if (found < 0 && m[2].includes(marker)) found = idx; continue; }
    if (m[1]) depth--; else { if (depth === 0) idx++; depth++; }
  }
  const mod = await rhwp();
  // hangulLike: keepPass 가 판정하는 배치(한글이 저장한 줄 배치를 따름) — 한글은 다음 문단과 함께를 지킨다
  const doc = new mod.HwpDocument(hangulLike ? asLaidOutByHangul(bytes) : bytes) as unknown as { getCursorRect(s: number, p: number, o: number): string };
  return JSON.parse(doc.getCursorRect(0, found, 0)).pageIndex;
}


/** 마지막 표의 첫 행·끝 행이 놓인 쪽 — 한글 배치(asLaidOutByHangul)에서 칸 커서 위치로 잰다 */
async function tableRowPages(bytes: Uint8Array, sectionXml: string): Promise<[number, number]> {
  const body = sectionXml.slice(sectionXml.indexOf("<hs:sec"));
  let depth = 0, idx = -1, tablePara = -1;
  for (const m of body.matchAll(/<(\/?)hp:p[ >]|<hp:tbl[ >]/g)) {
    if (m[0].startsWith("<hp:tbl")) { if (depth === 1) tablePara = idx; continue; }
    if (m[1]) depth--; else { if (depth === 0) idx++; depth++; }
  }
  const mod = await rhwp();
  const doc = new mod.HwpDocument(asLaidOutByHangul(bytes)) as unknown as {
    getTableDimensions(s: number, p: number, c: number): string;
    getCursorRectInCell(s: number, p: number, c: number, cell: number, cp: number, off: number): string;
  };
  for (let ctrl = 0; ctrl < 4; ctrl++) {
    try {
      const dim = JSON.parse(doc.getTableDimensions(0, tablePara, ctrl)) as { colCount: number; cellCount: number };
      const page = (cell: number) => JSON.parse(doc.getCursorRectInCell(0, tablePara, ctrl, cell, 0, 0)).pageIndex as number;
      return [page(dim.colCount), page(dim.cellCount - 1)];
    } catch {
      /* 다음 컨트롤 */
    }
  }
  throw new Error("표를 찾지 못했다");
}

describe("keepWithNext 보정", () => {
  it("쪽 끝에 홀로 남은 □ 제목을 뒤따르는 표와 같은 쪽으로 넘긴다", async () => {
    let s = `---\nfamily: plan\n제목: 실험\nnumbering: roman\n---\n# 개요\n`;
    for (let i = 0; i < 24; i++) s += `ㅇ 채움 문장 ${i} 입니다 채움 문장 입니다\n`;
    s += `□ 표제목\n| 가 | 나 |\n|---|---|\n| 표첫칸 | 둘 |\n| 셋 | 넷 |\n`;
    const built = buildHwpx(parseDsl(s).doc);
    const before = [await pageOfPara(built.bytes, "표제목", built.sectionXml), await pageOfPara(built.bytes, "표첫칸", built.sectionXml)];
    expect(before[0]).toBeLessThan(before[1]); // rhwp 는 keepWithNext 를 지키지 않는다
    const kept = await applyKeepWithNext(built.bytes);
    expect(kept.moved).toBeGreaterThanOrEqual(1); // 표지 끝의 "Ⅰ 개요" 도 함께 넘어간다
    const after = [await pageOfPara(kept.bytes, "표제목", kept.sectionXml), await pageOfPara(kept.bytes, "표첫칸", kept.sectionXml)];
    expect(after[0]).toBe(after[1]);
  });

  /**
   * 반영 장부 P1(10-13 (단위) 줄)·P2(11-16 ※ 줄): 제목과 표 사이에 낀 줄에서 "다음 문단과 함께" 사슬이 끊겨
   * 제목(과 그 줄)만 쪽 끝에 남고 표만 다음 쪽으로 갔다(「□ 산업유산 → ※ 중복 지정 → 표」).
   * 사이에 끼는 줄의 모양마다, 채움 줄 수를 바꿔 세트가 쪽 경계에 걸리는 모든 자리에서 세트 전체가 한 쪽에 있는지 본다.
   */
  const SETS: Array<{ name: string; lines: string; markers: string[] }> = [
    { name: "□ → ※ → 표", lines: "※ 세트주석 중복 지정 4개소\n", markers: ["세트주석"] },
    { name: "□ → (단위) → 표", lines: "(단위: 원)\n", markers: ["단위: 원"] },
    { name: "□ → ※ → (단위) → 표", lines: "※ 세트주석 중복 지정 4개소\n(단위: 원)\n", markers: ["세트주석", "단위: 원"] },
    { name: "□ → 짧은 머리 줄 → 표", lines: "ㅇ 세트머리 경상북도 산업유산\n", markers: ["세트머리"] },
  ];
  for (const set of SETS) {
    it(`세트를 쪼개지 않는다: ${set.name}`, async () => {
      const markers = ["세트제목", ...set.markers, "세트표칸"];
      let straddled = 0;
      for (let n = 18; n <= 30; n++) {
        let s = `---\nfamily: plan\n제목: 실험\nnumbering: roman\n---\n# 개요\n`;
        for (let i = 0; i < n; i++) s += `ㅇ 채움 문장 ${i} 입니다 채움 문장 입니다\n`;
        s += `□ 세트제목: 8개 시·군 19개소\n${set.lines}| 가 | 나 |\n|---|---|\n| 세트표칸 | 둘 |\n| 셋 | 넷 |\n`;
        const built = buildHwpx(parseDsl(s).doc);
        const before = await Promise.all(markers.map((m) => pageOfPara(built.bytes, m, built.sectionXml, true)));
        if (new Set(before).size === 1) continue;
        straddled++;
        const kept = await applyKeepWithNext(built.bytes);
        const after = await Promise.all(markers.map((m) => pageOfPara(kept.bytes, m, kept.sectionXml, true)));
        expect(new Set(after).size, `채움 ${n}줄: ${markers.join("·")} 쪽 ${after.join("/")}`).toBe(1);
      }
      expect(straddled).toBeGreaterThan(0); // 세트가 쪽 경계에 걸리는 경우를 실제로 시험했다
    }, 60_000); // 13가지 배치를 rhwp 로 재므로 기본 5초를 넘는다
  }
});

/**
 * 반영 장부 Z1·P7(2026-11-16): 한 쪽에 들어가는 표는 쪽 경계에서 나누지 않고 통째로, 두 쪽 넘는 긴 표(집행내역 등)는 나눈다.
 * 담당자: "집행내역처럼 2장 3장 넘어가는 표는 당연히 나눠도 되고, 한 장으로 만들 수 있는 건 한 장으로 하면 베스트".
 */
describe("표 나누기 기준", () => {
  const docWith = (fill: number, rows: number) => {
    let s = `---
family: plan
제목: 실험
numbering: roman
---
# 개요
`;
    for (let i = 0; i < fill; i++) s += `ㅇ 채움 문장 ${i} 입니다 채움 문장 입니다
`;
    s += `□ 목록제목
| 소재지 | 기업 |
|---|---|
`;
    for (let r = 0; r < rows; r++) s += `| 첫행${r === 0 ? "표시" : r} | ${r === rows - 1 ? "끝행표시" : "기업" + r} |
`;
    return parseDsl(s).doc;
  };
  it("한 쪽에 들어가는 20행 목록은 쪽 경계에 걸려도 쪼개지 않는다", async () => {
    let straddled = 0;
    for (let n = 4; n <= 24; n += 2) {
      const doc = docWith(n, 20);
      const plain = buildHwpx(doc);
      const before = await tableRowPages(plain.bytes, plain.sectionXml);
      if (before[0] === before[1]) continue;
      straddled++;
      const laid = await buildLaidOut(doc);
      const after = await tableRowPages(laid.bytes, laid.sectionXml);
      expect(after[0], `채움 ${n}줄: 첫 행 ${after[0]}쪽 / 끝 행 ${after[1]}쪽`).toBe(after[1]);
    }
    expect(straddled).toBeGreaterThan(0);
  }, 180_000);
  it("한 쪽보다 긴 60행 표는 그대로 나눈다", async () => {
    const laid = await buildLaidOut(docWith(10, 60));
    const pages = await tableRowPages(laid.bytes, laid.sectionXml);
    expect(pages[1]).toBeGreaterThan(pages[0]);
  }, 120_000);
});

describe("wrapLines", () => {
  it("어절 단위로 꺾어 센다 — 글자 폭 합보다 줄이 많을 수 있다", () => {
    const ctx = new WriterContext(loadTemplate("plan"), "plan");
    // 한 줄에 한글 5자 폭: "가나다 라마바" 는 폭 합(6.5자)으로는 2줄, 어절로도 2줄
    expect(ctx.wrapLines("가나다 라마바", 10, 5000)).toBe(2);
    // "가나 다라마 바사아": 폭 합 9자 → 2줄이지만 어절로는 "가나"/"다라마"/"바사아" 3줄
    expect(ctx.lineCount("가나 다라마 바사아", 10, 5000)).toBe(2);
    expect(ctx.wrapLines("가나 다라마 바사아", 10, 5000)).toBe(3);
    // 한 줄보다 긴 어절은 글자 단위로 꺾인다
    expect(ctx.wrapLines("가나다라마바사아자차카", 10, 5000)).toBe(3);
  });
});

/** "ㅇ 사업내용: …" 문단의 줄 수와 끝줄 글자(빈칸 뺌) */
async function lastLine(bytes: Uint8Array, sectionXml: string): Promise<{ lines: number; tail: string }> {
  const body = sectionXml.slice(sectionXml.indexOf("<hs:sec"));
  let depth = 0, idx = -1, found = -1;
  for (const m of body.matchAll(/<(\/?)hp:p[ >]|<hp:t>([^<]*)/g)) {
    if (m[2] !== undefined) { if (found < 0 && m[2].includes("사업내용:")) found = idx; continue; }
    if (m[1]) depth--; else { if (depth === 0) idx++; depth++; }
  }
  const mod = await rhwp();
  const doc = new mod.HwpDocument(bytes) as unknown as { getLineInfo(s: number, p: number, o: number): string; getParagraphLength(s: number, p: number): number };
  const len = doc.getParagraphLength(0, found);
  const li = JSON.parse(doc.getLineInfo(0, found, Math.max(0, len - 1))) as { lineCount: number; charStart: number };
  const text = body.match(/<hp:t>([^<]*사업내용:[^<]*)<\/hp:t>/)![1];
  return { lines: li.lineCount, tail: text.slice(li.charStart).replace(/\s/g, "") };
}

describe("줄 맞춤(자간 좁게)", () => {
  it("끝줄에 두세 글자만 남은 문단은 자간을 줄여 윗줄로 붙인다", async () => {
    const head = `---
family: settlement
제목: 실험
---
# 실적
## 성과
□ 사업화 지원금
`;
    // 끝줄에 "지원" 두 글자만 남는 길이를 찾는다(글꼴 폭에 맞춰 스스로 고른다)
    let picked: { dsl: string; before: { lines: number; tail: string } } | undefined;
    for (let n = 0; n < 12 && !picked; n++) {
      const dsl = `${head}ㅇ 사업내용: 도내 청년 로컬크리에이터 5개사에 상품 개발·브랜딩${"·마케팅".repeat(1)}${" 홍보".repeat(n)} 비용 지원
`;
      const b = buildHwpx(parseDsl(dsl).doc);
      const r = await lastLine(b.bytes, b.sectionXml);
      if (r.lines === 2 && r.tail.length <= 4) picked = { dsl, before: r };
    }
    expect(picked).toBeDefined();
    const after = await buildLaidOut(parseDsl(picked!.dsl).doc);
    const r = await lastLine(after.bytes, after.sectionXml);
    expect(r.lines).toBe(1);
  });
});

describe("hangulParaPages", () => {
  const sec = (ps: string[]) =>
    childrenNamed(parseXml(`<hs:sec xmlns:hs="s" xmlns:hp="p">${ps.map((t, i) => `<hp:p id="${i}"><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`).join("")}</hs:sec>`), "hp:p");
  it("문단마다 한글 쪽 글에서 시작·끝 쪽을 찾는다(쪽에 걸친 문단·표만 든 빈 문단 포함)", () => {
    const top = sec(["제목", "", "긴 문단 앞부분 뒷부분", "끝"]);
    const pages = hangulParaPages(top, ["제목\r\n\r\n긴 문단 앞부분 \r\n", "뒷부분\r\n끝\r\n"]);
    expect(pages).toEqual({ start: [0, 0, 0, 1], end: [0, 0, 1, 1] });
  });
  it("글이 맞지 않으면 undefined", () => {
    expect(hangulParaPages(sec(["가", "나"]), ["가\r\n다\r\n"])).toBeUndefined();
  });
});
