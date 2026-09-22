import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText, rhwp } from "../../lib/hwpx/validate";
import { parseDsl } from "../../lib/docmodel/dsl";
import type { DocModel } from "../../lib/docmodel/schema";
import { findAll, parseXml } from "../../lib/hwpx/xml";

const NOW = new Date("2026-09-22T00:00:00Z");
const DIR = join(process.cwd(), "templates/report");
const DSL = readFileSync(join(process.cwd(), "tests/fixtures/report-sample.dsl.md"), "utf8");

describe("buildHwpx — report", () => {
  const { doc, warnings } = parseDsl(DSL);
  const errors = warnings.filter((w) => w.severity === "error");

  it("DSL 이 오류 없이 파싱된다", () => {
    expect(errors).toEqual([]);
    expect(doc.family).toBe("report");
  });

  const { bytes, sectionXml, report } = buildHwpx(doc, { now: NOW });

  it("@rhwp/core 검증을 contentLoss 0 으로 통과한다", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.contentLoss?.count).toBe(0);
  }, 60_000);

  it("report 문서는 쪽번호 컨트롤을 정확히 하나 내보낸다", () => {
    expect((sectionXml.match(/<hp:pageNum /g) ?? []).length).toBe(1);
    expect(sectionXml).toContain('pos="BOTTOM_CENTER"');
    expect(sectionXml).toContain('sideChar="-"');
  });

  it("표지·간지·본문이 문서에 들어간다", async () => {
    const text = await extractText(bytes);
    expect(text).toContain("2026년 주요업무보고");
    expect(text).toContain("(재)경상북도경제진흥원");
    expect(text).toContain("Ⅰ. 일 반 현 황");
    expect(text).toContain("Ⅱ. 2026년도 주요사업");
    expect(text).toContain("중소기업 및 소상공인 등에 대한");
  }, 60_000);

  it("본문 사다리는 반각 공백과 기호를 글자로 낸다 (- 3타)", () => {
    expect(sectionXml).toContain("<hp:t>   - 지역 우수기업 발굴");
    // `ㅇ` 는 참고본의 평평한 목록(일반현황)이다 — 0타로 나간다
    expect(sectionXml).toContain("<hp:t>ㅇ 시·군 유망기업 발굴과");
  });

  it("DSL 의 `●` 는 참고본이 쓰는 사용자 영역 문자 U+F06D 로 나간다", async () => {
    // 참고본은 이 기호를 U+F06D 로 담고 심볼 글꼴(한양신명조)이 그린다 — section0.xml 에
    // 63개, `rhwp export-text` 가 뽑은 글에 `●` 63개로 하나씩 맞는다(실측). 진짜 `●`(U+25CF)를
    // 그대로 내보내면 심볼 글꼴이 아니라 본문 글꼴로 그려져 참고본과 모양이 갈린다.
    expect(sectionXml).toContain("<hp:t>\uF06D </hp:t>");
    expect(sectionXml).not.toContain("●");

    // 읽는 쪽에서는 `●` 로 돌아온다 — 참고본을 읽을 때와 같은 판독기(@rhwp/core)로 확인한다.
    const mod = await rhwp();
    const svg = new mod.HwpDocument(bytes).renderPageSvg(3); // 본문 첫 쪽
    expect(svg).toContain("●");
    expect(svg).not.toContain("\uF06D");

    // extractText 는 section0.xml 을 직접 읽는 우리 도우미라 이 치환을 하지 않는다.
    // 두 값이 다른 것이 정상이고, 그래서 여기 단언을 판독기 쪽에 건다.
    expect(await extractText(bytes)).toContain("\uF06D 시·군 유망기업을 발굴하여");
  }, 60_000);

  it("간지 뒷면은 pageBreak → blank → pageBreak 로 만든 빈 쪽 하나다", () => {
    const sec = parseXml(sectionXml);
    const blanksWithBreak = findAll(sec, "hp:p").filter((p) => p.attrs.pageBreak === "1" && findAll(p, "hp:t").every((t) => t.children.length === 0));
    expect(blanksWithBreak.length).toBe(1);
  });

  it("간지 조각은 구역 컨트롤(newNum)을 끌고 오지 않는다", () => {
    // t03 의 제목 칸에는 <hp:ctrl><hp:newNum/></hp:ctrl> 가 들어 있다 —
    // 복제본에 남으면 쪽번호가 장마다 1 로 되돌아간다.
    expect(sectionXml).not.toContain("hp:newNum");
  });

  it("빌드가 경고 없이 끝난다", () => {
    expect(report.warnings).toEqual([]);
  });

  it("편집기가 넣은 표지 제목은 meta.제목 을 대신한다 (제목이 두 번 나오지 않는다)", () => {
    // 편집기 경로(prosemirror/fromPm.ts:155)는 report 에도 coverTitle 블록을 만들 수 있다.
    // 표지를 meta 에서 내면서 본문 자리에도 내면 표지와 2쪽에 제목이 두 번 선다.
    const edited: DocModel = {
      version: 1,
      family: "report",
      meta: { 제목: "메타 제목", 보고일: "", 보고대상: "", 부서: "", 대상기간: "", 목차표시: true },
      blocks: [{ id: "t1", k: "coverTitle", inlines: [{ t: "text", text: "편집기 제목" }] }],
    };
    const built = buildHwpx(edited, { now: NOW });
    expect(built.sectionXml).toContain("편집기 제목");
    expect(built.sectionXml).not.toContain("메타 제목");
    expect((built.sectionXml.match(/편집기 제목/g) ?? []).length).toBe(1);
    expect(built.report.warnings).toEqual([]);
  });
});

describe("templates/report/style-map.json", () => {
  const map = JSON.parse(readFileSync(join(DIR, "style-map.json"), "utf8")) as {
    para: Record<string, { paraPr: number; charPr: number }>;
    borderFill: Record<string, number>;
  };
  const catalog = JSON.parse(readFileSync(join(DIR, "catalog.json"), "utf8")) as {
    charPr: { id: number }[];
    paraPr: { id: number }[];
  };
  const header = readFileSync(join(DIR, "pkg/Contents/header.xml"), "utf8");

  it("맺어 둔 id 가 모두 카탈로그에 있다", () => {
    // 손으로 쓴 지도라 오타가 나기 쉽고, 없는 id 는 조용히 합성 스타일로 떨어진다.
    const paraIds = new Set(catalog.paraPr.map((p) => p.id));
    const charIds = new Set(catalog.charPr.map((c) => c.id));
    const missing = Object.entries(map.para).filter(([, v]) => !paraIds.has(v.paraPr) || !charIds.has(v.charPr));
    expect(missing).toEqual([]);
  });

  it("tocLine 은 점선 리더가 딸린 문단 모양에 맺혀 있다", () => {
    // 이 연결이 끊기면 목차 점선이 조용히 사라진다(Task 5 가 이 역할 위에 목차를 얹는다).
    const paraPr = new RegExp(`<hh:paraPr id="${map.para.tocLine.paraPr}"[^>]*>`).exec(header);
    expect(paraPr?.[0]).toContain('tabPrIDRef="1"');
    const tabPr = /<hh:tabPr id="1"[\s\S]*?<\/hh:tabPr>/.exec(header);
    expect(tabPr?.[0]).toContain('type="RIGHT"');
    expect(tabPr?.[0]).toContain('leader="CIRCLE"');
  });
});
