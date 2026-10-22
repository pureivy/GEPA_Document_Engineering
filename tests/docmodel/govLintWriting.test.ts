import { describe, it, expect } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { lintGovStyle } from "../../lib/docmodel/govLint";

const FM = `---\nfamily: plan\n제목: 테스트 결과보고\n---\n`;
const rules = (dsl: string, fm = FM) => lintGovStyle(parseDsl(fm + dsl).doc).map((i) => i.rule);

describe("lintGovStyle — 공문서 기본 틀(담당자 2026-10-19)", () => {
  it("개수만 적은 사업내용, 번호와 머리말이 섞인 줄을 잡는다", () => {
    const r = rules(["□ 사업개요", "ㅇ (사업내용) 3개 세부사업", "- (판 로 확 대) ① 판로지원금", "- (역 량 강 화) ② 온라인 판매 지원  끝."].join("\n"));
    expect(r).toContain("개수만 적은 내용");
    expect(r.filter((x) => x === "번호·머리말 섞임")).toHaveLength(2);
  });

  it("머리말 줄 안의 다른 괄호는 잡고, 요일·금액 한글·영문 병기는 넘긴다", () => {
    const bad = rules(["□ 개요", "ㅇ (선정방법) 고득점 순 선정(동점 시 영업기간 우선)", "ㅇ (지급방법) 협약 후 지급  끝."].join("\n"));
    expect(bad).toContain("머리말 줄 괄호");
    const ok = rules(["□ 개요", "ㅇ (추진실적) 2025. 10. 25.(토) 판매전 개최, 사업화(R&D) 지원", "ㅇ (사 업 비) 금80,000,000원(금팔천만원)  끝."].join("\n"));
    expect(ok).not.toContain("머리말 줄 괄호");
  });

  it("말하듯 쓴 줄을 잡는다", () => {
    expect(rules(["□ 결과", "ㅇ (추진실적) 6개 점포 지원", "ㅇ 계획한 6개 점포 모두 지원  끝."].join("\n"))).toContain("말투");
    expect(rules(["□ 결과", "ㅇ (추진실적) 6개 점포 지원", "ㅇ 판매전을 개최했다  끝."].join("\n"))).toContain("말투");
  });

  it("나란한 항목 가운데 한 줄만 넘치면 잡고, 머리말 폭이 다르면 알린다", () => {
    const r = rules(
      [
        "□ 개요",
        "ㅇ (사업내용) 판로 확대·역량 강화로 시장 활성화",
        "- (판로확대) 온라인몰 입점 지원",
        "- (역 량 강 화) 라이브커머스·상세페이지 제작과 상품 촬영 등 전문기관 용역을 통한 온라인 판매 지원",
        "- (시장 활성화) 청년상인 판매전 개최  끝.",
      ].join("\n"),
    );
    expect(r).toContain("나란한 항목 한 줄");
    expect(r).toContain("머리말 폭");
    const ok = rules(["□ 개요", "ㅇ (사업내용) 판로 확대·역량 강화로 시장 활성화", "- (판 로 확 대) 온라인몰 입점·포장재 개선 지원", "- (역 량 강 화) 라이브커머스·상세페이지 제작 지원", "- (시장 활성화) 청년상인 판매전 개최·홍보  끝."].join("\n"));
    expect(ok).not.toContain("나란한 항목 한 줄");
    expect(ok).not.toContain("머리말 폭");
  });

  it("장황한 항목과 결과보고서의 예산 변경 세부를 잡는다(담당자 2026-10-21)", () => {
    const long = "- (계획 대비) 지정 공고 시 선정 규모를 1~2개사 정도로 잡았으나 4개사가 요건심사와 육성위원회 심의를 통과하여 지정 규모가 늘었고, 인증패·현판 제작비가 늘어 예산 변경 승인을 받아 4,500천원에서 6,480천원으로 증액";
    const r = rules(["□ 추진실적", "ㅇ (추진실적) 4개사 지정", long, "- (지 정 식) 2025. 11. 26.(수) 인증패 수여  끝."].join("\n"));
    expect(r).toContain("장황한 항목");
    expect(r).toContain("예산 변경 세부");
    const ok = rules(["□ 추진실적", "ㅇ (추진실적) 4개사 지정", "- (계획 대비) 당초 계획(1~2개사) 대비 규모 확대, 우수 기업 4개사 지정", "- (지 정 식) 2025. 11. 26.(수) 인증패 수여  끝."].join("\n"));
    expect(ok).not.toContain("장황한 항목");
    expect(ok).not.toContain("예산 변경 세부");
    // 사업계획서(변경 계획)는 세목 변경을 쓰는 문서다 — 결과보고서에만 적용
    const plan = `---\nfamily: plan\n제목: 2026년 시험 사업 변경 계획(안)\n---\n`;
    expect(rules(["□ 예산", "ㅇ (변경) 운영비 4,500천원에서 6,480천원으로 증액  끝."].join("\n"), plan)).not.toContain("예산 변경 세부");
  });

  it("보도자료 본문에는 적용하지 않는다", () => {
    const press = `---\nfamily: press\n기관: (재)경상북도경제진흥원\n배포일: 2026. 10. 19.\n담당부서: 일자리경제팀\n담당자: 홍길동\n연락처: 054-470-8500\n제목: 시험\n---\n`;
    expect(rules("- 진흥원은 판매전을 개최했다.", press)).not.toContain("말투");
  });
});
