import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";
import { parseDsl } from "../../lib/docmodel/dsl";
import { findAll, parseXml } from "../../lib/hwpx/xml";

/**
 * 업무보고 앞장 스위치(표지·목차표시·빈뒷면).
 *
 * 기본값(모두 켜짐)은 참고본 모양 그대로다 — report.test.ts·golden.report.test.ts 가 그것을 지킨다.
 * 여기서는 **끈 경우**를 본다. 계기(2026-11-09): 내용 1.5쪽짜리 「2027년 주요사업 안내책자 제작」이
 * 표지·목차·간지 둘과 그 뒷면 빈 쪽 넷 때문에 12쪽으로 나갔다.
 */
const NOW = new Date("2026-11-09T00:00:00Z");
const SAMPLE = readFileSync(join(process.cwd(), "tests/fixtures/report-sample.dsl.md"), "utf8");

/** 픽스처의 front-matter 끝(`---` 둘째 줄) 앞에 줄을 덧붙인다 */
function withMeta(dsl: string, extra: string): string {
  const end = dsl.indexOf("\n---", 4);
  return dsl.slice(0, end) + "\n" + extra + dsl.slice(end);
}

/** 뒷면 빈 쪽 = 쪽 나눔 + 쪽번호 감추기 + 표 없음 + 글자 없음 (report.test.ts 와 같은 판정) */
function backPages(sectionXml: string) {
  return findAll(parseXml(sectionXml), "hp:p").filter(
    (p) =>
      p.attrs.pageBreak === "1" &&
      findAll(p, "hp:pageHiding").length === 1 &&
      findAll(p, "hp:tbl").length === 0 &&
      findAll(p, "hp:t").every((t) => t.children.length === 0),
  );
}

describe("업무보고 앞장 스위치 — 기본값", () => {
  it("스위치를 적지 않으면 셋 다 켜짐으로 읽힌다", () => {
    const { doc } = parseDsl(SAMPLE);
    if (doc.family !== "report") throw new Error("report 가 아니다");
    expect(doc.meta.표지).toBe(true);
    expect(doc.meta.목차표시).toBe(true);
    expect(doc.meta.빈뒷면).toBe(true);
  });
});

describe("업무보고 앞장 스위치 — 빈뒷면: false", () => {
  const { doc } = parseDsl(withMeta(SAMPLE, "빈뒷면: false"));
  const { sectionXml } = buildHwpx(doc, { now: NOW });

  it("뒷면 빈 쪽이 하나도 나오지 않는다 (기본은 넷)", () => {
    expect(backPages(sectionXml).length).toBe(0);
  });

  it("표지·목차·간지는 그대로 남는다", async () => {
    const { bytes } = buildHwpx(doc, { now: NOW });
    const text = await extractText(bytes);
    expect(text).toContain("2026년 주요업무보고");
    expect(text).toContain("Ⅰ. 일 반 현 황");
    expect(text).toContain("Ⅱ. 2026년도 주요사업");
  }, 60_000);

  it("빈 쪽만큼 쪽 수가 준다", async () => {
    const full = await validateHwpx(buildHwpx(parseDsl(SAMPLE).doc, { now: NOW }).bytes);
    const slim = await validateHwpx(buildHwpx(doc, { now: NOW }).bytes);
    expect(slim.errors).toEqual([]);
    expect(slim.pageCount).toBe(full.pageCount - 4);
  }, 60_000);
});

describe("업무보고 앞장 스위치 — 간이 보고(셋 다 끔)", () => {
  const DSL = `---
family: report
제목: 2027년 주요사업 안내책자 제작 추진 보고
부서: 전략기획팀
표지: false
목차표시: false
빈뒷면: false
---
## 추진 개요
□ 안내책자 제작
● 2027년 주요 지원사업을 수요자가 찾아보기 쉽게 안내책자로 제작
- 3,000부(210×250mm, 본문 84쪽 내외)
- 계약체결일 ~ 2026. 12. 31.
`;
  const { doc, warnings } = parseDsl(DSL);
  const built = buildHwpx(doc, { now: NOW });

  it("DSL 이 오류 없이 파싱되고 스위치가 꺼진 채로 읽힌다", () => {
    expect(warnings.filter((w) => w.severity === "error")).toEqual([]);
    if (doc.family !== "report") throw new Error("report 가 아니다");
    expect(doc.meta.표지).toBe(false);
    expect(doc.meta.목차표시).toBe(false);
    expect(doc.meta.빈뒷면).toBe(false);
  });

  it("한 쪽으로 나오고 rhwp 검증을 통과한다", async () => {
    const v = await validateHwpx(built.bytes);
    expect(v.errors).toEqual([]);
    expect(v.contentLoss?.count).toBe(0);
    expect(v.pageCount).toBe(1);
  }, 60_000);

  it("표지 도형 대신 맨 위에 제목 줄이 나온다", async () => {
    const text = await extractText(built.bytes);
    expect(text).toContain("2027년 주요사업 안내책자 제작 추진 보고");
    expect(text).toContain("3,000부");
    // 제목이 표지 도형의 글상자(hp:drawText)가 아니라 맨 문단 글로 나온다.
    // (`□` 소제목 칩도 hp:container 라서 container 유무로는 표지를 가릴 수 없다)
    expect(built.sectionXml).toContain("<hp:t>2027년 주요사업 안내책자 제작 추진 보고</hp:t>");
    expect(built.sectionXml).not.toContain("hp:drawText");
    expect(built.sectionXml).not.toContain("<hp:pic"); // 표지 아래 기관 로고 그림도 없다
    expect(backPages(built.sectionXml).length).toBe(0);
  }, 60_000);

  it("쪽번호 컨트롤은 그대로 하나다", () => {
    expect((built.sectionXml.match(/<hp:pageNum /g) ?? []).length).toBe(1);
  });
});

describe("업무보고 앞장 스위치 — 목차표시: false", () => {
  const { doc } = parseDsl(withMeta(SAMPLE, "목차표시: false"));
  const built = buildHwpx(doc, { now: NOW });

  it("목차 상자를 내지 않고 경고로 알린다", async () => {
    const text = await extractText(built.bytes);
    // 목차 줄의 자리표시자 `―` 가 문서에 없다
    expect(built.sectionXml).not.toContain("―");
    expect(text).toContain("Ⅰ. 일 반 현 황"); // 간지는 남는다
    expect(built.report.warnings.some((w) => w.message.includes("목차표시"))).toBe(true);
  }, 60_000);
});

/**
 * 요약박스 줄 이어 붙이기 (담당자 2026-11-09: "…이해도 / 를 높이고 / 기관 사업을 홍보" 처럼
 * 손으로 끊은 줄과 자동 줄바꿈이 겹쳐 들쭉날쭉했다). 이어지는 줄은 한 문단, 글머리 줄은 따로.
 */
describe("업무보고 요약박스 — 손으로 끊은 줄은 한 문단으로 잇는다", () => {
  const DSL = `---
family: report
제목: 요약박스 줄 잇기
표지: false
목차표시: false
빈뒷면: false
---
## 추진배경 및 목적
\`\`\`box
2027년도 주요사업 및 정책 정보를 안내책자로 제작하여 대내외 이해도를 높이고
기관 사업을 홍보
- 글머리 줄은 따로 남는다
\`\`\`
`;
  const { sectionXml } = buildHwpx(parseDsl(DSL).doc, { now: NOW });

  it("이어지는 두 줄이 한 문단의 글로 합쳐진다", () => {
    expect(sectionXml).toContain("대내외 이해도를 높이고 기관 사업을 홍보");
  });

  it("글머리로 시작하는 줄은 새 문단으로 남는다", () => {
    const paras = findAll(parseXml(sectionXml), "hp:p").filter((p) => findAll(p, "hp:tbl").length === 0 &&
      findAll(p, "hp:t").some((t) => t.children.some((c) => typeof c === "string" && c.includes("글머리 줄은 따로"))),
    );
    expect(paras.length).toBeGreaterThan(0);
    const joined = findAll(parseXml(sectionXml), "hp:p").filter((p) => findAll(p, "hp:tbl").length === 0 &&
      findAll(p, "hp:t").some((t) => t.children.some((c) => typeof c === "string" && c.includes("기관 사업을 홍보"))),
    );
    // 같은 문단에 글머리 줄이 섞이지 않는다 (표를 감싼 바깥 문단은 빼고 칸 안 문단만 본다)
    expect(joined.length).toBeGreaterThan(0);
    for (const p of joined) expect(findAll(p, "hp:t").some((t) => t.children.some((c) => typeof c === "string" && c.includes("글머리 줄")))).toBe(false);
  });
});

/** 간략 보고(`형태: 간략`) — 담당자가 "이 정도면 충분하다"고 한 1쪽 개조식 보고 모양 */
describe("업무보고 형태: 간략", () => {
  const DSL = `---
family: report
형태: 간략
제목: 2027년 주요사업 안내책자 제작 추진 보고
보고일: 2026. 11. 9.(월)
부서: 전략기획팀
---
## 추진 개요
● **(목적)** 진흥원 2027년 주요 지원사업을 수요자가 쉽게 찾아볼 수 있도록 안내책자 제작·배포
● **(제작규모)** 3,000부(210×250mm, 본문 84쪽 내외)
## 제작 용역 계약 체결
● **(계약금액)** 금19,450,000원(부가가치세 포함)
- 견적 비교 결과 최저가 업체
※ 계약서류 확인 완료
`;
  const { doc, warnings } = parseDsl(DSL);
  const built = buildHwpx(doc, { now: NOW });

  it("파싱 오류가 없고 형태가 간략으로 읽힌다", () => {
    expect(warnings.filter((w) => w.severity === "error")).toEqual([]);
    if (doc.family !== "report") throw new Error("report 가 아니다");
    expect(doc.meta.형태).toBe("간략");
  });

  it("한 쪽으로 나오고 rhwp 검증을 통과한다", async () => {
    const v = await validateHwpx(built.bytes);
    expect(v.errors).toEqual([]);
    expect(v.contentLoss?.count).toBe(0);
    expect(v.pageCount).toBe(1);
  }, 60_000);

  it("절은 초록 칩 없이 □ 소제목 글자로, ● 는 ㅇ 으로 나간다", async () => {
    const text = await extractText(built.bytes);
    expect(text).toContain("□ 추진 개요");
    expect(text).toContain("□ 제작 용역 계약 체결");
    expect(text).toContain("ㅇ (목적)");
    expect(text).toContain("- 견적 비교 결과 최저가 업체");
    expect(text).toContain("※ 계약서류 확인 완료");
    // 칩·표지 도형이 없다
    expect(built.sectionXml).not.toContain("<hp:container");
    expect(built.sectionXml).not.toContain("hp:drawText");
  }, 60_000);

  it("맨 위에 제목과 보고일·부서 줄이 나온다", async () => {
    const text = await extractText(built.bytes);
    expect(text).toContain("2027년 주요사업 안내책자 제작 추진 보고");
    expect(text).toContain("2026. 11. 9.(월) 전략기획팀");
  }, 60_000);

  it("빌드 경고가 없다", () => {
    expect(built.report.warnings).toEqual([]);
  });
});
