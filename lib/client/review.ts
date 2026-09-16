/**
 * Review-run helpers shared by the stage screen (pure; bundled into the client).
 * The reviewer answers with `--json-schema` (see lib/agents/prompts) and the CLI's final
 * `result` event carries the parsed object in `structured`.
 */
export type ReviewSeverity = "error" | "warn" | "info";

export interface ReviewIssue {
  blockHint: string;
  severity: ReviewSeverity;
  message: string;
  fix?: string;
}

export interface ReviewResult {
  issues: ReviewIssue[];
  score: number;
  summary?: string;
}

const SEVERITIES: ReviewSeverity[] = ["error", "warn", "info"];

/** Narrow an unknown `structured` payload to a ReviewResult (tolerant: drops malformed issues). */
export function parseReviewResult(raw: unknown): ReviewResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const issuesRaw = Array.isArray(o.issues) ? o.issues : [];
  const issues: ReviewIssue[] = [];
  for (const it of issuesRaw) {
    if (!it || typeof it !== "object") continue;
    const i = it as Record<string, unknown>;
    const severity = SEVERITIES.includes(i.severity as ReviewSeverity) ? (i.severity as ReviewSeverity) : "info";
    const message = typeof i.message === "string" ? i.message : "";
    if (!message) continue;
    issues.push({ blockHint: typeof i.blockHint === "string" ? i.blockHint : "", severity, message, ...(typeof i.fix === "string" && i.fix ? { fix: i.fix } : {}) });
  }
  const score = typeof o.score === "number" && Number.isFinite(o.score) ? Math.max(0, Math.min(100, Math.round(o.score))) : 0;
  return { issues, score, ...(typeof o.summary === "string" ? { summary: o.summary } : {}) };
}

export const SEVERITY_ORDER: Record<ReviewSeverity, number> = { error: 0, warn: 1, info: 2 };

export function sortIssues(issues: ReviewIssue[]): ReviewIssue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Issues worth sending back to the writer (info-level remarks are not auto-applied). */
export function fixableIssues(issues: ReviewIssue[]): ReviewIssue[] {
  return sortIssues(issues.filter((i) => i.severity !== "info"));
}

/**
 * Compose the follow-up instruction for the writer session (`--resume` with instruction).
 * Kept plain and numbered so the model can tick through it; the DSL fix lines are quoted verbatim.
 */
export function buildFixInstruction(issues: ReviewIssue[]): string {
  const list = fixableIssues(issues);
  if (list.length === 0) return "";
  const lines = list.map((i, n) => {
    const where = i.blockHint ? ` [위치: "${i.blockHint.trim()}"]` : "";
    const fix = i.fix ? `\n   수정안:\n${i.fix
      .split("\n")
      .map((l) => "   " + l)
      .join("\n")}` : "";
    return `${n + 1}. (${i.severity}) ${i.message}${where}${fix}`;
  });
  return `검토관이 지적한 아래 ${list.length}건을 모두 반영해 문서를 수정하라. 지적되지 않은 부분은 그대로 유지하고, 고정 문구는 반드시 {{boilerplate:…}} 매크로로 쓴다.\n\n${lines.join("\n")}`;
}
