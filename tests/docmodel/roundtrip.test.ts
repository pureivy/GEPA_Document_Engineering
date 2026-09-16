import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { toDsl, toMarkdown, toText, preludeLength } from "../../lib/docmodel/serialize";
import { fixture, stripIds } from "./helpers";

const FIXTURES = ["notice", "plan", "press"] as const;

describe("toDsl round trip", () => {
  it("parseDsl(toDsl(parseDsl(x).doc)).doc equals parseDsl(x).doc (ignoring ids)", () => {
    for (const name of FIXTURES) {
      const a = parseDsl(fixture(name));
      const dsl = toDsl(a.doc);
      const b = parseDsl(dsl);
      expect(b.warnings, name).toEqual([]);
      expect(stripIds(b.doc), name).toEqual(stripIds(a.doc));
    }
  });

  it("does not serialize synthesized blocks (they come back from meta)", () => {
    const a = parseDsl(fixture("notice"));
    const dsl = toDsl(a.doc);
    expect(preludeLength(a.doc)).toBe(9);
    expect(dsl).not.toContain("# 1. 모집개요");
    expect(dsl).not.toContain("# 2. 지원절차");
    expect(dsl).not.toContain("```infobox");
    expect(dsl).toContain("# 3. 사업목적");
    expect(dsl).toContain("| 합 계 | < | 100 |");
    expect(dsl).toContain("| 2 | 사업계획서 | 1부 | ^ |");
    // the fixed 기타유의사항 passage (which carries the www.gepa.kr link) collapses back to its macro
    expect(dsl).toContain("{{boilerplate:기타유의사항 주관기관=안동시}}");
    expect(dsl).not.toContain("[www.gepa.kr](http://www.gepa.kr)");
    expect(dsl).toContain("{red}수출실적, 매출성장률{/red}");
  });

  it("survives tricky literal text (escapes) and every fenced construct", () => {
    const src = [
      "---",
      "family: plan",
      "제목: 표지 제목",
      "부제: 부제목",
      "---",
      "\\# 우물정으로 시작하는 문장",
      "\\| 파이프로 시작",
      "\\□ 네모로 시작하는 평문",
      "\\(단위: 천원)이 아닌 문장",
      "별표 \\*\\* 두 개와 \\{red\\} 와 \\[링크](x) 와 역슬래시 \\\\ 포함",
      "두 줄로 \\",
      "이어지는 문단",
      "```box",
      "◇ 목적 **강조**",
      "둘째 줄",
      "```",
      "```toc",
      "Ⅰ. 하나 ······ 1",
      "```",
      "```attach",
      "붙임 1. 신청서 1부",
      "```",
      "```image chart width=100mm align=center",
      "```",
      "{table role=roles widths=120,360 header-fill=#e5e5e5 padding=text font=11 caption=\"(단위: 천원)\" border=grey012}",
      "| 구분 | 역할 |",
      "|---|---|",
      "| \\^ | 셀 안 \\| 파이프 |",
      "| 합계 | 값 |",
      "| ^ | 아래 |",
      "| 소계 | < |",
      "# 5. 다섯째 장",
      "## [사업개요] 이름표",
      "## 󰊲 기호표",
      "## 3. 숫자표",
      "<pagebreak>",
      "",
      "",
      "ㅇ 마지막.  끝.",
      "",
    ].join("\n");
    const a = parseDsl(src);
    expect(a.warnings).toEqual([]);
    const b = parseDsl(toDsl(a.doc));
    expect(b.warnings).toEqual([]);
    expect(stripIds(b.doc)).toEqual(stripIds(a.doc));
    // and a third pass is stable
    expect(toDsl(b.doc)).toBe(toDsl(a.doc));
  });

  it("round-trips a notice with ```infobox and ```flow in the body", () => {
    const src = fixture("notice") + "\n```infobox\n□ 문의\n○ 전화: 054-000-0000\n○ 둘째 줄<br>이어짐\n```\n```flow\n공고 | 7월\n선정 | 8월\n```\n";
    const a = parseDsl(src);
    expect(a.warnings.map((w) => w.message)).toEqual([expect.stringContaining("infobox")]);
    const b = parseDsl(toDsl(a.doc));
    expect(stripIds(b.doc)).toEqual(stripIds(a.doc));
  });
});

describe("toText / toMarkdown (press deliverables)", () => {
  const { doc } = parseDsl(fixture("press"));
  it("toText renders header, title, body and 붙임", () => {
    const txt = toText(doc);
    expect(txt.startsWith("보도자료\n(재)경상북도경제진흥원\n배포일: 2026. 7. 1.(수)\n")).toBe(true);
    expect(txt).toContain("\n경북경제진흥원, 안동시 수출기업 역량강화 지원사업 참여기업 모집\n");
    expect(txt).toContain("□ 지원내용\nㅇ …\n");
    expect(txt).toContain("붙임 1. 사업 공고문 1부\n끝.");
    expect(txt).not.toMatch(/\n\n\n/);
  });
  it("toMarkdown renders a head table, headings and links", () => {
    const md = toMarkdown(doc);
    expect(md).toContain("| 담당자 | 김OO 팀장 (054-900-3801) |");
    expect(md).toContain("# 경북경제진흥원, 안동시 수출기업 역량강화 지원사업 참여기업 모집");
    expect(md).toContain("## 7월 15일까지 접수… 기업당 최대 300만원 수출매뉴얼 지원");
    const notice = toMarkdown(parseDsl(fixture("notice")).doc);
    expect(notice).toContain("[www.gepa.kr](http://www.gepa.kr)");
    expect(notice).toContain("| 합 계 |  | 100 |");
    expect(notice).toContain("## 3. 사업목적");
  });
});
