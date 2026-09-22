/**
 * (재)경상북도경제진흥원 조직 사실 — user-stated on 2026-09-16, 2026-09-22 정정
 * (경영기획실 팀명은 경영지원팀 / 일자리민생경제지원실·지역산업지원단도 강소기업육성본부 산하).
 * Used to pick the 결재라인 of a 사업계획서 and the 담당부서 정식 명칭 / 책임자 of a 보도자료
 * from whatever the project form calls the department (a team name, a 실/단 name or an abbreviation).
 */

export interface OrgUnit {
  /** 실·단 정식 명칭 (문서에 쓰는 이름) */
  name: string;
  /** 소속 본부 (없으면 원장 직속) */
  division?: string;
  /** 팀·지소 */
  teams: string[];
  /** 결재란 직위, 왼쪽부터 (4개 또는 5개) */
  approvalLine: string[];
  /** 책임자 "직위 이름" (보도자료 머리표 작성자 첫 줄) */
  head?: string;
  /** 다른 표기 (약칭·옛 이름) */
  aliases?: string[];
}

export const ORG_DIRECTOR = "박성수";

/** 기관장 직위 — 원장 전결 공문의 발신명의이자 공고문 meta 의 `기관장` 기본값(한 곳에만 둔다). */
export const INSTITUTION_HEAD_TITLE = "(재)경상북도경제진흥원장";

/**
 * 전결(專決) 단계 — 위임전결 규정에 따라 결재가 끝나는 직위. 결재란과 발신명의를 **함께** 정한다
 * (user 2026-09-22: 실·단장 전결이면 실·단장 명의, 본부장 전결이면 본부장 명의, 원장 전결이면 기관장 명의).
 * OfficialMetaSchema.전결 이 이 배열에서 enum 을 만든다 — 값은 여기 한 곳에만 적는다.
 */
export const DELEGATION_LEVELS = ["실·단장", "본부장", "원장"] as const;
export type DelegationLevel = (typeof DELEGATION_LEVELS)[number];
/**
 * 기본값이 원장인 이유(user 2026-09-22): 기관 밖으로 나가는 공문은 기관장 명의로 나가므로 안전한
 * 쪽은 **결재라인 전체**다. 전결은 그 사슬을 **낮추는** 선택이지 기본 상태가 아니다 — 기본을
 * 실·단장으로 두면 그렇게 하자고 하지 않은 문서의 결재 사슬이 조용히 짧아진다.
 */
export const DEFAULT_DELEGATION: DelegationLevel = "원장";

/**
 * 전결 단계가 결재라인에서 찾는 직위. 실·단장이 둘인 이유는 조직표가 실(→ 실장)과 단(→ 단장)을
 * 모두 담고 있어서다(지역산업지원단의 결재라인은 담당·지소장·단장·본부장·원장).
 */
const LEVEL_TITLES: Record<DelegationLevel, string[]> = { "실·단장": ["실장", "단장"], 본부장: ["본부장"], 원장: ["원장"] };

export const ORG_UNITS: OrgUnit[] = [
  // "경영관리팀"은 2026-09-22 정정 전까지 쓰던 이름(→ 경영지원팀) — alias 로 남겨 그 이전에 만든
  // 사업계획서(부서: 경영관리팀)의 결재란이 기관 기본값으로 조용히 바뀌지 않게 한다.
  { name: "경영기획실", teams: ["경영지원팀", "전략기획팀"], approvalLine: ["담당", "팀장", "실장", "원장"], head: "실장 남상범", aliases: ["경영전략실", "경영관리팀"] },
  { name: "강소기업지원실", division: "강소기업육성본부", teams: ["ESG·기업지원팀", "마케팅팀"], approvalLine: ["담당", "팀장", "실장", "본부장", "원장"], head: "실장 이명하" },
  { name: "일자리민생경제지원실", division: "강소기업육성본부", teams: ["일자리종합지원팀", "민생경제지원팀"], approvalLine: ["담당", "팀장", "실장", "본부장", "원장"], head: "실장 이유선", aliases: ["일자리민생"] },
  // 지소는 팀이 아니고 단의 장은 실장이 아니라 단장이다 — 결재라인의 지소장·단장은 그대로 둔다(user 2026-09-22)
  { name: "지역산업지원단", division: "강소기업육성본부", teams: ["동부지소", "북부지소"], approvalLine: ["담당", "지소장", "단장", "본부장", "원장"], head: "단장 남상조" },
];

export const DIVISION_HEADS: Record<string, string> = { 강소기업육성본부: "본부장 송호준" };

/**
 * 부서 이름 대조용 정규화. 공백과 **가운뎃점**을 지운다 — 기관 문서는 `ESG·기업지원팀` 으로
 * 쓰지만 사람은 `ESG기업지원팀` 으로도 친다. 가운뎃점을 남기면 어느 쪽도 상대의 접두사가
 * 되지 못해 findUnit 이 조용히 null 을 돌려주고 기관 기본 결재라인으로 떨어진다.
 * findUnit 의 부서 조회에만 쓰인다 — 본문 글자에는 닿지 않는다.
 */
const norm = (s: string) => s.replace(/[\s·・ㆍ]/g, "").toLowerCase();

/** The 실/단 a department string belongs to (team name, unit name, alias or abbreviation), or null. */
export function findUnit(department: string | undefined | null): OrgUnit | null {
  if (!department) return null;
  const d = norm(department);
  for (const u of ORG_UNITS) {
    const names = [u.name, ...(u.aliases ?? []), ...u.teams].map(norm);
    if (names.some((n) => d === n || d.startsWith(n) || n.startsWith(d))) return u;
  }
  return null;
}

/** 결재란 직위 목록; unknown departments get the institution default. */
export const DEFAULT_APPROVAL_LINE = ["담당", "팀장", "실장", "본부장", "원장"];
export function approvalLineFor(department: string | undefined | null): string[] {
  return findUnit(department)?.approvalLine ?? DEFAULT_APPROVAL_LINE;
}

/**
 * 전결 단계에서 끊은 결재란 직위 목록 — `approvalLineFor(부서)` 를 그 단계의 직위까지 남긴다
 * (마케팅팀 + 실·단장 전결 → 담당·팀장·실장). 그 부서의 결재라인에 그 단계가 없으면 undefined:
 * 본부 없는 경영기획실에는 본부장 전결이 없다 — 호출처가 대신할 값과 경고를 정한다.
 */
export function approvalLineUpTo(department: string | undefined | null, level: DelegationLevel): string[] | undefined {
  const line = approvalLineFor(department);
  const i = line.findIndex((title) => LEVEL_TITLES[level].includes(title));
  return i < 0 ? undefined : line.slice(0, i + 1);
}

/**
 * 결재가 끝나는 직위로 정해지는 발신명의 — 원장은 기관장 직위, 본부장은 처리과가 속한 본부의 장,
 * 실장·단장은 처리과가 속한 실·단의 장(이름이 실/단으로 끝나므로 `장`만 붙이면 된다).
 * 그 밖의 직위(내부결재에서 나오는 팀장·지소장)나 모르는 부서면 undefined — 호출처가 정한다.
 */
export function senderTitleFor(lastTitle: string | undefined, department: string | undefined | null): string | undefined {
  if (lastTitle === "원장") return INSTITUTION_HEAD_TITLE;
  const unit = findUnit(department);
  if (!unit) return undefined;
  if (lastTitle === "본부장") return unit.division ? `${unit.division}장` : undefined;
  if (lastTitle === "실장" || lastTitle === "단장") return `${unit.name}장`;
  return undefined;
}

/** Full 실/단 name for a team or abbreviation (falls back to the input). */
export function departmentFullName(department: string | undefined | null): string {
  return findUnit(department)?.name ?? (department ?? "");
}

/** "직위 이름" of the unit head, or undefined when unknown. */
export function unitHeadFor(department: string | undefined | null): string | undefined {
  return findUnit(department)?.head;
}

/** One-paragraph summary for agent prompts. */
export function orgSummary(): string {
  const units = ORG_UNITS.map((u) => `${u.name}(${u.teams.join("·")}${u.division ? `, ${u.division} 산하` : ""}${u.head ? `, ${u.head}` : ""}; 결재 ${u.approvalLine.join("→")})`).join(" / ");
  const divisions = Object.entries(DIVISION_HEADS)
    .map(([d, h]) => `${d} ${h}`)
    .join(", ");
  return `원장 ${ORG_DIRECTOR}. 부서: ${units}. 본부: ${divisions}.`;
}
