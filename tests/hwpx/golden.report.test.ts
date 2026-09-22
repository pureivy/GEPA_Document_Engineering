import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { join } from "node:path";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";
import { validateHwpx, extractText } from "../../lib/hwpx/validate";

const dir = join(process.cwd(), "templates", "report");
const norm = (s: string) => s.replace(/\s+/g, "").trim();

/**
 * 주요업무보고 골든 — 참고본(`templates/report/reference.hwpx`, 23쪽)의 **앞부분을 그대로
 * 옮겨 적은 DSL** 이 같은 꼴로 다시 나오는지 본다.
 *
 * **옮긴 범위**(계획 판정 2): 표지 · 보고순서 · 간지Ⅰ · 일반현황 1~3(설립목적·연혁·조직도) ·
 * 간지Ⅱ · Ⅱ-1(성장 단계별 지원으로 글로벌 강소기업 육성).
 * 일반현황 4(예산)·5(부서별 주요업무)는 **뺐다** — 참고본에서 표 둘(`geometry/t11`·`t14`)이고
 * 작성기가 그 표를 내는 길이 아직 없다. 없는 것을 지어내 옮기느니 범위에서 뺀다.
 *
 * 참고 텍스트(`reference.text.txt`)는 `bin/rhwp export-text` 가 낸 쪽별 TXT 23 개를 **문서
 * 순서대로** 이어 붙인 것이다. 이 문서에서는 추출 순서가 곧 문서 순서였다 — 찍힌 쪽번호가
 * `- 3 -`(7번째 파일)부터 `- 19 -`(23번째)까지 단조증가하는 것으로 확인했다(공문에서는 달랐다).
 *
 * **함정**: `extractText` 가 돌려주는 `●` 는 글자가 아니라 심볼 글꼴의 `U+F06D` 다. 터미널이
 * 빈칸으로 그리므로 `toContain("●")` 은 조용히 실패한다 — 여기서는 기호 **뒤의 글**만 본다.
 */
const dsl = readFileSync(join(dir, "golden", "1.dsl.md"), "utf8");
const reference = readFileSync(join(dir, "reference.text.txt"), "utf8");

/** 참고본에도 실제로 있는 줄인가 — 골든이 참고본을 옮긴 것이지 지어낸 것이 아님을 함께 고정한다. */
const 참고본에있다 = (s: string) => expect(norm(reference), s).toContain(norm(s));

describe("golden: 참고본 주요업무보고 앞부분을 DSL 로 다시 만든다", () => {
  const { doc, warnings } = parseDsl(dsl);

  it("경고 없이 report family 로 읽힌다", () => {
    expect(warnings).toEqual([]);
    expect(doc.family).toBe("report");
  });

  const { bytes, report } = buildHwpx(doc, { now: new Date("2026-06-10T00:00:00Z") });

  /**
   * 표 12 개 = 표지 로고(t00) 1 · 보고순서 상자(t02) 1 · 간지(t03) 2 · 조직도(t09, 바깥 표와
   * 속 표) 2 · 절 번호 칩 4 · 요약박스 2. 조직도가 그림이 아니라 표라는 것(실측)이 여기 숫자로 남는다.
   */
  it("빌드 경고 없이 표 12 개를 만든다", () => {
    expect(report.warnings).toEqual([]);
    expect(report.tables).toBe(12);
  });

  it("@rhwp/core 검증을 contentLoss 0, 오류 없음으로 통과한다", async () => {
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
    expect(v.contentLoss?.count).toBe(0);
  }, 60_000);

  /**
   * 쪽 짜임: 1 표지 · 2 빈 쪽 · 3 보고순서 · 4 빈 쪽 · 5 간지Ⅰ · 6 빈 쪽 · 7 일반현황 1~3 ·
   * 8 간지Ⅱ · 9 빈 쪽 · 10~11 Ⅱ-1. 표지·목차·간지와 그 뒷면 여덟 쪽은 쪽번호를 감추고(세기는 한다)
   * 나머지 세 쪽에만 `- N -` 이 찍힌다.
   *
   * 참고본은 Ⅱ-1 이 한 쪽(찍힌 쪽번호 7)에 들어가는데 여기서는 두 쪽이 된다 — 담당자가 한글에서
   * 보고 정한 문단 위 간격(소제목 10pt · ● 5pt · - 3pt)이 참고본(위 0 / 아래 1.5pt)보다 넓어서다.
   */
  it("11 쪽이고, 쪽번호를 감춘 쪽이 여덟이다", async () => {
    const v = await validateHwpx(bytes);
    expect(v.pageCount).toBe(11);
    const section = new TextDecoder().decode(unzipSync(bytes)["Contents/section0.xml"]);
    expect(section.split('hidePageNum="1"').length - 1).toBe(8);
    // 쪽번호 컨트롤은 문서 첫 문단에 하나뿐이다(참고본과 같다) — 작성기가 쪽마다 찍지 않는다
    expect(section.split("<hp:pageNum").length - 1).toBe(1);
  }, 60_000);

  it("표지에는 제목 말고 글자가 없다 — 보고일·부서를 찍지 않는다", async () => {
    const text = await extractText(bytes);
    참고본에있다("주 요 업 무 보 고");
    // 보고순서 첫 줄 앞은 표지와 그 뒷면 빈 쪽뿐이다 — 거기 글자는 제목 하나여야 한다.
    // (front-matter 의 부서·보고일은 문서의 기록으로만 남고 표지에 찍히지 않는다.)
    const 표지 = text.slice(0, text.indexOf("Ⅰ. 일반현황"));
    expect(norm(표지)).toBe(norm("주 요 업 무 보 고"));
  }, 60_000);

  /**
   * 목차 쪽번호는 **자리표시자** `―`(U+2015)다. 작성기는 쪽을 흘려 보지 않으므로 진짜 쪽번호를
   * 모른다 — 담당자가 한글에서 손으로 채운다. 숫자가 하나라도 붙으면 결재 문서에 틀린 쪽번호가 실린다.
   */
  it("보고순서: 세 줄이 들어가고 쪽번호 자리는 모두 ― 다", async () => {
    const text = await extractText(bytes);
    expect(text.split("―").length - 1).toBe(3);
    for (const line of ["Ⅰ. 일반현황", "Ⅱ. 2025년도 추진성과", "1. 성장 단계별 지원으로 글로벌 강소기업 육성"]) {
      expect(norm(text)).toContain(norm(line) + "―");
      참고본에있다(line);
    }
  }, 60_000);

  it("간지와 절 칩: Ⅰ·Ⅱ 와 1·2·3 이 자동으로 매겨진다", async () => {
    const text = norm(await extractText(bytes));
    expect(text).toContain(norm("Ⅰ. 일 반 현 황"));
    expect(text).toContain(norm("Ⅱ. 2025년도 추진성과"));
    // 칸 번호(1·2·3)와 절 제목이 한 칩 안에서 잇닿는다
    expect(text).toContain(norm("1 설립목적"));
    expect(text).toContain(norm("2 연    혁"));
    expect(text).toContain(norm("3 조직 및 인원"));
    expect(text).toContain(norm("1 성장 단계별 지원으로 글로벌 강소기업 육성"));
  }, 60_000);

  it("요약박스는 요약문으로 시작하는 두 절에만 있다", async () => {
    const text = norm(await extractText(bytes));
    for (const s of ["중소기업 및 소상공인 등에 대한 종합적이고 체계적인 지원사업을 통해", "지역기업의 경쟁력을 강화하여 글로벌 강소기업으로 육성"]) {
      expect(text).toContain(norm(s));
      참고본에있다(s);
    }
  }, 60_000);

  /**
   * 사다리 세 칸. 1 단계 기호는 심볼 글꼴의 `U+F06D` 라 글자 `●` 로는 잡히지 않는다.
   * 참고본은 일반현황 목록에 `ㅇ` 을 쓰지만 담당자가 `●` 로 통일하라고 했다 — `ㅇ` 이 남아 있으면 안 된다.
   */
  it("1 단계 기호는 U+F06D 열여섯 개이고 ㅇ 은 하나도 없다", async () => {
    const text = await extractText(bytes);
    expect(text.split("").length - 1).toBe(16);
    expect(text).not.toMatch(/ㅇ\s/);
    expect(reference).toMatch(/ㅇ\s/); // 참고본에는 있다 — 바꾼 것이 우리 결정임을 못박는다
  }, 60_000);

  it("일반현황: 연혁 일곱 줄과 조직·인원 두 줄이 참고본 그대로 들어간다", async () => {
    const text = norm(await extractText(bytes));
    const items = [
      "1997년  (재)경상북도중소기업종합지원센터 설립",
      "2001년  (재)경상북도중소기업종합지원센터 개원",
      "2005년  동부지소(포항) 개소",
      "2010년  (재)경상북도경제진흥원 명칭 변경",
      "2019년  북부지소(안동) 개소",
      "2022년  실라리안 공유오피스 개소(경산)",
      "2025년  경상북도 기업규제 현장지원단 개소",
      "조  직: 1본부, 3실, 1단, 6팀, 2지소",
      "인  원: 64명(정규직 62명, 계약직 2명)  ※ 정원: 정규직 65명, 계약직 16명",
    ];
    for (const item of items) {
      expect(text).toContain(norm(item));
      참고본에있다(item);
    }
  }, 60_000);

  /**
   * 조직도는 그림이 아니라 표다 — 참고본 조각(`geometry/t09`)을 통째로 복제하므로 글을 바꾸지
   * 않는다. 칸 글이 하나라도 빠지면 조각 복제가 깨진 것이다.
   */
  it("조직도: 참고본 조각의 칸 글이 그대로 나온다", async () => {
    const text = norm(await extractText(bytes));
    for (const cell of ["원장", "강소기업육성본부", "경영기획실", "강소기업지원실", "일자리민생경제지원실", "지역산업지원단", "전략기획팀", "마케팅팀", "동부지소(포항)", "북부지소(안동)"]) {
      expect(text).toContain(norm(cell));
      참고본에있다(cell);
    }
  }, 60_000);

  it("Ⅱ-1: 소제목 셋과 그 아래 사다리가 참고본 그대로 들어간다", async () => {
    const text = norm(await extractText(bytes));
    const items = [
      // □ 소제목(초록 도형 칩 — 기호는 글자로 나오지 않는다)
      "시·군 유망기업 발굴과 맞춤지원으로 경북대표기업 육성",
      "중소기업 정책자금과 긴급자금 지원",
      "중소기업 글로벌 혁신성장과 ESG 경영지원",
      // ● 1 단계
      "경북PRIDE기업(103개사) 경북형 히든챔피언으로 육성",
      "긴급자금 지원을 통해 중소기업의 경영안정과 위기 대응력 마련",
      // - 2 단계
      "지역 우수기업 발굴(칠곡 6, 영천 8, 경주 7, 안동 2) 및 맞춤형 지원 23개사",
      "일시적 자금난 해소를 위한 운전자금(융자규모 3,700억원) 944개사, 2,771억원",
      "CES 2026 최고혁신상 1건, 혁신상 2건 선정",
      "에너지공단 대구경북지역본부와 교육과 심층 컨설팅 지원 협력 체결",
    ];
    for (const item of items) {
      expect(text).toContain(norm(item));
      참고본에있다(item);
    }
  }, 60_000);
});
