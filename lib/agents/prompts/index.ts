/**
 * Stage prompt builders. The main `claude -p` process is the writer persona for the stage;
 * research is delegated to the `researcher` subagent through the Task tool.
 */
import type { Stage, ProjectDTO } from "../../contracts";
import { orgSummary } from "../../org";

export interface StagePromptInput {
  stage: Stage | "review";
  project: ProjectDTO;
  /** absolute path of data/projects/<id> (passed to --add-dir) */
  workspaceDir: string;
  /** optional user instruction for a resumed run ("이어서 수정 요청") */
  instruction?: string;
  /** for review: which stage's DSL to review */
  reviewTarget?: Stage;
  /** research/plan: public-data MCP tools available in this run (mcp__gepa-data__…), if any */
  dataTools?: string[];
  /** research/plan: read-only snapshot of the institution's internal wiki (absolute path), if configured */
  wikiDir?: string;
  /** plan: allow up to two Task(researcher) 보충 조사 calls (user option; default off for speed) */
  supplementalResearch?: boolean;
}

export interface StagePrompt {
  prompt: string;
  systemPromptAppend: string;
  allowedTools: string[];
  maxTurns: number;
  jsonSchema?: Record<string, unknown>;
}

const COMMON = () => `당신은 (재)경상북도경제진흥원(GEPA)의 문서 작성 에이전트다. 모든 문서는 한국어 공문서 개조식으로 쓴다.
기관 사실(2026년 9월 기준): ${orgSummary()} 보도자료의 "(원장 ○○○)"·인용문에는 원장 성명을 쓰고 ○○○ 자리표시자를 남기지 않는다. 프로젝트의 부서명이 팀명·약칭이면 위 표의 실·단 정식 명칭으로 쓰고, 보도자료 front-matter의 책임자에는 그 실·단의 책임자("직위 이름")를, 사업계획서 front-matter의 부서에는 프로젝트 부서명을 그대로 적는다(결재라인은 부서로 자동 결정).
작업 규칙: Bash는 사용하지 않는다. 필요한 참고 자료는 .claude/skills/*/SKILL.md 와 reference/ 문서를 Read로 읽는다.
프로젝트 작업 폴더(아래 경로)의 파일만 읽고 쓴다.`;

function projectBrief(p: ProjectDTO, workspaceDir?: string): string {
  const lines = [
    `프로젝트: ${p.title}`,
    `주제: ${p.topic}`,
    `지역: ${p.region} / 주관기관: ${p.organizer}`,
    `담당: ${p.contact.부서명} ${p.contact.담당자 ?? ""} ☎ ${p.contact.전화} / ${p.contact.이메일}${p.contact.우편주소 ? " / " + p.contact.우편주소 : ""}`,
  ];
  if (p.reference) {
    lines.push(`기존 사업계획서: ${workspaceDir ?? "<작업폴더>"}/reference/base-plan.md (원본 파일 ${p.reference.fileName}) — 이번 프로젝트는 이 계획서를 갱신하는 것이다.`);
    lines.push(`이번에 바뀌는 내용: ${p.reference.changes || "(미기재 — 연도·일정·담당만 갱신)"}`);
  }
  return lines.join("\n");
}

/** Stage-specific guidance when the project was started from an uploaded 기존 사업계획서. */
function referenceGuide(p: ProjectDTO, stage: Stage | "review", workspaceDir: string): string {
  if (!p.reference) return "";
  const file = `${workspaceDir}/reference/base-plan.md`;
  switch (stage) {
    case "research":
      return `\n기존 사업계획서 ${file} 를 먼저 Read 한다. 그 계획서의 사업개요·지원내용·예산·추진체계는 확정된 사실로 보고 그대로 notes.md 에 옮긴다(출처: "기존 사업계획서"). 조사는 **바뀌는 내용과 관련된 최신 근거**(최신 통계 연도 갱신, 바뀐 지원 규모·단가의 산출 근거, 새 법령·조례)에 한정한다 — 웹검색 5회, WebFetch 5회 이내, 하위 에이전트는 1회 이하.`;
    case "plan":
      return `\n기존 사업계획서 ${file} 를 먼저 Read 하고, 그 골격(장 구성·소제목 순서)·문체·표 구성을 그대로 유지하되 "이번에 바뀌는 내용"을 모든 장에 일관되게 반영한다(연도, 사업기간, 규모, 금액, 담당 등 관련 수치를 빠짐없이 갱신하고 표의 합계도 다시 맞춘다). 바뀌지 않은 부분은 원문의 표현을 최대한 살린다.`;
    case "notice":
    case "press":
      return `\n이 프로젝트는 기존 사업계획서(${file})를 갱신한 것이다. 이번에 바뀐 내용이 공고·보도 내용에도 반영되었는지(연도·기간·규모·금액) 확인한다.`;
    default:
      return "";
  }
}

/** Source-priority paragraph for research-capable stages (wiki → API tools → web). */
function sourcesGuide(input: Pick<StagePromptInput, "dataTools" | "wikiDir">): string {
  const parts: string[] = [];
  if (input.wikiDir) {
    parts.push(
      `자료 우선순위 1 — 진흥원 내부 위키(읽기 전용 사본): ${input.wikiDir}. 이전 연도 사업계획·예산·대행수수료·실적·기업 건의가 있으므로 웹검색보다 먼저 Grep/Read 로 찾는다(파일명 예: 2026년-사업현황-*.md, *지원사업*.md, *사업계획안*.md). 직원 성명·연락처·개별 기업 건의 원문은 노트에 옮기지 않는다. 출처 표기는 (진흥원 내부자료, 연도)와 파일명.`,
    );
  }
  if (input.dataTools?.length) {
    parts.push(
      `자료 우선순위 ${input.wikiDir ? 2 : 1} — 공공데이터 API 도구(MCP): ${input.dataTools.join(", ")}. 통계·수출입·점포 수·법령·조례·지원사업 공고는 웹검색보다 이 도구를 먼저 쓴다(응답의 source 를 그대로 sources.json 에 적는다: 기관·서비스·url·기준시점). 도구가 ok:false 를 돌려주면 hint 대로 다른 출처로 넘어가고 같은 호출을 반복하지 않는다. 먼저 data_sources_status 로 사용 가능한 출처를 확인한다.`,
    );
  }
  parts.push(`자료 우선순위 ${parts.length + 1} — 웹검색(WebSearch/WebFetch)은 위에서 못 찾은 사례·정책 동향·보도자료에만 쓴다.`);
  return parts.join("\n");
}

const DOC_CONTRACT = (stage: Stage, family: string) => `
출력 계약(반드시 지킬 것):
1. 먼저 .claude/skills/gepa-dsl/SKILL.md 와 .claude/skills/gepa-dsl/reference/grammar.md 를 읽는다.
2. 문서 전체를 GEPA DSL(front-matter의 family: ${family})로 작성한다.
3. 완성된 DSL 전체를 Write 도구로 <작업폴더>/${stage}/draft.dsl.md 에 저장한다. 이 저장이 곧 제출이다(화면에는 저장하는 내용이 실시간으로 표시된다). 문서는 머릿속에서 완성한 뒤 **한 번에** 저장한다. 다시 Write 하는 것은 치명적 오류를 고칠 때 **최대 1회**로 한다(매번 전체를 다시 쓰면 시간이 배로 든다).
4. 마지막 답변은 3줄 이내의 요약만 쓴다. DSL을 답변에 다시 출력하지 않는다.
`;

export function buildStagePrompt(input: StagePromptInput): StagePrompt {
  const { stage, project, workspaceDir, instruction } = input;
  const brief = projectBrief(project, workspaceDir) + referenceGuide(project, stage, workspaceDir);
  const resume = instruction ? `\n\n[추가 지시] ${instruction}\n기존 초안을 위 지시에 맞게 수정해 전체를 다시 Write 도구로 저장한다.` : "";
  switch (stage) {
    case "research":
      return {
        systemPromptAppend: `${COMMON()}\n역할: 사업기획 조사관. .claude/skills/gepa-research/SKILL.md 의 규칙을 따른다.`,
        prompt: `${brief}\n작업 폴더: ${workspaceDir}\n\n위 주제로 사업계획 수립에 필요한 조사를 수행하고 결과를 ${workspaceDir}/research/notes.md 와 ${workspaceDir}/research/sources.json 에 저장하라.
조사 항목: 추진배경·필요성 / 현황·통계(최근 3개년, 출처·URL 필수) / 유사·선행 사업(지원내용·규모·예산) / 법령·근거 / 예산 산출 근거(단가, 한도) / 수요·기대효과.
${sourcesGuide(input)}
조사 항목을 2~3개 묶음으로 나눠 Task 도구로 researcher 하위 에이전트에 맡기되, **같은 메시지에서 한꺼번에(병렬로) 호출**한다(최대 3회, 순차 호출 금지). 단, 하위 에이전트 결과가 모두 돌아온 뒤 반드시 당신이 직접 notes.md 와 sources.json 을 완성해야 한다. 하위 에이전트가 "작업 중"이라는 이유로 답변을 끝내지 말라 — Task 도구의 결과가 답변으로 돌아올 때까지 기다린 뒤 종합한다.
완료 조건: ${workspaceDir}/research/notes.md 와 sources.json 이 실제로 존재해야 한다(Write로 저장). 처음 저장한 뒤의 보완·수정은 파일 전체를 다시 Write 하지 말고 Edit 도구로 해당 부분만 고친다. 마지막 답변에는 핵심 숫자 10개 이내와 출처를 요약한다.${resume}`,
        allowedTools: ["WebSearch", "WebFetch", "Read", "Write", "Edit", "Glob", "Grep", "Task"],
        maxTurns: 40,
      };
    case "plan":
      return {
        systemPromptAppend: `${COMMON()}\n역할: 사업계획(안) 작성자. .claude/skills/gepa-plan-design/SKILL.md 의 정본 목차·표 규격·문체를 따른다. 수치는 research/notes.md 와 sources.json 에 있는 것만 쓰고 (출처, 연도)를 붙인다.`,
        prompt: `${brief}\n작업 폴더: ${workspaceDir}\n\n${workspaceDir}/research/notes.md 와 sources.json 을 읽고(없으면 주제만으로 작성하되 통계는 "확인 필요"로 표시), 「${project.title}」 사업계획(안)을 작성하라.
front-matter: 제목(…사업계획(안)), 연도, 부서(${project.contact.부서명}), 결재{공개구분: 공개}, numbering: roman, lineSpacing: 160, body1Font: hyHeadlineBold. (요약은 쓰지 않는다 — 표지는 결재란·사업명 상자·로고만)
장 구성: 추진배경 및 목적(추진배경 ㅇ 3개, 추진목적 ㅇ 2~3개, 1쪽) / 사업개요 및 추진절차 / 세부 추진계획(## 절 2~3개) / 추진일정 / 소요예산(표+예산과목) / 기대효과(ㅇ 3개, 끝.). 분량 A4 8~12쪽.
${input.supplementalResearch ? "근거가 부족한 항목에 한해 Task(researcher)로 보충 조사할 수 있다(최대 2회, 같은 메시지에서 병렬 호출). 그 밖의 수치는 research/notes.md 와 sources.json 에 있는 것만 쓴다." : "보충 조사는 하지 않는다: 근거는 research/notes.md 와 sources.json 에 있는 것만 쓰고, 없는 수치는 \"확인 필요\"로 표시한다."} notes.md 와 sources.json 은 각각 Read 한 번으로 읽고 Grep 을 반복하지 않는다(위키 경로가 주어진 경우에만 Grep 2~3회).
${sourcesGuide(input)}${DOC_CONTRACT("plan", "plan")}${resume}`,
        allowedTools: input.supplementalResearch ? ["Read", "Write", "Glob", "Grep", "Task", "WebSearch", "WebFetch"] : ["Read", "Write", "Glob", "Grep"],
        maxTurns: 60,
      };
    case "notice":
      return {
        systemPromptAppend: `${COMMON()}\n역할: 모집 공고문 작성자. .claude/skills/gepa-notice-design/SKILL.md 의 front-matter 필드·섹션 순서·고정문구 매크로를 그대로 따른다.`,
        prompt: `${brief}\n작업 폴더: ${workspaceDir}\n\n${workspaceDir}/plan/draft.dsl.md (사업계획서)를 읽고 그 사업의 참여기업 모집 공고문을 작성하라.
- front-matter의 접수 정보는 담당 연락처를 쓴다: 이메일 ${project.contact.이메일}, 전화 ${project.contact.전화}, 부서명 ${project.contact.부서명}, 우편주소 ${project.contact.우편주소 ?? "경상북도 안동시 북순환로 387, 2층 경상북도경제진흥원"}.
- 공고번호는 "2026MM0001" 꼴(연도+공고월+일련번호, 예: 2026070001)로 쓰고, 공고연월은 사업계획서의 공고 시기.
- 본문 섹션: 사업목적 / 사업기간 / 신청자격(참여제한대상 매크로) / 신청방법(제출서류 표) / 선정절차 / 지원내용(지원내용 표, 지원한도, 지급방법 매크로) / 기타 유의사항(매크로) / <pagebreak> [별첨1]정량평가 기준 표.
- 사업계획서의 지원대상·지원내용·금액·일정·모집규모와 반드시 일치시킨다.
- 접수기간·마감일·선정 발표일 등 모든 날짜는 사업계획서의 추진일정에서 구체적 날짜로 확정해 요일까지 쓴다(예: 2026. 7. 15.(수) 18:00). "07. 00."처럼 00 자리표시자는 쓰지 않는다. 계획서에 날짜가 없으면 공고월 기준으로 합리적 일정을 정하고 "※ 일정은 주관기관 협의 후 확정" 주석을 단다("확정 필요" 같은 내부 메모 표현은 쓰지 않는다).
- 고정 문구(참여제한대상·예산상황·기업부담금·지급방법·기타유의사항)는 반드시 {{boilerplate:…}} 매크로로 넣고 직접 타이핑하지 않는다.${DOC_CONTRACT("notice", "notice")}${resume}`,
        allowedTools: input.supplementalResearch ? ["Read", "Write", "Glob", "Grep", "Task", "WebSearch", "WebFetch"] : ["Read", "Write", "Glob", "Grep"],
        maxTurns: 30,
      };
    case "press":
      return {
        systemPromptAppend: `${COMMON()}\n역할: 보도자료 작성자. .claude/skills/gepa-press-style/SKILL.md 를 따른다.`,
        prompt: `${brief}\n작업 폴더: ${workspaceDir}\n\n${workspaceDir}/notice/draft.dsl.md (공고문)과 ${workspaceDir}/plan/draft.dsl.md (사업계획서)를 읽고 언론 배포용 보도자료를 작성하라.
front-matter: 기관 (재)경상북도경제진흥원, 배포일(공고일), 보도시점 즉시, 담당부서 ${project.contact.부서명}(부서 정식 명칭 그대로), 책임자(실장 성명을 알면 "실장 ○○○", 모르면 키 생략), 담당자 ${project.contact.담당자 ?? "담당자"}, 연락처 ${project.contact.전화}, 이메일 ${project.contact.이메일}, 제목, 부제, 사진 false, 붙임 [사업 공고문 1부].
제목은 공백 포함 26자 이하(최대 36자), 부제는 30자 이하(최대 42자)로 쓴다 — 한 줄에 들어가야 한다. 본문 1,200~1,800자. 공고문에 없는 숫자는 쓰지 않는다. 날짜는 공고문의 확정 날짜를 그대로 쓰고 "00일" 같은 자리표시자는 쓰지 않는다.${DOC_CONTRACT("press", "press")}${resume}`,
        allowedTools: input.supplementalResearch ? ["Read", "Write", "Glob", "Grep", "Task", "WebSearch", "WebFetch"] : ["Read", "Write", "Glob", "Grep"],
        maxTurns: 20,
      };
    case "review": {
      const target = input.reviewTarget ?? "plan";
      return {
        systemPromptAppend: `${COMMON()}\n역할: 문서 검토관. .claude/agents/reviewer.md 의 점검 항목을 적용한다.`,
        prompt: `${brief}\n작업 폴더: ${workspaceDir}\n\n${workspaceDir}/${target}/draft.dsl.md 를 검토하라. 관련 규격: .claude/skills/gepa-${target === "plan" ? "plan-design" : target === "notice" ? "notice-design" : "press-style"}/SKILL.md.
이슈마다 blockHint(문제가 있는 줄의 앞 20자), severity(error|warn|info), message, fix(수정 제안 DSL 줄)를 채우고 0~100점 score를 매긴다.
참고 자료: ${workspaceDir}/research/notes.md (수치·출처 대조), ${workspaceDir}/plan/draft.dsl.md (공고문·보도자료 검토 시 정합성 기준).`,
        allowedTools: ["Read", "Glob", "Grep"],
        maxTurns: 15,
        jsonSchema: {
          type: "object",
          properties: {
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: { blockHint: { type: "string" }, severity: { type: "string", enum: ["error", "warn", "info"] }, message: { type: "string" }, fix: { type: "string" } },
                required: ["blockHint", "severity", "message"],
              },
            },
            score: { type: "number" },
            summary: { type: "string" },
          },
          required: ["issues", "score"],
        },
      };
    }
    default:
      // official: 프롬프트는 별도 계획(공문서 작성 에이전트/스킬)에서 추가된다.
      throw new Error(`${stage} 단계의 프롬프트가 아직 구현되지 않았습니다`);
  }
}
