/**
 * Verbatim fixed text of the GEPA 공고문 (source of truth: docs/design-system/notice.md §8,
 * the 6-1 skeleton). These strings are inserted by the DSL parser when it expands
 * `{{boilerplate:NAME …}}` macros, so the writer model can never paraphrase them.
 *
 * The `기업게좌` typo in 지급방법 is intentional and must be preserved.
 *
 * Each macro returns DSL lines (with glyphs); the parser feeds them through the normal
 * grammar, so inline marks such as `[www.gepa.kr](http://www.gepa.kr)` become links.
 */

/** 이의제기 sentence: appears inside the 안내박스 (문의 group) and as the `이의제기` macro. */
export const NOTICE_이의제기 = "본 공고와 관련하여 이의사항이 있는 경우에는 사업부서 및 진흥원 홈페이지(고객의소리, 국민신문고)를 통하여 의견을 제시할 수 있음";

export const NOTICE_일정변경 = "상기 일정은 추진 상황에 따라 변경될 수 있음";
export const NOTICE_예산상황 = "예산상황에 따라 선정기업은 변동될 수 있음";
export const NOTICE_기업부담금 = "최대 지원한도에 따라 기업부담금 증가할 수 있음";

/** 안내박스 group headings and item templates (6-1 §8). `{{…}}` placeholders are filled from meta.접수. */
export const NOTICE_안내박스 = {
  접수방법: { heading: "접수방법", 이메일: "이메일 접수: {{이메일}}", 우편: "우편(등기): {{우편주소}}" },
  문의: { heading: "문의", 작성문의: "사업 및 신청서 작성 문의: ", 작성문의_2행: "{{부서명}} ☎ {{전화}} (E-mail) {{이메일}}", 이의제기: NOTICE_이의제기 },
  선정결과통보: { heading: "선정결과 통보" },
} as const;

export const NOTICE_참여제한대상: readonly string[] = [
  "□ **(참여제한대상)**",
  "◦ 한국표준산업분류 대분류 N. 사업시설 관리, 사업지원 및 임대서비스업, 생산도급(단순노무 도급, 생산기반시설 없는 경우) 기업, 근로자 파견 및 공급업체",
  "◦ 휴업 중인 기업",
  "◦ 금융기관과 정상적인 거래를 할 수 없는 기업",
  "◦ 신청일 기준 현재 국세 및 지방세 체납기업",
  "◦ 사회적 물의를 일으킨 기업(임금체불, 불법행위 등)",
  "◦ 기타 본 사업에 적정하지 않다고 판단되는 경우",
  "◦ 기타 유사사업 참여기업 일부 제한",
];

/** `□ 지원금 지급 방법` heading + the three fixed ㅇ items (incl. the 기업게좌 typo). */
export const NOTICE_지급방법: readonly string[] = [
  "□ **지원금 지급 방법**",
  "ㅇ 선정기업 개별 비용 선 결제 후 제출한 결과보고서와 청구서를 검토하여 증빙서류 확인 후 인정금액 기업게좌로 직접 송금",
  "ㅇ 위 지원항목 중 타 기관 사업을 통해 수혜받은 동일한 항목 신청 불가",
  "ㅇ 간이영수증, 현금지급은 인정하지 않음",
];

/** Section 9 기타 유의사항: the entire block is fixed. `{{주관기관}}` is the only variable. */
export const NOTICE_기타유의사항: readonly string[] = [
  "ㅇ 참여 기업은 자격요건 등이 적합한지를 정확히 확인한 후 신청",
  "ㅇ 제출된 서류는 반환하지 않으며, 제출된 서류에 기재된 내용이 사실과 다를 경우 선정이 취소될 수 있음",
  "ㅇ 최종 선정 공지 이후라도 자격조건 검증 과정 등을 통하여 결격사유가 확인될 경우 선정이 취소될 수 있음",
  "ㅇ 사업 선정(심사)위원회 구성, 선정결과(점수 포함), 합격 또는 탈락 사유 등 심사와 관련한 일체의 정보는 비공개를 원칙으로 함",
  "ㅇ 상기 유의사항 또는 공고 내용의 미숙지에 따른 책임은 신청인에게 있으며, 이에 대한 해석이 상이할 경우는 {{주관기관}} 또는 경상북도경제진흥원의 해석에 따름",
  "ㅇ 본 공고문은 사정에 의하여 변경될 수 있으며, 변경된 사항은 (재)경상북도경제진흥원 홈페이지([www.gepa.kr](http://www.gepa.kr))에 공고 예정",
];

/**
 * 기관·시군 공모 variants (`{{boilerplate:NAME 대상=기관}}`). The 6-1 reference is a 참여기업
 * 모집 공고, so its fixed text speaks of 기업·기업계좌·기업부담금; when the applicants are
 * municipalities or institutions (시군 공모, 기관 공모) those sentences are factually wrong.
 * There is no reference document for this case, so — like PLAN_정산문구 — the wording below
 * is the agreed canonical text (2026-09-16), kept in the same register and structure.
 */
export const NOTICE_참여제한대상_기관: readonly string[] = [
  "□ **(참여제한대상)**",
  "◦ 공고일 기준 동일·유사 사업으로 경상북도 또는 진흥원의 지원을 받고 있는 기관(중복 지원 불가)",
  "◦ 최근 3년 이내 보조금 부정 수급·목적 외 사용 등으로 보조금 환수 또는 사업 참여 제한 조치를 받은 기관",
  "◦ 지방비 부담분 확보 계획을 제출하지 않은 기관",
  "◦ 기타 본 사업에 적정하지 않다고 판단되는 경우",
];

export const NOTICE_예산상황_기관 = "예산상황에 따라 선정 기관 수 및 기관별 지원 규모는 변동될 수 있음";
export const NOTICE_기업부담금_기관 = "최대 지원한도에 따라 선정 기관의 지방비 부담이 증가할 수 있음";

/** `□ 사업비 교부 및 정산` heading + three fixed ㅇ items for grants paid to an institution. */
export const NOTICE_지급방법_기관: readonly string[] = [
  "□ **사업비 교부 및 정산**",
  "ㅇ 선정 기관과 사업 협약 체결 후 사업비(도비)를 교부하며, 지방비 부담분은 선정 기관이 확보하여 편성",
  "ㅇ 사업비는 「경상북도 지방보조금 관리 조례」 및 관련 규정에 따라 집행·정산하고, 집행잔액과 목적 외 사용액은 반납",
  "ㅇ 동일한 사업내용으로 타 기관·타 사업의 지원을 받은 항목은 중복 지원 불가",
];

/** Section 9 for institutions: 기업 → 기관, 신청인 → 신청 기관; the rest is identical. */
export const NOTICE_기타유의사항_기관: readonly string[] = NOTICE_기타유의사항.map((l) =>
  l.replace("참여 기업은", "신청 기관은").replace("책임은 신청인에게 있으며", "책임은 신청 기관에 있으며"),
);

export type MacroArgs = Record<string, string>;

/** `대상=기관` selects the institutional variant; anything else (or no arg) is the 기업 text. */
function forInstitution(args: MacroArgs): boolean {
  return args.대상 === "기관";
}

function fill(template: string, args: MacroArgs): string {
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m, key: string) => (args[key] !== undefined ? args[key] : `{{${key}}}`));
}

export const NOTICE_MACROS: Record<string, (args: MacroArgs) => string[]> = {
  참여제한대상: (args) => [...(forInstitution(args) ? NOTICE_참여제한대상_기관 : NOTICE_참여제한대상)],
  일정변경: () => [`※ ${NOTICE_일정변경}`],
  예산상황: (args) => [`※ ${forInstitution(args) ? NOTICE_예산상황_기관 : NOTICE_예산상황}`],
  기업부담금: (args) => [`※ ${forInstitution(args) ? NOTICE_기업부담금_기관 : NOTICE_기업부담금}`],
  // `이메일` is accepted for compatibility with the grammar but the fixed text does not use it.
  지급방법: (args) => [...(forInstitution(args) ? NOTICE_지급방법_기관 : NOTICE_지급방법)],
  기타유의사항: (args) => (forInstitution(args) ? NOTICE_기타유의사항_기관 : NOTICE_기타유의사항).map((l) => fill(l, { 주관기관: args.주관기관 ?? "주관기관" })),
  이의제기: () => [`○ ${NOTICE_이의제기}`],
};

export function expandNoticeBoilerplate(name: string, args: MacroArgs = {}): string[] | undefined {
  const fn = NOTICE_MACROS[name];
  return fn ? fn(args) : undefined;
}
