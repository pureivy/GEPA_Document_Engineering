/**
 * Hand-made DocModel fixtures for the editor round-trip tests. Together they cover every
 * block kind, every inline kind and every optional field the ProseMirror mapping touches.
 */
import type { Block, DocModel, Inline } from "@/lib/docmodel/schema";

const t = (text: string, extra: Partial<Extract<Inline, { t: "text" }>> = {}): Inline => ({ t: "text", text, ...extra });
const br: Inline = { t: "br" };

let seq = 0;
const id = () => `b${String(++seq).padStart(3, "0")}`;
export function resetIds(): void {
  seq = 0;
}

export function noticeFixture(): DocModel {
  resetIds();
  const blocks: Block[] = [
    { id: id(), k: "noticeHeader" },
    {
      id: id(),
      k: "infoBox",
      groups: [
        { heading: "접수방법", items: [[t("이메일 접수: "), t("gepa_north@naver.com", { font: "body", size: 13 })], [t("우편(등기): 경상북도 안동시 북순환로 387, 2층 경상북도경제진흥원")]] },
        { heading: "문의", items: [[t("사업 및 신청서 작성 문의:"), br, t("북부지소 ☎ 054-900-3801")]] },
        { heading: "선정결과 통보", items: [[t("기업별 개별통보(필요시 접수 홈페이지 공고)")]] },
      ],
    },
    { id: id(), k: "pageBreak" },
    { id: id(), k: "image", asset: "logo", widthMm: 92.3, heightMm: 13.3, align: "left" },
    { id: id(), k: "sectionBar", number: 1, title: "모집개요" },
    {
      id: id(),
      k: "overviewTable",
      rows: [
        { label: "사업명", value: [t("2026년 안동시 수출기업 역량강화 지원사업(수출매뉴얼 지원)")] },
        { label: "대상자별지원금액", value: [t("기업별 최대 "), t("3백만원", { bold: true, color: "#ff0000" })], bullet: false },
        "spacer",
        { label: "신청서접수일자", value: [t("2026. 07. 01.(수)")], bullet: true },
      ],
    },
    { id: id(), k: "sectionBar", number: 2, title: "지원절차", variant: "short" },
    {
      id: id(),
      k: "procedureFlow",
      stages: [
        { name: "모집공고", when: "’26. 07. 01." },
        { name: "신청·접수", when: "’26. 07. 01. ~ 07. 15." },
        { name: "평가(서면)", when: "8월 중순" },
      ],
    },
    { id: id(), k: "para", role: "note", glyph: "※", inlines: [t("상기 일정은 추진 상황에 따라 변경될 수 있음")] },
    { id: id(), k: "sectionBar", number: 3, title: "사업목적" },
    { id: id(), k: "para", role: "body1", glyph: "□", inlines: [t("(사업기간)", { bold: true }), t(" 선정일로부터 ~ "), t("10. 31.", { color: "#0000ff" }), t("까지")] },
    { id: id(), k: "blank" },
    { id: id(), k: "para", role: "body2", glyph: "ㅇ", inlines: [t("접수방법: "), { t: "link", text: "gepa_north@naver.com", href: "mailto:gepa_north@naver.com" }, t(" 또는 "), { t: "link", text: "홈페이지", href: "https://www.gepa.kr" }] },
    { id: id(), k: "para", role: "body3", glyph: "-", inlines: [t("신청서류를 하나의 문서로 스캔(pdf파일)하여 제출"), br, t("이어지는 줄")], indent: 5 },
    { id: id(), k: "para", role: "body4", glyph: "·", inlines: [t("세부 항목")], align: "left" },
    { id: id(), k: "blank", role: "blankSmall" },
    { id: id(), k: "para", role: "unitCaption", inlines: [t("(단위: 천원)")], align: "right" },
    {
      id: id(),
      k: "table",
      role: "docs",
      caption: "(단위: 천원)",
      widthsPt: [30, 213.7, 55.3, 185.7],
      headerRows: 1,
      style: { headerFill: "#dfe6f7", border: "grid012", padding: "tight", fontPt: 11, headerFontPt: 11 },
      rows: [
        {
          isHeader: true,
          heightPt: 20,
          cells: [
            { inlines: [t("No")], bold: true, align: "center", fill: "#dfe6f7" },
            { inlines: [t("제 출 서 류")], bold: true, align: "distribute" },
            { inlines: [t("제출부수")], bold: true, align: "center", valign: "middle" },
            { inlines: [t("비 고 사 항")], bold: true, align: "center", borders: { t: { type: "solid", widthMm: 0.5, color: "#000000" }, r: { type: "none", widthMm: 0.12, color: "#000000" } } },
          ],
        },
        {
          cells: [
            { inlines: [t("1")], align: "center" },
            { inlines: [t("참여신청서")] },
            { inlines: [t("1부")], align: "center" },
            { inlines: [t("[서식집] 양식 사용")], rowSpan: 2, valign: "middle" },
          ],
        },
        {
          cells: [{ inlines: [t("2")], align: "center" }, { inlines: [t("사업계획서"), br, t("(별지 제1호 서식)")] }, { inlines: [t("1부")], align: "center" }, { inlines: [], covered: true }],
        },
        {
          isTotal: true,
          cells: [
            { inlines: [t("합 계")], colSpan: 2, align: "center", bold: true, fill: "#d9d9d9" },
            { inlines: [], covered: true },
            { inlines: [t("3부")], align: "center" },
            { inlines: [], bold: false },
          ],
        },
      ],
    },
    { id: id(), k: "para", role: "footnote", glyph: "*", inlines: [t("건축물관리대장: 공장건축면적이 500㎡ 이하인 경우 제출")] },
    { id: id(), k: "para", role: "attachmentHeading", inlines: [t("[별첨1] 정량평가 기준")], pageBreakBefore: true },
    { id: id(), k: "para", role: "plain", inlines: [t("평가 기준은 아래와 같음.  끝.")], pageBreakBefore: false },
  ];
  return {
    version: 1,
    family: "notice",
    meta: {
      공고번호: "2026070000",
      사업명: "2026년 안동시 수출기업 역량강화 지원사업",
      부제: "수출매뉴얼 지원",
      주관기관: "안동시",
      지역: "안동시",
      대상기업군: "수출유망 중소기업",
      공고연월: "2026. 07.",
      접수: { 이메일: "gepa_north@naver.com", 우편주소: "경상북도 안동시 북순환로 387, 2층 경상북도경제진흥원", 부서명: "북부지소", 전화: "054-900-3801" },
      모집개요: [{ 라벨: "사업명", 값: "2026년 안동시 수출기업 역량강화 지원사업" }, "spacer", { 라벨: "신청서접수일자", 값: "2026. 07. 01.(수)", 불릿: false }],
      절차도: [{ 단계: "모집공고", 일정: "’26. 07. 01." }],
    } as DocModel["meta"],
    blocks,
  } as DocModel;
}

export function planFixture(): DocModel {
  resetIds();
  const blocks: Block[] = [
    { id: id(), k: "approvalBlock" },
    { id: id(), k: "coverTitle", inlines: [t("2026년 안동시 수출기업 역량강화 지원사업"), br, t("사업계획(안)", { size: 24 })], sizePt: 28 },
    { id: id(), k: "sectionChip", label: "", title: "사업개요" },
    { id: id(), k: "para", role: "coverSummary", inlines: [t("안동시 소재 수출 중소기업 20개사에 수출매뉴얼·수출직불금 지원")] },
    { id: id(), k: "chapterBand", numeral: "Ⅰ", title: "추진배경 및 목적" },
    { id: id(), k: "summaryBox", glyph: "❖", lines: [[t("안동시 수출 중소기업의 "), t("해외시장 진출 역량", { bold: true }), t("을 강화")], [t("수출용 홍보물·제품생산·마케팅·디자인 분야 맞춤형 지원")]] },
    { id: id(), k: "summaryBox", lines: [] },
    { id: id(), k: "sectionChip", label: "1", title: "사업개요" },
    { id: id(), k: "para", role: "body1", glyph: "□", inlines: [t("(사업기간) 2026. 7. ~ 12.")] },
    { id: id(), k: "para", role: "body2", glyph: "ㅇ", inlines: [t("(수혜대상) 안동시 소재 제조 중소기업 20개사")] },
    { id: id(), k: "para", role: "body3", glyph: "-", inlines: [t("가족친화인증기업, 여성기업 우대")] },
    { id: id(), k: "para", role: "note", glyph: "※", inlines: [t("예산 상황에 따라 변경 가능")] },
    { id: id(), k: "para", role: "tocLine", inlines: [t("Ⅰ. 추진배경 및 목적 ·············· 1")] },
    { id: id(), k: "para", role: "unitCaption", inlines: [t("(단위: 천원)")], align: "right" },
    {
      id: id(),
      k: "table",
      role: "budget",
      widthsPt: [131.6, 66, 251.4, 33],
      headerRows: 1,
      style: { headerFill: "#d9d9d9", totalFill: "#f2f2f2", border: "grey012", borderColor: "#808080", lineSpacing: 130 },
      rows: [
        { isHeader: true, cells: [{ inlines: [t("구분")] }, { inlines: [t("금액")] }, { inlines: [t("산출내역")] }, { inlines: [t("비고")] }] },
        { cells: [{ inlines: [t("수출매뉴얼")] }, { inlines: [t("60,000")], align: "right" }, { inlines: [t("3,000천원 × 20개사")] }, { inlines: [] }] },
        { isTotal: true, cells: [{ inlines: [t("계")] }, { inlines: [t("60,000")], align: "right" }, { inlines: [] }, { inlines: [] }] },
      ],
    },
    { id: id(), k: "para", role: "annexHeading", inlines: [t("[붙임] 세부 산출내역")], pageBreakBefore: true },
    { id: id(), k: "para", role: "plain", inlines: [t("끝.")] },
  ];
  return {
    version: 1,
    family: "plan",
    meta: {
      제목: "2026년 안동시 수출기업 역량강화 지원사업 사업계획(안)",
      연도: "2026",
      부서: "북부지소",
      결재: { 담당: "김OO", 팀장: "이OO", 실장: "박OO", 본부장: "최OO", 원장: "정OO", 공개구분: "공개" },
      요약: { 사업개요: "안동시 소재 수출 중소기업 20개사 지원", 추진일정: "’26. 7. 공고 → 8. 선정", 기대효과: "수출액 10% 증가" },
      numbering: "roman",
      lineSpacing: 160,
      body1Font: "humanMyeongjoBold",
    } as DocModel["meta"],
    blocks,
  } as DocModel;
}

export function pressFixture(): DocModel {
  resetIds();
  const blocks: Block[] = [
    { id: id(), k: "pressHeader" },
    { id: id(), k: "para", role: "pressTitle", inlines: [t("경북경제진흥원, 안동시 수출기업 역량강화 지원사업 참여기업 모집")] },
    { id: id(), k: "para", role: "pressSubtitle", inlines: [t("7월 15일까지 접수… 기업당 최대 300만원 수출매뉴얼 지원")] },
    { id: id(), k: "para", role: "pressLead", inlines: [t("(재)경상북도경제진흥원(원장 ○○○)은 안동시와 함께 참여기업을 7월 1일부터 15일까지 모집한다고 밝혔다.")] },
    { id: id(), k: "para", role: "pressBody", inlines: [t("이번 사업은 수출용 홍보물 제작 등 4개 분야 11개 사업을 지원한다.")] },
    { id: id(), k: "para", role: "body1", glyph: "□", inlines: [t("지원내용")] },
    { id: id(), k: "para", role: "body2", glyph: "ㅇ", inlines: [t("카탈로그·브로슈어, 홍보영상 제작")] },
    { id: id(), k: "para", role: "pressBody", inlines: [t("○○○ 원장은 "), t("“지역 기업의 수출 경쟁력을 높이겠다”", { bold: true }), t("라고 말했다.")] },
    { id: id(), k: "para", role: "pressContact", inlines: [t("문의: 북부지소 054-900-3801")] },
    { id: id(), k: "attachmentList", items: ["사업 공고문 1부", "사업 안내 리플릿 1부", "끝."] },
  ];
  return {
    version: 1,
    family: "press",
    meta: {
      배포일: "2026. 7. 1.(수)",
      담당부서: "북부지소",
      담당자: "김OO 팀장",
      연락처: "054-900-3801",
      이메일: "gepa_north@naver.com",
      제목: "경북경제진흥원, 안동시 수출기업 역량강화 지원사업 참여기업 모집",
      부제: "7월 15일까지 접수",
      붙임: ["사업 공고문 1부"],
    } as DocModel["meta"],
    blocks,
  } as DocModel;
}

export function officialFixture(): DocModel {
  resetIds();
  const blocks: Block[] = [
    { id: id(), k: "officialHeader" },
    { id: id(), k: "para", role: "plain", inlines: [t("경영평가 상시대응체계 구축을 위해 다음과 같이 자료를 제출하여 주시기 바랍니다.")] },
    { id: id(), k: "para", role: "plain", inlines: [t("1. 작성대상: 2026년 각 팀에서 운영하고 있는 전체 사업")] },
    { id: id(), k: "officialFooter" },
  ];
  return {
    version: 1,
    family: "official",
    meta: {
      수신유형: "수신자참조",
      수신자: ["경영지원팀장", "마케팅팀장"],
      제목: "경영평가 대응을 위한 2026년 사업 추진 현황 제출 요청",
      발신명의: "경영기획실장",
      처리과: "전략기획팀",
      연락처: { 전화: "054-470-8527", 이메일: "nancy.kwon@gepa.kr" },
      붙임: ["(양식) 2026년 사업 추진 현황_팀명 1부."],
    } as DocModel["meta"],
    blocks,
  } as DocModel;
}

/** every block kind in one document (plan meta) — the coverage fixture */
export function kitchenSinkFixture(): DocModel {
  const plan = planFixture();
  const notice = noticeFixture();
  const press = pressFixture();
  const official = officialFixture();
  const blocks = [...plan.blocks, ...notice.blocks, ...press.blocks, ...official.blocks].map((b, i) => ({ ...b, id: `k${String(i + 1).padStart(3, "0")}` }));
  return { ...plan, blocks } as DocModel;
}
