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

export const ORG_UNITS: OrgUnit[] = [
  { name: "경영기획실", teams: ["경영지원팀", "전략기획팀"], approvalLine: ["담당", "팀장", "실장", "원장"], head: "실장 남상범", aliases: ["경영전략실"] },
  { name: "강소기업지원실", division: "강소기업육성본부", teams: ["ESG기업지원팀", "마케팅팀"], approvalLine: ["담당", "팀장", "실장", "본부장", "원장"], head: "실장 이명하" },
  { name: "일자리민생경제지원실", division: "강소기업육성본부", teams: ["일자리종합지원팀", "민생경제지원팀"], approvalLine: ["담당", "팀장", "실장", "본부장", "원장"], head: "실장 이유선", aliases: ["일자리민생"] },
  // 지소는 팀이 아니고 단의 장은 실장이 아니라 단장이다 — 결재라인의 지소장·단장은 그대로 둔다(user 2026-09-22)
  { name: "지역산업지원단", division: "강소기업육성본부", teams: ["동부지소", "북부지소"], approvalLine: ["담당", "지소장", "단장", "본부장", "원장"], head: "단장 남상조" },
];

export const DIVISION_HEADS: Record<string, string> = { 강소기업육성본부: "본부장 송호준" };

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

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
