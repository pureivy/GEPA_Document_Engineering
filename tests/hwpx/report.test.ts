import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText, rhwp } from "../../lib/hwpx/validate";
import { parseDsl } from "../../lib/docmodel/dsl";
import type { DocModel } from "../../lib/docmodel/schema";
import { findAll, parseXml } from "../../lib/hwpx/xml";
import { unzipSync } from "fflate";

const NOW = new Date("2026-09-22T00:00:00Z");
const DIR = join(process.cwd(), "templates/report");
const DSL = readFileSync(join(process.cwd(), "tests/fixtures/report-sample.dsl.md"), "utf8");
const HEADER = readFileSync(join(DIR, "pkg/Contents/header.xml"), "utf8");
/** 문단모양 단언이 쓰는 생성물 — describe 두 곳이 함께 본다 */
const BUILT = buildHwpx(parseDsl(DSL).doc, { now: new Date("2026-09-22T00:00:00Z") }).bytes;

/**
 * **생성물** 헤더에서 문단모양의 `hp:case` 가지 값을 읽는다.
 *
 * 참고본 헤더가 아니라 만들어 낸 헤더를 본다 — 담당자가 정한 문단 간격을 주려고 참고본
 * 문단모양에서 파생한 것을 새로 등록해 쓰기 때문에, 그 번호는 참고본에 없다.
 *
 * `hp:case` 를 읽는 이유: 같은 값이 `hp:default` 에는 **두 배**로 적힌다
 * (registry.ts 가 쓸 때 2배, `hp:case` 에 0.5배). 한글이 보여 주는 단위는 case 쪽이다.
 */
function paraPrCase(id: string): { intent: number; left: number; prev: number; next: number; lineSpacing: number } {
  const built = new TextDecoder().decode(unzipSync(BUILT)["Contents/header.xml"]);
  const pr = new RegExp(`<hh:paraPr id="${id}"[\\s\\S]*?</hh:paraPr>`).exec(built)?.[0] ?? "";
  const branch = /<hp:case[\s\S]*?<\/hp:case>/.exec(pr)?.[0] ?? pr;
  const num = (k: string) => Number(new RegExp(`<hc:${k} value="(-?\\d+)"`).exec(branch)?.[1] ?? NaN);
  return {
    intent: num("intent"),
    left: num("left"),
    prev: num("prev"),
    next: num("next"),
    lineSpacing: Number(/<hh:lineSpacing[^>]*value="(\d+)"/.exec(branch)?.[1] ?? NaN),
  };
}

/** 참고본 헤더에서 borderFill id 의 채움색을 읽는다 (id 대신 보이는 색으로 단언하려고). */
function fillColorOf(id: string | undefined): string | undefined {
  const bf = new RegExp(`<hh:borderFill id="${id}"[\\s\\S]*?</hh:borderFill>`).exec(HEADER);
  return /<hc:winBrush faceColor="([^"]*)"/.exec(bf?.[0] ?? "")?.[1];
}

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
    // 표지에는 제목 말고 글이 없다 — `부서`(메타)는 표지에 나가지 않는다(담당자 지시,
    // 참고본도 그렇다: 로고 표·빈 문단·제목 도형·빈 문단·기관 그림이 전부다).
    expect(text).not.toContain("(재)경상북도경제진흥원");
    expect(text).toContain("Ⅰ. 일 반 현 황");
    expect(text).toContain("Ⅱ. 2026년도 주요사업");
    expect(text).toContain("중소기업 및 소상공인 등에 대한");
  }, 60_000);

  it("본문 사다리는 반각 공백과 기호를 글자로 낸다 (- 3타)", () => {
    // 기호별 타수 자체는 `tests/docmodel/indent.test.ts` 가 못 박는다 — 쪽을 그리지 않는
    // 자리라 그 규칙을 훨씬 곧게 본다. 여기서는 그 타수가 글자로 나가는지만 본다.
    expect(sectionXml).toContain("<hp:t>   - 지역 우수기업 발굴");
  });

  it("표본의 소제목은 `□` 로 쓰고 도형 칩으로 나간다", () => {
    // 두 줄 다 `##` 칩 밑 `●` 바로 위 — 소제목 칸이다. 표본이 `ㅇ` 로 옮겨 적고 있었고
    // `□` 가 소제목을 가리키게 된 뒤 고쳤다(팀장 판정).
    expect(sectionXml).not.toContain("□");
    expect(sectionXml).toContain("<hp:t> 시·군 유망기업 발굴과");
    expect(sectionXml).toContain("<hp:t> 성장 단계별 맞춤형 지원");
    const sec = parseXml(sectionXml);
    // 표지 제목 상자도 hp:container 라 소제목 칩만 센다 — 칩에는 drawText 가 없다
    const withChip = findAll(sec, "hp:p").filter((p) => findAll(p, "hp:container").some((c) => findAll(c, "hp:drawText").length === 0));
    expect(withChip.length).toBe(2);
    for (const p of withChip) expect(paraPrCase(p.attrs.paraPrIDRef!).intent).toBe(paraPrCase("146").intent);
  });

  it("DSL 의 `●` 는 참고본이 쓰는 사용자 영역 문자 U+F06D 로 나간다", async () => {
    // 참고본은 이 기호를 U+F06D 로 담고 심볼 글꼴(한양신명조)이 그린다 — section0.xml 에
    // 63개, `rhwp export-text` 가 뽑은 글에 `●` 63개로 하나씩 맞는다(실측). 진짜 `●`(U+25CF)를
    // 그대로 내보내면 심볼 글꼴이 아니라 본문 글꼴로 그려져 참고본과 모양이 갈린다.
    // 리터럴 부분문자열로 보지 않는다 — 터미널이 U+F06D 를 빈칸으로 그려서 실패 메시지를
    // 읽을 수 없고(이 저장소에서 두 번 걸렸다), 앞 공백 칸수가 바뀌면 조용히 깨진다.
    // 기호가 든 run 을 찾아 코드포인트로 본다: 사다리 1타 + U+F06D + 뒤 공백.
    const markRun = [...sectionXml.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((m) => m[1]).find((t) => t.includes("\uF06D"));
    expect(markRun, "U+F06D 가 든 run 이 없다").toBeDefined();
    expect([...markRun!].map((c) => c.codePointAt(0))).toEqual([0x20, 0xf06d, 0x20]);
    expect(sectionXml).not.toContain("●");

    // 읽는 쪽에서는 `●` 로 돌아온다 — 참고본을 읽을 때와 같은 판독기(@rhwp/core)로 확인한다.
    const mod = await rhwp();
    const svg = new mod.HwpDocument(bytes).renderPageSvg(4); // 본문 첫 쪽 (앞에 표지·목차·간지·빈 쪽)
    expect(svg).toContain("●");
    expect(svg).not.toContain("\uF06D");

    // extractText 는 section0.xml 을 직접 읽는 우리 도우미라 이 치환을 하지 않는다.
    // 두 값이 다른 것이 정상이고, 그래서 여기 단언을 판독기 쪽에 건다.
    expect(await extractText(bytes)).toContain("\uF06D 시·군 유망기업을 발굴하여");
  }, 60_000);

  it("목차 줄은 탭과 자리표시자 `―`(U+2015)를 갖고, 지어낸 쪽번호가 없다", () => {
    // 자리표시자는 코드포인트로 못 박는다 — em dash(U+2014)·hyphen 과 터미널에서 구별되지 않는다.
    const tabbed = [...sectionXml.matchAll(/<hp:t><hp:tab\/>([\s\S]*?)<\/hp:t>/g)].map((m) => m[1]);
    expect(tabbed.length).toBe(5); // 표본 ```toc 의 다섯 줄
    for (const v of tabbed) expect([...v].map((c) => c.codePointAt(0))).toEqual([0x2015]);

    // 탭 너비를 셈하지 않는다 — 정지점(paraPr 108 → tabPr 1)이 리더를 그린다.
    expect(sectionXml).not.toMatch(/<hp:tab[^/]*width=/);
  });

  it("목차는 참고본의 테두리 상자(t02) 안에 들어간다", () => {
    // 과제 개요는 목차를 "맨 문단 목록" 이라고 했지만 참고본 목차 열네 줄은 1×1 표
    // (borderFill 11 = 사방 #999999 실선) 안에 있다. 맨 문단으로 내면 그 상자가 사라진다.
    const sec = parseXml(sectionXml);
    const box = findAll(sec, "hp:tbl").find((t) => findAll(t, "hp:t").some((n) => n.children.some((c) => typeof c !== "string" && c.name === "hp:tab")));
    expect(box).toBeDefined();
    const tc = findAll(box!, "hp:tc")[0];
    expect(fillColorOf(tc.attrs.borderFillIDRef)).toBeUndefined(); // 채움 없는 테두리 상자
    expect(findAll(tc, "hp:p").length).toBe(5);
  });

  it("목차 절 줄은 장 줄보다 2타 들여쓴다", () => {
    // 참고본 실측: p46(`Ⅰ. 일반현황`)은 0타, p49(`  1. 성장 단계별 …`)는 반각 공백 둘.
    expect(sectionXml).toContain("<hp:t>Ⅰ. 일 반 현 황</hp:t>");
    expect(sectionXml).toContain("<hp:t>  1. 설립목적</hp:t>");
  });

  it("조직도는 참고본 t09 를 통째로 복제해 온다", async () => {
    // 개요는 조직도를 `t14` 라고 적었지만 t14 는 Ⅰ장 5절 **부서별 주요업무** 표다.
    // 조직도는 t09 — 네모와 잇는 줄이 전부 칸 테두리라 `hp:line` 도형이 하나도 없다.
    const text = await extractText(bytes);
    expect(text).toContain("원장");
    expect(text).toContain("동부지소(포항)");
    // 참고본은 이 이름을 run 둘로 갈라 담는다 — 통째로 복제됐다는 증거다.
    expect(sectionXml).toContain("<hp:t>강소기업육성본</hp:t>");
    expect(sectionXml).toContain("<hp:t>부</hp:t>");
    // 사람이 고치는 값(조직·인원)은 표가 아니라 그 앞 `ㅇ` 평목록 줄이다(계획 판정 2).
    expect(text).toContain("조  직: 1본부, 3실, 1단, 6팀, 2지소");
  }, 60_000);

  it("복제한 조각들이 도형 id 를 겹쳐 쓰지 않는다", () => {
    const sec = parseXml(sectionXml);
    const ids = findAll(sec, "hp:tbl").map((t) => t.attrs.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

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

  it("번호+제목 칩은 참고본 색(#000D59 / #ECF2FA)을 쓰는 1×2 표다", () => {
    // 참고본 t31: 칸0 borderFill 53(#000D59) / 칸1 52(#ECF2FA) / 표 테두리 4, 칸 [3719, 43905].
    // id 로 못 박지 않는 까닭: StyleRegistry 는 **서명이 같은 첫 id** 를 돌려주므로 52 자리에는
    // 그와 한 글자도 다르지 않은 쌍둥이 29 가 온다(둘 다 테두리 없음 + #ECF2FA). 보이는 것이
    // 같으면 된 것이고, 정작 지켜야 할 것은 "헤더에 이미 있는 색을 다시 쓴다"는 쪽이다.
    const sec = parseXml(sectionXml);
    const tbl = findAll(sec, "hp:tbl").find((t) => findAll(t, "hp:cellSz").some((c) => c.attrs.width === "3719"));
    expect(tbl).toBeDefined();
    expect(tbl!.attrs.borderFillIDRef).toBe("4"); // 표 테두리
    const cells = findAll(tbl!, "hp:tc");
    expect(cells.map((c) => findAll(c, "hp:cellSz")[0].attrs.width)).toEqual(["3719", "43905"]);
    expect(cells.map((c) => fillColorOf(c.attrs.borderFillIDRef))).toEqual(["#000D59", "#ECF2FA"]);
    expect(sectionXml).toContain("<hp:t> 설립목적</hp:t>");
  });

  it("칩 색은 참고본 borderFill 을 다시 쓰고 새 id 를 붙이지 않는다", () => {
    // StyleRegistry 는 서명으로 헤더를 먼저 뒤진다 — 같은 값을 달라고 하면 참고본 id 가
    // 돌아온다. 여기서 새 borderFill 이 붙으면 색은 맞아도 참고본과 다른 id 로 갈린다.
    expect(report.appendedStyles.filter((a) => a.kind === "borderFill")).toEqual([]);
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

describe("buildHwpx — report 표지 제목 상자", () => {
  const { sectionXml } = buildHwpx(parseDsl(DSL).doc, { now: NOW });

  /**
   * 참고본은 표지 제목을 **도형 안에** 둔다(문단 9 의 `hp:container`, 46673×9417 — 파랑
   * `#558ED5`·주황 `#E46C0A` 장식 두 장과 `hp:drawText` 로 글자를 담은 한 장).
   * 그 안 문단이 `paraPr 45 / charPr 47` 이라 style-map 의 `coverTitle` 과 값이 같고,
   * 그래서 맨 문단으로 내보내도 **글자는 맞고 상자만 사라졌다** — 담당자가 한글에서 보고 알려줬다.
   * 우리 게이트는 전부 초록이었다.
   */
  it("제목이 도형 안에 들어가고 장식 두 장이 함께 온다", () => {
    const i = sectionXml.indexOf("2026년 주요업무보고");
    expect(i, "표지 제목을 못 찾았다").toBeGreaterThan(-1);
    const seg = sectionXml.slice(Math.max(0, i - 4000), i + 60);
    expect(seg, "제목이 도형의 drawText 안에 있어야 한다").toContain("<hp:drawText");
    expect(sectionXml).toContain('faceColor="#558ED5"');
    expect(sectionXml).toContain('faceColor="#E46C0A"');
  });

  it("도형 안 글자를 갈아 끼우면서 캐시된 줄 배치를 지운다", () => {
    // `hp:linesegarray` 는 한글이 참고본 글자("주 요 업 무 보 고")에 맞춰 둔 배치다.
    // 남겨 두면 길이가 다른 새 제목이 옛 폭에 맞춰 잘못 놓인다.
    expect(/<hp:drawText[\s\S]{0,1500}?<hp:linesegarray/.test(sectionXml)).toBe(false);
    expect(sectionXml).not.toContain("주 요 업 무 보 고"); // 참고본 글자가 남아 있으면 치환 실패
  });

  it("표지 도형 id 를 새로 매긴다 (참고본 id 를 끌고 오지 않는다)", () => {
    const sec = parseXml(sectionXml);
    const cover = findAll(sec, "hp:container").find((c) => findAll(c, "hp:drawText").length > 0);
    expect(cover, "표지 도형을 못 찾았다").toBeDefined();
    expect(cover!.attrs.id).toBe(cover!.attrs.instid);
    const rects = findAll(cover!, "hp:rect");
    expect(rects.length).toBe(3);
    expect(new Set(rects.map((r) => r.attrs.instid)).size, "사각형 instid 가 서로 달라야 한다").toBe(3);
  });

});

describe("buildHwpx — report 요약박스", () => {
  // 요약문 상자는 ```box 로 받는다(문법 규칙은 dsl/grammar.md). 표본 DSL 의 맨 요약문 줄은
  // 상자 없이 `summary` 서식으로만 나가므로 여기서 따로 세운 문서로 시험한다.
  const BOX_DSL = [
    "---",
    "family: report",
    "제목: 요약박스 시험",
    "보고일: 2026. 6. 10.",
    "부서: (재)경상북도경제진흥원",
    "---",
    "# 2026년도 주요사업",
    "## 1 K-경상 프로젝트 지원",
    "```box",
    "경북 소상공인의 폐업 위기와 상권 활성화를 위해 닥터 지·바·고 프로젝트 운영",
    "```",
  ].join("\n");
  const { doc, warnings } = parseDsl(BOX_DSL);
  const { sectionXml, report } = buildHwpx(doc as DocModel, { now: NOW });

  it("참고본 색(borderFill 9)을 쓰는 1×1 상자로 나간다", () => {
    expect(warnings.filter((w) => w.severity === "error")).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(sectionXml).toContain('<hp:cellSz width="47905"');
    expect(sectionXml).toContain('borderFillIDRef="9"');
    expect(sectionXml).toContain("닥터 지·바·고");
    // 상자 색도 참고본 id 를 다시 쓴다 — 새 borderFill 이 붙으면 참고본과 갈린다.
    expect(report.appendedStyles.filter((a) => a.kind === "borderFill")).toEqual([]);
  });

  it("사업계획서와 달리 `❖` 를 기본 글머리로 끼우지 않는다", () => {
    // 참고본 요약문에는 글머리 기호가 없다(plan.ts:textBox 는 `◇`, summaryBox 는 `❖` 를 넣는다).
    expect(sectionXml).not.toContain("❖");
    expect(sectionXml).toContain("<hp:t>경북 소상공인의");
  });
});

describe("buildHwpx — report 소제목 도형 칩", () => {
  // 참고본의 소제목은 글자 표지가 없고 인라인 도형 칩이 표지 노릇을 한다. DSL 쪽 기호는
  // `□` 다(`ladderRole` 주석에 고른 까닭이 있다) — 표본 DSL 은 `ㅇ` 로 여덟 군데를 못 박고
  // 있어서 여기서는 따로 세운 문서로 시험한다.
  const SUB_DSL = [
    "---",
    "family: report",
    "제목: 소제목 시험",
    "보고일: 2026. 6. 10.",
    "부서: (재)경상북도경제진흥원",
    "---",
    "# 2026년도 주요사업",
    "## 1 청년정주",
    "□ 청년정주지원센터 운영 청년 정주지원 및 공동체 활동 지원",
    "● 청년 거점공간 운영",
    "□ 로컬크리에이터 양성",
  ].join("\n");
  const { doc, warnings } = parseDsl(SUB_DSL);
  const { bytes, sectionXml, report } = buildHwpx(doc as DocModel, { now: NOW });

  it("DSL 이 오류 없이 파싱되고 빌드가 경고 없이 끝난다", () => {
    expect(warnings.filter((w) => w.severity === "error")).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("소제목은 인라인 도형 칩을 앞에 달고 나온다", () => {
    expect(sectionXml).toContain("#4E9484"); // 그러데이션 색
    expect(sectionXml).toMatch(/<hp:container[^>]*>/);
    expect(sectionXml).toContain("청년정주지원센터 운영");
  });

  it("칩은 글머리표 문자를 대신한다 — `□` 는 글로 나가지 않는다", () => {
    expect(sectionXml).not.toContain("□");
    // 도형 다음은 참고본과 같이 반각 공백 하나로 시작한다.
    expect(sectionXml).toContain("<hp:t> 청년정주지원센터 운영");
  });

  /**
   * 문단모양 번호를 리터럴로 고정하지 않는다. 담당자가 정한 문단 간격(위 10pt / 아래 0)을
   * 주려고 참고본 146 에서 **파생한** 문단모양을 새로 등록해 쓰기 때문이다 — 참고본 패키지를
   * 직접 고치면 큐레이션을 다시 뜰 때 날아간다. 그래서 번호가 아니라 **모양**을 본다.
   */
  it("칩 문단은 참고본 소제목 모양을 그대로 쓰되 간격만 담당자 값이다", () => {
    const sec = parseXml(sectionXml);
    // 표지 제목 상자도 hp:container 라 소제목 칩만 센다 — 칩에는 drawText 가 없다
    const withChip = findAll(sec, "hp:p").filter((p) => findAll(p, "hp:container").some((c) => findAll(c, "hp:drawText").length === 0));
    expect(withChip.length).toBe(2);
    const ref = paraPrCase("146");
    for (const p of withChip) {
      const got = paraPrCase(p.attrs.paraPrIDRef!);
      expect(got.intent, "내어쓰기는 참고본 그대로여야 한다").toBe(ref.intent);
      expect(got.lineSpacing).toBe(ref.lineSpacing);
      expect(got.prev, "문단 위 10pt").toBe(1000);
      expect(got.next, "문단 아래 0").toBe(0);
    }
  });

  it("● 와 - 도 간격만 담당자 값으로 바뀐다", () => {
    // 문단을 XML 문자열에서 곧장 찾는다 — JSON.stringify 는 U+F06D 를 \uf06d 로 이스케이프해
    // 문자로 찾으면 안 걸린다(이 저장소가 보이지 않는 문자에 이미 여러 번 걸렸다).
    const xml = new TextDecoder().decode(unzipSync(BUILT)["Contents/section0.xml"]);
    const paras = [...xml.matchAll(/<hp:p id="\d+" paraPrIDRef="(\d+)"(?:(?!<\/hp:p>)[\s\S])*?<\/hp:p>/g)];
    for (const [origId, prev, has] of [
      ["147", 500, (t: string) => t.includes("\uF06D")],
      ["150", 300, (t: string) => /<hp:t>\s+- /.test(t)],
    ] as const) {
      const p = paras.find((m) => has(m[0]));
      expect(p, `${origId} 을 쓰는 문단을 못 찾았다`).toBeDefined();
      const got = paraPrCase(p![1]);
      expect(got.intent, "내어쓰기는 참고본 그대로").toBe(paraPrCase(origId).intent);
      expect(got.prev).toBe(prev);
      expect(got.next).toBe(0);
    }
  });

  it("칩마다 도형 id 를 새로 매긴다 (참고본 id 를 그대로 끌고 오지 않는다)", () => {
    const sec = parseXml(sectionXml);
    const conts = findAll(sec, "hp:container").filter((c) => findAll(c, "hp:drawText").length === 0); // 표지 상자 제외
    expect(conts.length).toBe(2);
    const ids = conts.map((c) => c.attrs.id);
    expect(ids).not.toContain("1129393238"); // 조각을 뜬 자리의 참고본 id
    for (const c of conts) expect(c.attrs.instid).toBe(c.attrs.id);
    // 칩 하나당 바깥 도형 1 + 속 네모 2 = 서로 다른 여섯 개
    const chipIds = [...ids, ...conts.flatMap((c) => findAll(c, "hp:rect").map((r) => r.attrs.instid))];
    expect(chipIds.length).toBe(6);
    expect(new Set(chipIds).size).toBe(6);
  });

  /**
   * 문서 전체에서 도형 id 가 겹치지 않아야 한다. 칩만 보던 단언은 표지 상자가 생기자
   * 숫자가 어긋나 깨졌는데, 애초에 고정할 값어치가 있는 것은 "칩이 여섯 개"가 아니라
   * **"어느 도형도 id 를 나눠 갖지 않는다"** 이다. 겹치면 한글이 어느 쪽을 집을지 알 수 없다.
   */
  it("문서 안 모든 도형의 instid 가 서로 다르다", () => {
    const sec = parseXml(sectionXml);
    const all = [...findAll(sec, "hp:container"), ...findAll(sec, "hp:rect")].map((n) => n.attrs.instid).filter(Boolean);
    expect(all.length).toBeGreaterThan(6); // 칩 둘 + 표지 상자
    expect(new Set(all).size).toBe(all.length);
  });

  it("@rhwp/core 검증을 contentLoss 0 으로 통과한다", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.contentLoss?.count).toBe(0);
  }, 60_000);
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

/**
 * 간지는 앞에 `<pagebreak>` 가 없어도 새 쪽에서 연다. 담당자에게 보여 준 표본의 Ⅱ 간지가
 * 실제로 쪽 한가운데 찍히고 있었다 — 작성자가 문법을 하나 잊었을 때 문서가 깨지지 않아야 한다.
 */
describe("buildHwpx — report 간지 쪽 나눔", () => {
  const FM = `---\nfamily: report\n제목: t\n보고일: 2026. 9.\n보고대상: 도지사\n부서: 기획조정실\n대상기간: 2026년\n---\n`;
  const bandsOf = (dsl: string) => {
    const { sectionXml } = buildHwpx(parseDsl(FM + dsl).doc, { now: NOW });
    const sec = parseXml(sectionXml);
    // 간지는 t03 조각(1×4 표)이고 쪽 나눔은 **바깥** 문단 속성에 실린다.
    // `findAll` 은 표 셀 안 문단까지 돌려주므로 표를 품은 것만 고른다 — 셀 안 문단은
    // 같은 글자를 담고 있고 pageBreak 는 언제나 0 이라, 안 거르면 이 단언이 헛돈다.
    return findAll(sec, "hp:p")
      .filter((p) => findAll(p, "hp:tbl").length > 0)
      .filter((p) => JSON.stringify(p).includes("일 반 현 황") || JSON.stringify(p).includes("주요사업"));
  };

  it("`<pagebreak>` 가 없어도 간지에 쪽 나눔이 걸린다", () => {
    const got = bandsOf("# 일 반 현 황\n본문\n# 2026년도 주요사업\n본문\n");
    expect(got.length).toBeGreaterThanOrEqual(2);
    for (const p of got) expect(p.attrs.pageBreak, "간지는 새 쪽에서 연다").toBe("1");
  });

  it("명시적 `<pagebreak>` 와 겹쳐도 한 번만 걸린다", () => {
    const got = bandsOf("<pagebreak>\n# 일 반 현 황\n본문\n");
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got[0]!.attrs.pageBreak).toBe("1");
  });
});

/**
 * 대비값(FALLBACK)의 `hanging` 이 참고본과 맞는지 본다.
 *
 * style-map 이 역할을 다 맺고 있어 이 값들은 지금 출력에 쓰이지 않는다 — 그래서 한동안
 * **전부 정확히 절반**이었는데 아무 테스트도 울지 않았다. 역할 하나가 style-map 에서
 * 빠지는 순간 내어쓰기가 조용히 절반이 되고, 그건 한글에서 열어 보기 전에는 안 보인다.
 *
 * 규칙: `registry.ts` 가 `hp:default` 에 `2 × -hanging` 을 쓰고 `hp:case` 에 0.5배를 걸어
 * **case intent = -hanging** 이 된다. 한글이 보여 주는 값도 case 쪽이다.
 */
describe("templates/report — 대비값의 내어쓰기가 참고본과 맞는다", () => {
  const caseIntent = (paraPr: number): number | undefined => {
    const pr = new RegExp(`<hh:paraPr id="${paraPr}"[\\s\\S]*?</hh:paraPr>`).exec(HEADER)?.[0] ?? "";
    const branch = /<hp:case[\s\S]*?<\/hp:case>/.exec(pr)?.[0] ?? pr;
    const m = /<hc:intent value="(-?\d+)"/.exec(branch);
    return m ? Number(m[1]) : undefined;
  };
  const src = readFileSync(join(process.cwd(), "lib/hwpx/writers/report.ts"), "utf8");
  const styleMap = JSON.parse(readFileSync(join(DIR, "style-map.json"), "utf8")) as { para: Record<string, { paraPr: number }> };

  it.each(["chipTitle", "chipLabel", "subHeading", "bullet1", "bullet1Mark", "bullet2"])("%s", (role) => {
    const paraPr = styleMap.para[role]?.paraPr;
    expect(paraPr, `style-map 에 ${role} 이 없다`).toBeDefined();
    const intent = caseIntent(paraPr!);
    expect(intent, `참고본 paraPr ${paraPr} 에 intent 가 없다`).toBeDefined();
    const hanging = Number(new RegExp(`  ${role}: \\{ para: \\{[^}]*hanging: (\\d+)`).exec(src)?.[1]);
    expect(hanging, `${role} 의 대비값 hanging 을 못 찾았다`).not.toBeNaN();
    expect(hanging, "case intent = -hanging 이어야 한다").toBe(-intent!);
  });
});

/**
 * 표지·간지에는 쪽번호를 찍지 않되 **쪽은 센다** (담당자 지시 2026-09-22).
 *
 * 참고본도 같은 구조다: 번호를 켜는 `hp:pageNum` 은 문서 전체에 하나뿐이고
 * (`문단 4`, `BOTTOM_CENTER`/`sideChar="-"`), `hidePageNum="1"` 인 `hp:pageHiding` 이
 * 열다섯 개 붙어 표지·목차·간지 쪽에서만 가린다. 번호를 끄는 게 아니라 그 쪽에만 안 찍는다.
 */
describe("buildHwpx — report 쪽번호 감추기", () => {
  const { sectionXml } = buildHwpx(parseDsl(DSL).doc, { now: NOW });

  it("번호를 켜는 컨트롤은 문서에 하나뿐이다 (쪽은 계속 센다)", () => {
    expect((sectionXml.match(/<hp:pageNum /g) ?? []).length).toBe(1);
    expect(sectionXml).toContain('pos="BOTTOM_CENTER"');
    expect(sectionXml).toContain('sideChar="-"');
  });

  it("표지와 간지마다 감추기가 붙는다", () => {
    // 표본에는 간지가 둘(Ⅰ·Ⅱ) 있고 표지가 하나다.
    expect((sectionXml.match(/hidePageNum="1"/g) ?? []).length).toBe(3);
  });

  it("감추기는 간지 문단 **안에** 있다", () => {
    // 앞에 따로 문단을 세우면 그 문단이 쪽 나눔을 먹어 빈 쪽이 하나 더 생긴다.
    const sec = parseXml(sectionXml);
    // 간지만 고르는 일이 생각보다 까다롭다: 목차 상자에도 "Ⅰ. 일 반 현 황" 글자가 있고,
    // 번호칩도 앞에 `<pagebreak>` 가 있으면 pageBreak="1" 이며, 표지 로고 표도 칸이 넷이다.
    // 간지는 참고본 `t03`(1×4 표)이면서 **언제나 새 쪽에서 여는** 유일한 표다.
    const bands = findAll(sec, "hp:p").filter((p) => p.attrs.pageBreak === "1" && findAll(p, "hp:tc").length === 4);
    expect(bands.length, "표본에는 간지가 둘이다").toBe(2);
    for (const b of bands) expect(findAll(b, "hp:pageHiding").length, "간지 문단이 감추기를 품어야 한다").toBe(1);
  });
});
