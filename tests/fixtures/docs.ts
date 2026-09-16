import type { DocModel, Inline } from "../../lib/docmodel/schema";
export const T = (text: string): Inline[] => [{ t: "text", text }];

export function noticeFixture(): DocModel {
  const 모집개요 = [
    { 라벨: "사업명", 값: "2026년 안동시 수출기업 역량강화 지원사업" },
    { 라벨: "선정방법", 값: "서류평가 고득점 순으로 선정" },
    { 라벨: "지 원 대 상", 값: "안동시 소재 제조 및 무역업 중소기업" },
    { 라벨: "대상자별지원금액", 값: "기업별 최대 3백만원 한도", 불릿: false },
    "spacer" as const,
    { 라벨: "신청서접수일자", 값: "2026. 07. 01.(수)" },
    { 라벨: "신청서접수마감일자", 값: "2026. 07. 15.(수)" },
  ];
  return {
    version: 1,
    family: "notice",
    meta: {
      공고번호: "2026070000", 사업명: "2026년 안동시 수출기업 역량강화 지원사업", 모집대상: "참여기업", 부제: "수출매뉴얼 지원",
      주관기관: "안동시", 지역: "안동시", 대상기업군: "수출유망 중소기업", 공고연월: "2026. 07.", 기관장: "(재)경상북도경제진흥원장",
      접수: { 이메일: "gepa_north@naver.com", 우편주소: "경상북도 안동시 북순환로 387, 2층 경상북도경제진흥원", 부서명: "북부지소", 전화: "054-900-3801", 선정결과통보: "기업별 개별통보(필요시 접수 홈페이지 공고)" },
      모집개요, 절차도: [{ 단계: "모집공고", 일정: "’26. 07. 01." }, { 단계: "신청·접수", 일정: "’26. 07. 01. ~ 07. 15." }, { 단계: "평가(서면)", 일정: "8월 중순" }], 로고: true,
    },
    blocks: [
      { id: "b01", k: "noticeHeader" },
      { id: "b02", k: "infoBox", groups: [
        { heading: "접수방법", items: [T("이메일 접수: gepa_north@naver.com"), T("우편(등기): 경상북도 안동시 북순환로 387, 2층 경상북도경제진흥원")] },
        { heading: "문의", items: [T("사업 및 신청서 작성 문의: \n북부지소 ☎ 054-900-3801 (E-mail) gepa_north@naver.com"), T("본 공고와 관련하여 이의사항이 있는 경우에는 사업부서 및 진흥원 홈페이지(고객의소리, 국민신문고)를 통하여 의견을 제시할 수 있음")] },
        { heading: "선정결과 통보", items: [T("기업별 개별통보(필요시 접수 홈페이지 공고)")] },
      ] },
      { id: "b03", k: "pageBreak" },
      { id: "b04", k: "image", asset: "logo" },
      { id: "b05", k: "sectionBar", number: 1, title: "모집개요" },
      { id: "b06", k: "overviewTable", rows: 모집개요.map((r) => (r === "spacer" ? "spacer" : { label: r.라벨, value: T(r.값), bullet: r.불릿 })) },
      { id: "b07", k: "sectionBar", number: 2, title: "지원절차" },
      { id: "b08", k: "procedureFlow", stages: [{ name: "모집공고", when: "’26. 07. 01." }, { name: "신청·접수", when: "’26. 07. 01. ~ 07. 15." }, { name: "평가(서면)", when: "8월 중순" }] },
      { id: "b09", k: "para", role: "note", glyph: "※", inlines: T("상기 일정은 추진 상황에 따라 변경될 수 있음") },
      { id: "b10", k: "sectionBar", number: 3, title: "사업목적" },
      { id: "b11", k: "para", role: "body1", glyph: "□", inlines: T("수출 기반 보유 중소기업 발굴·지원을 통한 수출저변 확대 등 지역경제 활성화 도모") },
      { id: "b12", k: "blank" },
      { id: "b13", k: "para", role: "body1", glyph: "□", inlines: [{ t: "text", text: "(지원대상)", bold: true }, { t: "text", text: " 안동시 소재 사업장을 둔 중소기업" }] },
      { id: "b14", k: "para", role: "body2", glyph: "ㅇ", inlines: T("「중소기업기본법」상의 중소기업") },
      { id: "b15", k: "para", role: "body3", glyph: "-", inlines: T("가족친화인증기업, 여성기업") },
      { id: "b16", k: "para", role: "body2", glyph: "ㅇ", inlines: [{ t: "text", text: "홈페이지(" }, { t: "link", text: "www.gepa.kr", href: "http://www.gepa.kr" }, { t: "text", text: ")에 공고 예정" }] },
      { id: "b17", k: "table", role: "docs", widthsPt: [29.9, 213.9, 55.4, 185.6], rows: [
        { isHeader: true, cells: [{ inlines: T("No") }, { inlines: T("제 출 서 류") }, { inlines: T("제출부수") }, { inlines: T("비 고 사 항") }] },
        { cells: [{ inlines: T("1") }, { inlines: T("사업참여 신청서 1부") }, { inlines: T("1부") }, { inlines: T("[서식집] 양식 사용"), rowSpan: 2 }] },
        { cells: [{ inlines: T("2") }, { inlines: T("사업 수행계획서") }, { inlines: T("1부") }, { inlines: [], covered: true }] },
      ] },
      { id: "b18", k: "para", role: "footnote", glyph: "*", inlines: T("건축물관리대장: 공장등록증 대신 제출 가능") },
      { id: "b19", k: "pageBreak" },
      { id: "b20", k: "para", role: "attachmentHeading", inlines: T("[별첨1]정량평가 기준") },
      { id: "b21", k: "table", role: "evalCriteria", widthsPt: [66.3, 369, 42], rows: [
        { isHeader: true, cells: [{ inlines: T("평가항목") }, { inlines: T("평가내용") }, { inlines: T("배점") }] },
        { cells: [{ inlines: T("수출실적") }, { inlines: T("전년도 수출액\n1. 매출액 대비 수출액 비율") }, { inlines: T("30") }] },
        { isTotal: true, cells: [{ inlines: T("합 계"), colSpan: 2 }, { inlines: [], covered: true }, { inlines: T("100") }] },
      ] },
    ],
  };
}

export function planFixture(): DocModel {
  return {
    version: 1, family: "plan",
    meta: { 제목: "2026년 안동시 수출기업 역량강화 지원사업 사업계획(안)", 연도: "2026", 부서: "북부지소", 등록번호: "북부지소-939",
      결재: { 등록일자: "2026. 7. 14.", 결재일자: "2026. 7. 20.", 공개구분: "공개" }, numbering: "roman", lineSpacing: 135, body1Font: "hyHeadlineBold", house: "gepa" },
    blocks: [
      { id: "b01", k: "approvalBlock" },
      { id: "b02", k: "coverTitle", inlines: T("2026년 안동시 수출기업 역량강화 지원사업 사업계획(안)") },
      { id: "b03", k: "pageBreak" },
      { id: "b04", k: "chapterBand", numeral: "Ⅰ", title: "추진배경 및 현황" },
      { id: "b05", k: "summaryBox", glyph: "❖", lines: [T("지역 중소기업 글로벌화 지원을 통해 새로운 성장 동력 구축")] },
      { id: "b06", k: "para", role: "body1", glyph: "□", inlines: T("추진배경") },
      { id: "b07", k: "para", role: "body2", glyph: "ㅇ", inlines: T("안동시 수출 유망 중소기업을 발굴·지원하여 수출 저변 확대") },
      { id: "b08", k: "para", role: "body3", glyph: "-", inlines: T("수출 매뉴얼 4개분야 11개사업 지원") },
      { id: "b09", k: "para", role: "body4", glyph: "·", inlines: T("기업당 최대 3백만원") },
      { id: "b10", k: "para", role: "note", glyph: "※", inlines: T("총 소요금액의 80% 지원") },
      { id: "b11", k: "chapterBand", numeral: "Ⅱ", title: "사업개요" },
      { id: "b12", k: "sectionChip", label: "1", title: "수출매뉴얼 지원" },
      { id: "b13", k: "table", role: "budget", caption: "(단위: 천원)", widthsPt: [50.1, 86.9, 218.7, 61.2, 61.2], rows: [
        { isHeader: true, cells: [{ inlines: T("구 분"), colSpan: 2 }, { inlines: [], covered: true }, { inlines: T("산출 내역") }, { inlines: T("금액") }, { inlines: T("비고") }] },
        { cells: [{ inlines: T("사업비"), rowSpan: 2 }, { inlines: T("매뉴얼") }, { inlines: T("∙ 3,000천원 × 9개사") }, { inlines: T("27,000") }, { inlines: T("") }] },
        { cells: [{ inlines: [], covered: true }, { inlines: T("직불금") }, { inlines: T("∙ 3,000천원 × 9개사") }, { inlines: T("27,000") }, { inlines: T("") }] },
        { isTotal: true, cells: [{ inlines: T("합 계"), colSpan: 3 }, { inlines: [], covered: true }, { inlines: [], covered: true }, { inlines: T("54,000") }, { inlines: T("") }] },
      ] },
      { id: "b14", k: "para", role: "body2", glyph: "ㅇ", inlines: T("기대효과.  끝.") },
    ],
  };
}

export function pressFixture(): DocModel {
  return {
    version: 1, family: "press",
    meta: { 기관: "(재)경상북도경제진흥원", 배포일: "2026. 7. 1.(수)", 보도시점: "즉시", 담당부서: "북부지소", 책임자: "실장 김OO", 담당자: "김OO 팀장", 연락처: "054-900-3801", 이메일: "gepa_north@naver.com",
      제목: "경북경제진흥원, 안동시 수출기업 역량강화 지원사업 참여기업 모집", 부제: "7월 15일까지 접수… 기업당 최대 300만원 지원", 사진: false, 붙임: ["사업 공고문 1부"] },
    blocks: [
      { id: "b01", k: "pressHeader" },
      { id: "b02", k: "para", role: "pressTitle", inlines: T("경북경제진흥원, 안동시 수출기업 역량강화 지원사업 참여기업 모집") },
      { id: "b03", k: "para", role: "pressSubtitle", inlines: T("7월 15일까지 접수… 기업당 최대 300만원 지원") },
      { id: "b04", k: "blank" },
      { id: "b05", k: "para", role: "pressBody", inlines: T("(재)경상북도경제진흥원(원장 ○○○)은 안동시와 함께 2026년 안동시 수출기업 역량강화 지원사업 참여기업을 7월 1일부터 15일까지 모집한다고 밝혔다.") },
      { id: "b06", k: "blank" },
      { id: "b07", k: "para", role: "body1", glyph: "□", inlines: T("지원내용") },
      { id: "b08", k: "para", role: "body2", glyph: "ㅇ", inlines: T("수출용 홍보물 제작 등 4개 분야 11개 사업") },
      { id: "b09", k: "attachmentList", items: ["사업 공고문 1부"] },
    ],
  };
}
