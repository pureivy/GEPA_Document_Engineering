import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";
import { parseDsl } from "../../lib/docmodel/dsl";
import { childrenNamed, findAll, parseXml } from "../../lib/hwpx/xml";
import { cellAt } from "../../lib/hwpx/geometry";

const NOW = new Date("2026-09-21T00:00:00Z");

/** 단계 9(한글에서 직접 열기)가 쓰는 것과 같은 DSL — 한 곳에서만 고친다. */
const DSL = readFileSync(join(process.cwd(), "tests/fixtures/official-sample.dsl.md"), "utf8");

describe("buildHwpx — official", () => {
  const { doc, warnings } = parseDsl(DSL);
  const errors = warnings.filter((w) => w.severity === "error");
  it("DSL 이 오류 없이 파싱된다", () => {
    expect(errors).toEqual([]);
    expect(doc.family).toBe("official");
  });

  const { bytes } = buildHwpx(doc, { now: NOW });

  it("@rhwp/core 검증을 contentLoss 0 으로 통과한다", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.contentLoss?.count).toBe(0);
  }, 60_000);

  it("두문·본문·결문의 값이 문서에 들어간다", async () => {
    const text = await extractText(bytes);
    expect(text).toContain("(재)경상북도경제진흥원");
    expect(text).toContain("수신자 참조");
    expect(text).toContain("경영평가 대응을 위한 2026년 사업 추진 현황 제출 요청");
    expect(text).toContain("1. 작성대상: 2026년 각 팀에서 운영하고 있는 전체 사업");
    expect(text).toContain("경영기획실장");
    expect(text).toContain("054-470-8527");
    expect(text).toContain("공개");
  }, 60_000);

  it("시행 칸은 처리과 뒤 하이픈까지만 찍고 일련번호를 만들지 않는다", async () => {
    const text = await extractText(bytes);
    expect(text).toContain("전략기획팀-");
    expect(text).not.toMatch(/전략기획팀-\d/);
  }, 60_000);

  it("붙임과 끝 표시가 들어간다", async () => {
    const text = await extractText(bytes);
    expect(text).toContain("붙임  (양식) 2026년 사업 추진 현황_팀명 1부.  끝.");
  }, 60_000);

  /**
   * 참고 문서의 값이 새 문서에 새지 않는지 본다. t00 조각은 두문 표 **뒤에** 참고 문서의 도입
   * 문장(과 CLICK_HERE 누름틀)을 같은 문단 안에 달고 있고, t01 조각의 칸에는 참고 문서의
   * 시행번호·전송번호·결재 직위가 남아 있다. 위 다섯 검사는 전부 `toContain` 이라 값이 새도
   * 통과한다 — 도입 문장은 시료 DSL 본문과 글자까지 같기 때문이다.
   */
  it("참고 문서의 값이 남지 않는다", async () => {
    const text = await extractText(bytes);
    expect(text.split("경영평가 상시대응체계").length - 1).toBe(1);
    expect(text).not.toContain("485"); // 시행 일련번호
    expect(text).not.toContain("054-472-2989"); // 전송번호 (시료에 없다)
    expect(text).not.toContain("★과장"); // 결재란 직위
    expect(text).not.toContain("ESG·기업지원팀장"); // 수신자 목록
  }, 60_000);
});

/**
 * 시료 DSL 의 본문은 `1. 2. 3.` 뿐이라 글머리 기호가 있는 줄을 건드리지 않는다. 공문서 본문도
 * `ㅇ`·`-` 를 쓸 수 있고(편람 §3 의 2타 사다리), 기호는 blocks 의 `glyph` 에 따로 담겨 있어서
 * inlines 만 쓰면 조용히 사라진다.
 */
describe("buildHwpx — official 본문 글머리 기호", () => {
  const DSL_GLYPH = `---
family: official
수신유형: 내부결재
제목: 글머리 확인
처리과: 전략기획팀
---
1. 작성대상
ㅇ 각 팀 협조
- 세부 항목
`;
  it("글머리 기호와 편람 2타 들여쓰기가 살아 있다", async () => {
    const { doc } = parseDsl(DSL_GLYPH);
    const { bytes } = buildHwpx(doc, { now: NOW });
    const text = await extractText(bytes);
    expect(text).toContain("  ㅇ 각 팀 협조");
    expect(text).toContain("    - 세부 항목");
  }, 60_000);

  /**
   * 번호 항목은 glyph 가 아니라 본문 글자라(`1. 작성대상`) 기호 사다리가 닿지 않았다 — 실제로
   * 쓰는 사람이 `가.` 가 `1.` 과 같은 칸에서 시작하는 것을 보고 신고했다(user 2026-09-22).
   * 편람 §3 의 2타 사다리를 번호에도 적용한다(참고 문서의 관행 4타가 아니라 편람 2타).
   */
  it("번호 항목은 편람 2타 사다리만큼 들여쓴다", async () => {
    const DSL_NUM = `---
family: official
수신유형: 내부결재
제목: 번호 사다리 확인
처리과: 전략기획팀
---
1. 첫째 단계
가. 둘째 단계
1) 셋째 단계
가) 넷째 단계
(1) 다섯째 단계
(가) 여섯째 단계
① 일곱째 단계
㉮ 여덟째 단계
`;
    const { doc } = parseDsl(DSL_NUM);
    const { bytes } = buildHwpx(doc, { now: NOW });
    const text = await extractText(bytes);
    // 첫 항목은 두문 표와 같은 문단에 들어가므로 줄 시작이 아니다 — 들여쓰기 0타만 확인한다
    expect(text).toContain("1. 첫째 단계");
    expect(text).not.toContain(" 1. 첫째 단계");
    for (const [line, indent] of [
      ["가. 둘째 단계", 2],
      ["1) 셋째 단계", 4],
      ["가) 넷째 단계", 6],
      ["(1) 다섯째 단계", 8],
      ["(가) 여섯째 단계", 10],
      ["① 일곱째 단계", 12],
      ["㉮ 여덟째 단계", 14],
    ] as [string, number][]) {
      expect(text, line).toContain(`${" ".repeat(indent)}${line}`);
      expect(text, `${line} 는 ${indent}타를 넘지 않는다`).not.toContain(`${" ".repeat(indent + 1)}${line}`);
    }
  }, 60_000);

  it("굵은 글씨는 참고 문서 글꼴을 유지한 채 별도 charPr 로 나간다", () => {
    const { doc } = parseDsl(DSL_GLYPH.replace("1. 작성대상", "본문에 **굵은 글씨** 가 있다"));
    const { report } = buildHwpx(doc, { now: NOW });
    // 참고 문서 본문은 굴림체 12pt 장평 95 (charPr 8) — 굵은 변형도 같은 글꼴이어야 한다
    expect(report.appendedStyles).toEqual([{ kind: "charPr", id: 25, sig: "굴림체|굴림체|12|B||#000000|0|95|NONE" }]);
  }, 60_000);
});

/**
 * 결문 결재란은 5칸이다 — t01 3행의 셀 이름이 `직위.1` … `직위.5` (cols 0·9·20·32·42) 이고
 * 다섯 칸 모두 `borderFillIDRef=3 paraPr=23 charPr=21` 로 같다. 참고 문서에서 뒤 두 칸이 비어
 * 있는 것은 그 문서가 실장 전결(`★`)이었기 때문이지 서식이 3칸이어서가 아니다.
 *
 * 칸을 어디까지 채울지는 `전결`이 정한다(user 2026-09-22). 기본값은 **원장** — 기관 밖으로 나가는
 * 공문은 기관장 명의로 나가므로 안전한 쪽이 결재라인 전체이고, 전결은 그 사슬을 낮추는 선택이다.
 * 세 단계 모두 명시한 문서로 따로 고정해 둔다 — 어느 단계가 기본값이 되든 각각이 계속 검사된다.
 */
describe("buildHwpx — official 결재란", () => {
  /** 결문 표(paraPr 12 앵커)의 (row, col) 칸 글자 */
  const footCell = (xml: string, row: number, col: number): string => {
    const foot = childrenNamed(parseXml(xml.replace(/^<\?xml[^>]*\?>/, "")), "hp:p").find((p) => p.attrs.paraPrIDRef === "12")!;
    const tc = cellAt(foot, row, col)!;
    return findAll(tc, "hp:t")
      .map((t) => t.children.filter((c) => typeof c === "string").join(""))
      .join("")
      .trim();
  };
  /** 직위.1 … 직위.5 (t01 3행) */
  const 직위 = (xml: string) => [0, 9, 20, 32, 42].map((col) => footCell(xml, 3, col));

  /** 처리과·전결을 바꾼 시료 DSL (발신명의 줄은 지워 전결에서 파생되게 둔다) */
  const dsl = (처리과: string, 전결?: string) =>
    DSL.replace("발신명의: 경영기획실장\n", "").replace("처리과: 전략기획팀", `처리과: ${처리과}${전결 ? `\n전결: ${전결}` : ""}`);
  const 발신명의 = (xml: string) => footCell(xml, 0, 10);

  /**
   * 기본값이 조용히 바뀌면 여기서 걸린다: 전결을 적지 않은 문서가 `전결: 원장` 을 적은 문서와
   * **같은 결문**을 내야 한다(값 자체는 tests/org.test.ts 가 글자로 고정한다).
   */
  it("전결을 적지 않으면 원장까지 결재한다 — 기본값", () => {
    const { sectionXml } = buildHwpx(parseDsl(dsl("전략기획팀")).doc, { now: NOW });
    // 전략기획팀 → 경영기획실: 담당 → 팀장 → 실장 → 원장 (끊지 않는다)
    expect(직위(sectionXml)).toEqual(["담당", "팀장", "실장", "원장", ""]);
    expect(발신명의(sectionXml)).toBe("(재)경상북도경제진흥원장");
    const 명시 = buildHwpx(parseDsl(dsl("전략기획팀", "원장")).doc, { now: NOW });
    expect(직위(sectionXml)).toEqual(직위(명시.sectionXml));
    expect(발신명의(sectionXml)).toBe(발신명의(명시.sectionXml));
  }, 60_000);

  it("원장 전결은 4단계 결재라인의 네 칸을 채우고 발신명의가 기관장이 된다", () => {
    const { sectionXml } = buildHwpx(parseDsl(dsl("전략기획팀", "원장")).doc, { now: NOW });
    expect(직위(sectionXml)).toEqual(["담당", "팀장", "실장", "원장", ""]);
    expect(발신명의(sectionXml)).toBe("(재)경상북도경제진흥원장");
  }, 60_000);

  it("원장 전결은 5단계 결재라인의 다섯 칸을 모두 채운다", () => {
    const { sectionXml } = buildHwpx(parseDsl(dsl("마케팅팀", "원장")).doc, { now: NOW });
    // 마케팅팀 → 강소기업지원실: 담당 → 팀장 → 실장 → 본부장 → 원장
    expect(직위(sectionXml)).toEqual(["담당", "팀장", "실장", "본부장", "원장"]);
    expect(발신명의(sectionXml)).toBe("(재)경상북도경제진흥원장");
  }, 60_000);

  it("본부장 전결은 본부장에서 끊고 발신명의가 본부장이 된다", () => {
    const { sectionXml } = buildHwpx(parseDsl(dsl("마케팅팀", "본부장")).doc, { now: NOW });
    expect(직위(sectionXml)).toEqual(["담당", "팀장", "실장", "본부장", ""]);
    expect(발신명의(sectionXml)).toBe("강소기업육성본부장");
  }, 60_000);

  it("실·단장 전결의 발신명의는 실이면 실장, 단이면 단장", () => {
    const 실 = buildHwpx(parseDsl(dsl("마케팅팀", "실·단장")).doc, { now: NOW });
    expect(직위(실.sectionXml)).toEqual(["담당", "팀장", "실장", "", ""]);
    expect(발신명의(실.sectionXml)).toBe("강소기업지원실장");
    // 지역산업지원단은 실장이 없다 — 담당 → 지소장 → 단장
    const 단 = buildHwpx(parseDsl(dsl("북부지소", "실·단장")).doc, { now: NOW });
    expect(직위(단.sectionXml)).toEqual(["담당", "지소장", "단장", "", ""]);
    expect(발신명의(단.sectionXml)).toBe("지역산업지원단장");
  }, 60_000);

  /**
   * 경영기획실은 원장 직속이라 본부장이 없다(lib/org.ts). 조용히 다른 단계로 바꾸면 결재란이
   * 사실과 달라지므로, 끊지 않고 전체를 쓰되 그렇게 했다고 말한다.
   */
  it("본부 없는 부서의 본부장 전결은 경고하고 결재라인을 끊지 않는다", () => {
    const { sectionXml, report } = buildHwpx(parseDsl(dsl("전략기획팀", "본부장")).doc, { now: NOW });
    expect(직위(sectionXml)).toEqual(["담당", "팀장", "실장", "원장", ""]);
    expect(report.warnings.map((w) => w.message).join("\n")).toContain("본부장 단계가 없습니다");
    expect(발신명의(sectionXml)).toBe("(재)경상북도경제진흥원장"); // 결재라인의 마지막이 원장이다
  }, 60_000);

  it("발신명의를 직접 적으면 전결에서 파생한 값보다 앞선다", () => {
    const { sectionXml } = buildHwpx(parseDsl(DSL.replace("처리과: 전략기획팀", "처리과: 전략기획팀\n전결: 원장")).doc, { now: NOW });
    expect(발신명의(sectionXml)).toBe("경영기획실장"); // 시료 DSL 의 발신명의 — 원장 전결이어도 그대로
  }, 60_000);

  /**
   * 참고 문서의 `★과장` 처럼 규정 밖의 결재란을 재현해야 하는 문서의 탈출구 — `결재라인` 을
   * 직접 적으면 전결에서 파생한 값보다 앞선다(골든 문서가 이 길을 쓴다).
   */
  it("결재라인을 직접 적으면 전결보다 앞선다", () => {
    // 전결을 실·단장으로 적어 두면 파생 결재란은 담당·팀장·실장이다 — 첫 칸의 과장이 명시값의 증거다
    const d = DSL.replace("처리과: 전략기획팀", "처리과: 전략기획팀\n전결: 실·단장\n결재라인: [과장, 팀장, 실장]");
    const { sectionXml } = buildHwpx(parseDsl(d).doc, { now: NOW });
    expect(직위(sectionXml)).toEqual(["과장", "팀장", "실장", "", ""]); // 파생값(담당…)이 아니다
  }, 60_000);

  it("원장 전결이면 마지막 직위(원장)까지 결재란에 들어간다", async () => {
    const { doc } = parseDsl(dsl("전략기획팀", "원장"));
    const { bytes, report } = buildHwpx(doc, { now: NOW });
    const text = await extractText(bytes);
    // 전략기획팀 → 경영기획실: 담당 → 팀장 → 실장 → 원장 (lib/org.ts)
    for (const 직위 of ["담당", "팀장", "실장", "원장"]) expect(text, 직위).toContain(직위);
    expect(report.warnings.map((w) => w.message).filter((m) => m.includes("결재란"))).toEqual([]);
  }, 60_000);

  it("결재라인이 5칸을 넘으면 경고한다", () => {
    const { doc } = parseDsl(DSL.replace("처리과: 전략기획팀", "처리과: 전략기획팀\n결재라인: [담당, 팀장, 실장, 본부장, 원장, 이사장]"));
    const { report } = buildHwpx(doc, { now: NOW });
    expect(report.warnings.map((w) => w.message).join("\n")).toContain("이사장");
  }, 60_000);
});

/**
 * 참고 문서에서 **첫 본문 문단**은 두문 표와 같은 문단에 있다(표 run 다음에 글 run). 별도
 * 문단으로 내면 표만 든 앵커가 paraPr 28(12pt 200 %) 높이의 빈 줄을 차지해, 한글에서 제목
 * 아래 빈 줄로 보인다 — rhwp·resvg 는 이 빈 줄을 접기 때문에 렌더 비교로는 잡히지 않는다.
 *
 * 기준은 글의 모양이 아니라 자리다: 표본 1(「실라리안 특판전」)의 앵커 문단은 번호 항목
 * `1. 평소 부서 운영에 협조해 주셔서 감사합니다.` 를 담고 있다.
 */
describe("buildHwpx — official 첫 본문 문단", () => {
  /** 최상위 문단만 — 표 안(hp:subList)의 칸 문단은 세지 않는다 */
  const tops = (xml: string) => childrenNamed(parseXml(xml.replace(/^<\?xml[^>]*\?>/, "")), "hp:p");
  /** 문단 **직속** run 의 표/글만 본다 — findFirst 로 훑으면 표 칸 안의 글까지 딸려 온다 */
  const shape = (xml: string) =>
    tops(xml).map((p) => {
      const runs = childrenNamed(p, "hp:run");
      return {
        paraPr: p.attrs.paraPrIDRef,
        table: runs.some((r) => childrenNamed(r, "hp:tbl").length > 0),
        text: runs
          .flatMap((r) => childrenNamed(r, "hp:t"))
          .map((t) => t.children.filter((c) => typeof c === "string").join(""))
          .join(""),
      };
    });

  it("첫 본문 문단은 두문 표와 같은 문단에 들어간다 — 빈 앵커 문단을 남기지 않는다", () => {
    const { doc } = parseDsl(DSL);
    const { sectionXml } = buildHwpx(doc, { now: NOW });
    const ps = shape(sectionXml);
    expect(ps.map((p) => p.paraPr)).toEqual(["28", "27", "27", "27", "29", "12"]);
    expect(ps[0].table).toBe(true);
    expect(ps[0].text).toContain("경영평가 상시대응체계 구축");
    // 표만 들고 글이 없는 최상위 문단은 결문 앵커 하나뿐이어야 한다(참고 문서도 그렇다)
    expect(ps.filter((p) => p.table && !p.text).map((p) => p.paraPr)).toEqual(["12"]);
  }, 60_000);

  it("번호 항목으로 시작하는 공문은 그 항목이 앵커에 들어간다 (표본 1)", () => {
    const dsl = DSL.replace(/---\n경영평가 상시대응체계[^\n]*\n/, "---\n");
    const { sectionXml } = buildHwpx(parseDsl(dsl).doc, { now: NOW });
    const ps = shape(sectionXml);
    expect(ps.map((p) => p.paraPr)).toEqual(["28", "27", "27", "29", "12"]);
    expect(ps[0].text).toContain("1. 작성대상");
    expect(ps.filter((p) => p.table && !p.text).map((p) => p.paraPr)).toEqual(["12"]); // 빈 앵커 없음
  }, 60_000);

  it("앵커에 들어가는 첫 문단도 글머리 기호와 들여쓰기를 지킨다", () => {
    const dsl = DSL.replace(/---\n경영평가 상시대응체계[^\n]*\n/, "---\nㅇ 각 팀 협조\n");
    const { sectionXml } = buildHwpx(parseDsl(dsl).doc, { now: NOW });
    // 기호는 blocks 의 glyph 에 따로 있다 — inlines 만 넘기면 조용히 사라진다
    expect(shape(sectionXml)[0].text).toContain("  ㅇ 각 팀 협조");
  }, 60_000);
});

/**
 * 제출·회신을 요구하는 공문은 받는 쪽이 쓸 서식을 별지로 붙인다(user 2026-09-22). 별지는
 * `<pagebreak>` 뒤에 오는데, 결문은 본문이 끝나는 쪽에 와야 한다 — 맨 뒤에 붙이면 발신명의·
 * 결재란·시행 정보가 별지 뒤로 밀려 공문 꼴이 무너진다.
 */
describe("buildHwpx — official 별지(붙임 서식)", () => {
  const DSL_별지 = `---
family: official
수신유형: 수신자
수신: 전부서
제목: 신규사업 제출 요청
처리과: 전략기획팀
전결: 실·단장
붙임: ["(서식) 신규사업 사업계획(안) 1부."]
---
1. 제출내용: 신규사업 사업계획안
2. 작성서식: 붙임 서식에 따라 작성

<pagebreak>

(서식)

□ 사 업 명:
`;

  it("결문과 붙임이 별지보다 앞에 온다", async () => {
    const { doc } = parseDsl(DSL_별지);
    const { bytes } = buildHwpx(doc, { now: NOW });
    const text = await extractText(bytes);
    const 붙임 = text.indexOf("붙임  (서식) 신규사업 사업계획(안) 1부.  끝.");
    const 발신명의 = text.indexOf("경영기획실장");
    const 별지 = text.indexOf("(서식)\n");
    expect(붙임).toBeGreaterThan(-1);
    expect(발신명의).toBeGreaterThan(-1);
    expect(별지).toBeGreaterThan(-1);
    expect(붙임).toBeLessThan(별지);
    expect(발신명의).toBeLessThan(별지);
  }, 60_000);

  it("별지가 없으면 결문은 그대로 맨 뒤에 온다", async () => {
    const DSL_평범 = DSL_별지.slice(0, DSL_별지.indexOf("\n<pagebreak>")) + "\n";
    const { doc } = parseDsl(DSL_평범);
    const { bytes } = buildHwpx(doc, { now: NOW });
    const text = await extractText(bytes);
    expect(text.indexOf("2. 작성서식: 붙임 서식에 따라 작성")).toBeLessThan(text.indexOf("경영기획실장"));
  }, 60_000);
});
