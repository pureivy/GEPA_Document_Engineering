/**
 * Stage prompt builders. The main `claude -p` process is the writer persona for the stage;
 * research is delegated to the `researcher` subagent through the Task tool.
 */
import { DEFAULT_REFERENCE_ROLE, REFERENCE_CHANGES_LABEL, type Stage, type ProjectDTO, type ReferenceRole } from "../../contracts";
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

/** 공문(official) 전용 — contact.수신유형이 있으면 그 값으로 한 줄을 만든다(§5.4: DB 컬럼 없이 contact 에 얹은 값). */
function recipientLine(p: ProjectDTO): string | null {
  const 수신유형 = p.contact.수신유형;
  if (!수신유형) return null;
  if (수신유형 === "내부결재") return "수신유형: 내부결재";
  if (수신유형 === "수신자") return `수신유형: 수신자, 수신: ${p.contact.수신 ?? ""}`;
  return `수신유형: 수신자참조, 수신자: ${p.contact.수신자 ?? ""}`;
}

function projectBrief(p: ProjectDTO, workspaceDir?: string): string {
  const lines = [
    `프로젝트: ${p.title}`,
    `주제: ${p.topic}`,
    `지역: ${p.region} / 주관기관: ${p.organizer}`,
    `담당: ${p.contact.부서명} ${p.contact.담당자 ?? ""} ☎ ${p.contact.전화} / ${p.contact.이메일}${p.contact.우편주소 ? " / " + p.contact.우편주소 : ""}`,
  ];
  const recipient = recipientLine(p);
  if (recipient) lines.push(recipient);
  // 전결은 결재란과 발신명의를 함께 정한다 — 수신유형과 같은 길(contact)로 실려 온다
  if (p.contact.전결) lines.push(`전결: ${p.contact.전결}`);
  // 결문 연락처의 전송·우편번호(공문 전용) — 담당 줄은 네 단계가 함께 쓰므로 늘리지 않고 따로 둔다.
  // kind 로 막는다: 이 두 칸은 폼의 공용 연락처 구역에 있고 브라우저 기억으로 prefill 되므로,
  // 공문을 한 번 만든 뒤 세운 사업계획서 프로젝트가 값을 물려받아 얼어붙은 세 family 의
  // 프롬프트에 없던 두 줄을 흘려보낸다(검토자 지적, 재현 확인).
  if (p.kind === "official") {
    if (p.contact.전송) lines.push(`전송: ${p.contact.전송}`);
    if (p.contact.우편번호) lines.push(`우편번호: ${p.contact.우편번호}`);
    // 홈페이지도 결문 연락처의 한 칸이다. 비면 줄 자체를 싣지 않고 결문의 그 칸도 빈다 —
    // 스키마 기본값이 없어졌으므로(schema.ts 연락처.홈페이지) 적지 않은 주소가 찍히지 않는다.
    if (p.contact.홈페이지) lines.push(`홈페이지: ${p.contact.홈페이지}`);
    // 공개구분은 결문 오른쪽 끝 칸이다. 비공개 문서를 공개로 내보내면 되돌릴 수 없어서
    // 담당자가 화면에서 고른 값을 그대로 싣는다(적지 않으면 스키마 기본값 공개).
    if (p.contact.공개구분) lines.push(`공개구분: ${p.contact.공개구분}`);
  }
  if (p.reference) {
    if (p.kind === "official") {
      // 공문에서는 같은 파일이 세 가지로 쓰인다(근거자료·받은 공문·붙임) — 용도 이름을 그대로 드러내
      // 아래 referenceGuide 의 지시와 담당자가 적은 줄이 같은 것을 가리키게 한다.
      // 사업계획서 쪽 두 줄은 손대지 않는다: 얼어붙은 세 family 의 프롬프트가 바뀌면 안 된다.
      const 용도 = referenceRole(p);
      lines.push(`참고 문서(용도: ${용도}): ${workspaceDir ?? "<작업폴더>"}/reference/base-plan.md (원본 파일 ${p.reference.fileName})`);
      // 비면 줄 자체를 싣지 않는다 — "(미기재 — 연도·일정·담당만 갱신)" 은 사업계획서 갱신을 전제한 문구라 공문에 맞지 않는다
      if (p.reference.changes) lines.push(`${REFERENCE_CHANGES_LABEL[용도]}: ${p.reference.changes}`);
    } else if (p.kind === "report") {
      // 업무보고에는 용도가 없다(화면에도 라디오가 없다) — 붙인 문서는 언제나 내용 근거자료다.
      // 여기서 갈라 두지 않으면 사업계획서 쪽 두 줄이 그대로 실려 에이전트가 업무보고를
      // "기존 계획서를 갱신하는 것"으로 읽는다. 아무 오류도 나지 않고 틀린 문서가 나온다.
      lines.push(`참고 문서: ${workspaceDir ?? "<작업폴더>"}/reference/base-plan.md (원본 파일 ${p.reference.fileName})`);
      if (p.reference.changes) lines.push(`${REFERENCE_CHANGES_LABEL[DEFAULT_REFERENCE_ROLE]}: ${p.reference.changes}`);
    } else {
      lines.push(`기존 사업계획서: ${workspaceDir ?? "<작업폴더>"}/reference/base-plan.md (원본 파일 ${p.reference.fileName}) — 이번 프로젝트는 이 계획서를 갱신하는 것이다.`);
      lines.push(`이번에 바뀌는 내용: ${p.reference.changes || "(미기재 — 연도·일정·담당만 갱신)"}`);
    }
  }
  return lines.join("\n");
}

/** 공문에 붙인 참고 문서의 용도. 파일만 있고 용도가 비었으면 근거자료로 본다(가장 해가 적은 쪽). */
function referenceRole(p: ProjectDTO): ReferenceRole {
  return p.contact.참고문서용도 ?? DEFAULT_REFERENCE_ROLE;
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
    // 공문은 붙인 문서를 셋 중 어느 쪽으로 쓰느냐에 따라 지시가 완전히 갈린다 — 근거자료는 내용을 추려 쓰고,
    // 받은 공문은 그 공문에 회신하며, 붙임은 본문에 옮기지 않고 이름만 「붙임」에 적는다.
    case "official":
      switch (referenceRole(p)) {
        case "받은공문":
          return `\n받은 공문 ${file} 를 먼저 Read 한다. 수신은 그 공문의 발신명의로 하고, 제목은 「(받은 공문의 제목)」 관련 회신으로 적는다. 본문 첫 항은 그 공문을 근거로 밝히며 시작한다(예: "귀 기관의 ○○○-1234(2026. 9. 10.)호와 관련입니다."). 문서번호·시행일이 추출된 텍스트에 없으면 지어내지 말고 그 부분을 비운 채 제목만으로 관련지어 적는다.`;
        case "붙임":
          return `\n붙임 문서 ${file} 를 먼저 Read 해 무엇인지 파악한다. 본문에는 이 문서를 보내는 취지와 수신자가 할 일만 간단히 적는다(내용을 본문에 옮겨 적지 않는다). 붙임 이름은 front-matter 의 붙임 목록에 "○○○ 1부." 형태로 적는다 — 본문에 직접 타이핑하지 않는다(작성기가 결문의 붙임 줄과 "끝." 표기를 그 목록에서 만든다). 이름은 "붙임에 적을 이름" 줄이 있으면 그 값을, 없으면 원본 파일명에서 확장자를 뺀 것을 쓴다.`;
        default:
          return `\n참고 문서 ${file} 를 먼저 Read 한다. 사업명·기간·금액·대상·담당은 그 문서에 적힌 값을 그대로 쓰고, 그 문서에 없는 수치는 지어내지 않는다(없으면 그 항목을 빼거나 "별도 안내"로 적는다). 공문 본문은 1쪽 분량으로 줄인다 — 그 문서를 옮겨 적는 것이 아니라 수신자가 해야 할 일과 기한만 남긴다.`;
      }
    // 업무보고의 참고 문서는 대개 **지난 보고서나 실적 자료**다 — 갱신할 계획서가 아니다.
    // 이 분기가 없으면 여기서 빈 문자열이 나가고, 붙인 문서를 어떻게 쓰라는 말이 아무 데도 없다.
    case "report":
      return `\n참고 문서 ${file} 를 먼저 Read 한다. 실적·조직·예산 수치는 그 문서에 적힌 값만 쓰고, 그 문서에 없는 수치는 지어내지 말고 그 줄을 빼거나 "추진 중"으로 적는다. 그 문서를 옮겨 적는 것이 아니라 이번 보고의 차례에 맞게 추려 다시 쓴다.
**연도를 옮겨 붙이지 않는다.** 이번 보고 기준으로 고치는 것은 표지·보고일·대상기간과 장 제목의 연도뿐이다. 실적 수치와 그 실적이 일어난 연도는 참고 문서에 적힌 그대로 둔다 — 지난해 실적에 올해 연도를 붙이면 있지도 않은 실적이 결재에 올라간다.`;
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

/** 검토 대상 단계별 규격 스킬. 빠뜨리면 검토관이 엉뚱한 규격으로 채점한다(공문을 보도자료 기준으로 보는 식). */
const REVIEW_SKILL: Record<Stage, string> = {
  research: "gepa-research",
  plan: "gepa-plan-design",
  notice: "gepa-notice-design",
  press: "gepa-press-style",
  official: "gepa-official-design",
  report: "gepa-report-design",
};

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
        prompt: `${brief}\n작업 폴더: ${workspaceDir}\n\n${workspaceDir}/${target}/draft.dsl.md 를 검토하라. 관련 규격: .claude/skills/${REVIEW_SKILL[target]}/SKILL.md.
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
    case "official":
      return {
        systemPromptAppend: `${COMMON()}\n역할: 공문서 작성자. .claude/skills/gepa-official-design/SKILL.md 의 front-matter 필드·두문/결문 규격을 그대로 따른다. 별지 제1호 일반기안문이고 가변부는 수신/제목/본문/붙임 네 가지뿐이다. **시행번호·접수번호는 절대 만들지 않는다** — 전자결재가 기안 후에 채번한다.`,
        prompt: `${brief}\n작업 폴더: ${workspaceDir}\n\n위 내용으로 공문서(기안문)를 작성하라.
- front-matter의 처리과는 ${project.contact.부서명}, 연락처(front-matter 의 연락처 객체: 우편번호·주소·홈페이지·전화·전송·이메일)는 전화 ${project.contact.전화} / 이메일 ${project.contact.이메일}${project.contact.우편주소 ? ` / 주소 ${project.contact.우편주소}` : ""} 로 채운다. 위에 "전송: …" 줄이 있으면 연락처의 전송에, "우편번호: …" 줄이 있으면 연락처의 우편번호에, "홈페이지: …" 줄이 있으면 연락처의 홈페이지에 그 값을 그대로 옮긴다. **그 줄이 없으면 그 칸을 비워 둔다 — 주소나 번호를 지어내지 않는다**(결문의 빈 칸은 빈 칸으로 나가는 것이 맞다).
- 위에 "공개구분: …" 줄이 있으면 front-matter 의 공개구분에 그 값을 그대로 옮긴다(공개·부분공개·비공개 셋 중 하나다). 그 줄이 없으면 적지 않는다 — 적지 않으면 공개가 기본값이다.
- 수신유형·수신(자)은 위 "수신유형: …" 줄의 값을 그대로 옮긴다. 수신유형이 수신자참조면 그 줄의 수신자는 쉼표로 구분된 이름 목록이므로 OfficialMetaSchema 가 요구하는 YAML 배열(수신자: [경영지원팀장, 마케팅팀장, …])로 바꿔 쓴다 — 옮겨 적기만 하면 배열이 아니라 문자열 하나가 되어 스키마를 통과하지 못한다. 위에 "수신유형: …" 줄이 없으면(예전 방식으로 만들어진 프로젝트) 지시 내용에서 판단하고, 불분명하면 수신유형: 수신자, 수신에 처리과가 속한 실·단장 직위를 적는다.
- 전결은 위 "전결: …" 줄의 값을 front-matter 의 전결에 그대로 옮긴다 — 결재란을 어디서 끊을지와 발신명의가 여기서 함께 정해진다(실·단장 → 실·단장 명의, 본부장 → 본부장 명의, 원장 → 기관장 명의). 그 줄이 없으면 전결을 적지 않는다(적지 않으면 원장까지 결재하는 것이 기본값이다 — 전결은 그 사슬을 낮출 때만 적는다).
- 발신명의와 결재라인은 비워 둔다 — 전결과 처리과에서 자동으로 채워진다. 규정 밖의 결재란을 재현해야 할 때만 결재라인을 직접 적는다.
- 본문은 문장체로 쓰고 항목은 1. → 가. → 1) → 가) 순으로 매기며, 항목이 하나뿐이면 기호를 붙이지 않는다.
- 붙임물이 있으면 front-matter의 붙임 목록에 적고 본문에 직접 타이핑하지 않는다. 붙임이 없으면 본문 마지막 줄 끝에 "  끝."을 직접 쓴다.
- 시행 일련번호·접수번호는 어떤 형태로도 만들지 않는다(front-matter에 그런 키가 없다).${DOC_CONTRACT("official", "official")}${resume}`,
        allowedTools: ["Read", "Write", "Glob", "Grep"],
        maxTurns: 20,
      };
    case "report":
      return {
        systemPromptAppend: `${COMMON()}\n역할: 주요업무보고 작성자. .claude/skills/gepa-report-design/SKILL.md 의 사다리·요약박스·목차 규격을 그대로 따른다. 업무보고는 공고가 아니라 **실적과 계획**이다 — 근거 없는 수치는 쓰지 않는다. 목차 쪽번호는 자리표시자 ―(U+2015)를 그대로 두고 숫자를 지어내지 않는다(결재에 올라가는 문서이고 담당자가 한글에서 채운다).`,
        prompt: `${brief}\n작업 폴더: ${workspaceDir}\n\n위 내용으로 「${project.title}」 주요업무보고를 작성하라.
- front-matter: 제목(${project.title}), 부서(${project.contact.부서명}), 보고일·보고대상·대상기간은 위 지시에 적힌 값만 옮긴다 — 없으면 빈 문자열로 두고 날짜나 받는 사람을 지어내지 않는다. 표지에 나가는 글자는 제목뿐이다(나머지는 문서의 기록으로만 남는다).
- 첫 블록은 \`\`\`toc 목차다. 작성기가 만들어 주지 않으므로 쓰지 않으면 보고순서 쪽이 통째로 빠진다. 장 줄은 "Ⅰ. 일 반 현 황", 절 줄은 "1. 설립목적" 꼴로 본문 차례와 같게 적는다. **쪽번호를 적지 않는다** — 작성기가 줄 끝에 자리표시자를 붙인다.
- 장은 "# 일 반 현 황"(간지), 절은 "## 설립목적"(번호 칩)으로 쓴다. Ⅰ·Ⅱ 와 1·2 는 자동으로 매겨지므로 번호를 직접 적지 않는다. **간지에 <pagebreak> 를 쓰지 않는다** — 작성기가 새 쪽에서 열고 뒷면을 빈 쪽으로 남기는 것까지 보장한다. 손으로 넣으면 빈 쪽이 간지마다 하나씩 더 생긴다.
- 본문 사다리는 **소제목 □ → ● → -** 세 칸뿐이다. 더 깊이 들어가지 않는다. **ㅇ 은 쓰지 않는다 — 1단계는 언제나 ● 다.**
- 절이 요약문으로 시작할 때만 절 칩 바로 밑에 \`\`\`box 요약문을 둔다(두 줄 안팎). 목록이나 표로 시작하는 절에는 박스를 두지 않는다.
- 수치는 근거가 있는 것만 쓴다. 위 지시에 없는 실적·예산·건수는 지어내지 말고 그 줄을 빼거나 "추진 중"으로 적는다.
- **칸마다 맡은 일이 다르다**: \`●\` 는 무엇을 왜 했는지(30자 안팎, 수치 없이), \`-\` 는 얼마나 했는지를 수치와 단위로(38자 안팎). \`●\` 에 숫자를 넣으면 아래 줄이 할 일이 없어진다. 스킬의 「내용」 절에 참고본 한 절이 본보기로 실려 있으니 그 모양을 따른다.
- **비교 기준이 자료에 있으면 반드시 쓴다** — \`’24년 대비 170%↑\`, \`목표 대비 120%\`, \`전년 1,680건 → 2,851건\`. 없으면 지어내지 말고, 대신 그 줄을 성과인 양 쓰지 않는다(\`교육 11명\` 은 투입이지 성과가 아니다).
- 조직도 자리에는 <조직도> 한 줄만 둔다(글은 참고본 조각에 굳어 있다).${DOC_CONTRACT("report", "report")}${resume}`,
        allowedTools: ["Read", "Write", "Glob", "Grep"],
        maxTurns: 20,
      };
    default:
      throw new Error(`${stage} 단계의 프롬프트가 아직 구현되지 않았습니다`);
  }
}
