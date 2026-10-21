import { describe, it, expect } from "vitest";
import { normalizeDslText, normalizeDocMeta } from "../../lib/docmodel/govNormalize";
import { parseDsl } from "../../lib/docmodel/dsl";

describe("normalizeDslText — 편람 표기 자동 정규화", () => {
  it("attaches tildes, strips zero padding, adds the period before a weekday, spaces glued dates", () => {
    const { text, changes } = normalizeDslText("ㅇ (접수기간) 2026. 07. 01. ~ 07. 15. 18:00\nㅇ 2026.7.14. 개최, 2026. 7. 14(화) 발표\n");
    expect(text).toBe("ㅇ (접수기간) 2026. 7. 1.~7. 15. 18:00\nㅇ 2026. 7. 14. 개최, 2026. 7. 14.(화) 발표\n");
    expect(changes.map((c) => c.rule)).toEqual(expect.arrayContaining(["물결표", "날짜 0 생략", "날짜 띄어쓰기", "날짜 마침표"]));
  });
  it("fixes colon spacing, 끝. spacing and the director placeholder", () => {
    const { text } = normalizeDslText("ㅇ 원장 : 김갑동\nㅇ 지역경제 활성화 도모 끝.\n(재)경상북도경제진흥원(원장 ○○○)은 … ○○○ 원장은 말했다\n");
    expect(text).toContain("원장: 김갑동");
    expect(text).toContain("활성화 도모  끝.");
    expect(text).toContain("(원장 박성수)");
    expect(text).toContain("박성수 원장은");
  });
  it("leaves compliant text alone and also fixes fenced box text", () => {
    const src = "ㅇ 2026. 7. 1.~12. 31. 접수(07. 01.~07. 15.)  끝.\n";
    expect(normalizeDslText(src)).toEqual({ text: "ㅇ 2026. 7. 1.~12. 31. 접수(7. 1.~7. 15.)  끝.\n", changes: [{ rule: "날짜 0 생략", count: 3 }] });
    const ok = "ㅇ 2026. 7. 1.~12. 31.  끝.\n";
    expect(normalizeDslText(ok)).toEqual({ text: ok, changes: [] });
    expect(normalizeDslText("```box\n❖ 2026. 7. 1. ~ 12. 31.\n```\n").text).toContain("2026. 7. 1.~12. 31.");
  });
  it("normalizeDocMeta fills the press department full name and head from the org table", () => {
    const dsl = "---\nfamily: press\n배포일: 2026. 9. 21.(월)\n담당부서: 전략기획팀\n담당자: 박용식 과장\n연락처: 054-470-8500\n제목: 제목\n---\n본문\n";
    const { doc } = parseDsl(dsl);
    const { doc: out, changes } = normalizeDocMeta(doc);
    expect(out.family === "press" && out.meta.담당부서).toBe("경영기획실");
    expect(out.family === "press" && out.meta.책임자).toBe("실장 남상범");
    expect(changes.map((c) => c.rule)).toEqual(["담당부서 정식 명칭", "책임자 자동 채움"]);
  });
});

describe("normalizeDslText — 항목 하나 이어 쓰기", () => {
  it("- 항목 아래 · 가 하나뿐이면 위 줄에 이어 쓴다", () => {
    const { text, changes } = normalizeDslText(["- (현장실사) 7개사 대상 현장 확인", "· 실사 중 3개사 지정 포기", "- (최종심사) 4개사 지정"].join("\n"));
    expect(text).toBe(["- (현장실사) 7개사 대상 현장 확인, 실사 중 3개사 지정 포기", "- (최종심사) 4개사 지정"].join("\n"));
    expect(changes.map((c) => c.rule)).toContain("항목 하나 이어 쓰기");
  });
  it("· 가 둘 이상이면 그대로 둔다", () => {
    const src = ["- (변경) 두 건", "· 첫째", "· 둘째"].join("\n");
    expect(normalizeDslText(src).text).toBe(src);
  });
  it("울타리 안은 건드리지 않는다", () => {
    const src = ["```box", "- 요지", "· 하나", "```"].join("\n");
    expect(normalizeDslText(src).text).toBe(src);
  });
  it("사진 대지의 파일 경로는 그대로 두고 설명의 날짜만 고친다", () => {
    const src = ["```photos", "materials/사진2_판매전(2025.10.25.).jpg | 판매전(2025.10.25.)", "```", "ㅇ 2025.10.25. 개최"].join("\n");
    expect(normalizeDslText(src).text).toBe(["```photos", "materials/사진2_판매전(2025.10.25.).jpg | 판매전(2025. 10. 25.)", "```", "ㅇ 2025. 10. 25. 개최"].join("\n"));
  });
  it("표의 연도 열(설립연도 등)은 자릿점을 뺀다 — 금액 열의 같은 숫자는 그대로", () => {
    const src = [
      "{table role=generic}",
      "| 연번 | 기업명 | 설립연도 | 지원금액 |",
      "|---|---|---|---|",
      "| 1 | ㈜영도벨벳 | 1,982 | 2,025 |",
      "| 2 | ㈜삼진 | 1993 | 10,000,000 |",
    ].join("\n");
    const { text, changes } = normalizeDslText(src);
    expect(text.split("\n")[3]).toBe("| 1 | ㈜영도벨벳 | 1982 | 2,025 |");
    expect(text.split("\n")[4]).toBe("| 2 | ㈜삼진 | 1993 | 10,000,000 |");
    expect(changes).toContainEqual({ rule: "연도 자릿점 빼기", count: 1 });
  });
  it("나란한 머리말이 모두 같은 글자 수면 띄어쓰기를 뺀다 — 글자 수가 다르면 그대로 (담당자 2026-10-21)", () => {
    const same = ["ㅇ (추진실적) 4개사 신규지정", "- (서 류 심 사) 3개사 제외", "- (현 장 실 사) 3개사 지정 포기", "- (심의의결) 4개사 지정"].join("\n");
    const r = normalizeDslText(same);
    expect(r.text).toBe(["ㅇ (추진실적) 4개사 신규지정", "- (서류심사) 3개사 제외", "- (현장실사) 3개사 지정 포기", "- (심의의결) 4개사 지정"].join("\n"));
    expect(r.changes).toContainEqual({ rule: "같은 글자 수 머리말 붙여 쓰기", count: 2 });
    const mixed = ["- (판 로 확 대) 온라인몰 입점", "- (시장 활성화) 판매전 개최"].join("\n");
    expect(normalizeDslText(mixed).text).toBe(mixed);
    // 마케팅 절: 네 글자 둘 — 맞출 상대가 없는 띄어쓰기
    expect(normalizeDslText(["- (사 업 포 기) 아화제면 사업 포기", "- (후 보 기 업) 영주대장간 미희망"].join("\n")).text).toBe(["- (사업포기) 아화제면 사업 포기", "- (후보기업) 영주대장간 미희망"].join("\n"));
    // `-` 줄 하나도 붙인다, `ㅇ` 줄 하나는 절 안 다른 ㅇ 머리말과 폭을 맞춘 것이라 그대로
    expect(normalizeDslText("- (계 획 변 경) 항목 간 조정 승인").text).toBe("- (계획변경) 항목 간 조정 승인");
    expect(normalizeDslText("ㅇ (계    획) 4개사 지원").text).toBe("ㅇ (계    획) 4개사 지원");
    // 낱말 사이 공백은 폭 맞춤이 아니다
    expect(normalizeDslText("- (지원금 상향) 예산 재배분으로 상향").text).toBe("- (지원금 상향) 예산 재배분으로 상향");
  });

  it("머리칸이 연도가 아닌 열이나 본문 줄의 1,982는 건드리지 않는다", () => {
    const src = ["| 구분 | 인원 |", "|---|---|", "| 참가 | 1,982 |", "ㅇ 1,982명 참가"].join("\n");
    expect(normalizeDslText(src).text).toBe(src);
  });
});
