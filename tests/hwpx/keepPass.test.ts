import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";
import { applyKeepWithNext, buildLaidOut, hangulParaPages } from "../../lib/hwpx/keepPass";
import { parseXml, childrenNamed } from "../../lib/hwpx/xml";
import { rhwp } from "../../lib/hwpx/validate";
import { WriterContext } from "../../lib/hwpx/writers/context";
import { loadTemplate } from "../../lib/hwpx/template";

async function pageOfPara(bytes: Uint8Array, marker: string, sectionXml: string): Promise<number> {
  // 최상위 문단 순번 → rhwp 배치 쪽
  const body = sectionXml.slice(sectionXml.indexOf("<hs:sec"));
  let depth = 0, idx = -1, found = -1;
  for (const m of body.matchAll(/<(\/?)hp:p[ >]|<hp:t>([^<]*)/g)) {
    if (m[2] !== undefined) { if (found < 0 && m[2].includes(marker)) found = idx; continue; }
    if (m[1]) depth--; else { if (depth === 0) idx++; depth++; }
  }
  const mod = await rhwp();
  const doc = new mod.HwpDocument(bytes) as unknown as { getCursorRect(s: number, p: number, o: number): string };
  return JSON.parse(doc.getCursorRect(0, found, 0)).pageIndex;
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
