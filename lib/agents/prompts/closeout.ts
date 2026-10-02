/**
 * 정산·결과보고(closeout) 단계 프롬프트 — 정산자료 → 결과보고서 → 정산보고서 → 제출 공문.
 *
 * 네 단계가 공유하는 원칙은 하나다: **숫자는 원장(ledger.json)과 `{{정산:…}}` 매크로가 쓴다.** 에이전트는
 * 원자료의 숫자를 원장으로 옮기고(정산자료), 문서에서는 표를 매크로로 넣고 서술만 쓴다. 규격은
 * agent/.claude/skills/gepa-closeout-design/SKILL.md 한 곳에 둔다(프롬프트에는 단계별 지시만).
 */
import type { Stage } from "../../contracts";
import { COMMON, DOC_CONTRACT, type StagePrompt, type StagePromptInput } from "./index";

const SKILL = ".claude/skills/gepa-closeout-design/SKILL.md";

/** 경상북도 수신이면 공문 정산표의 마지막 열이 통장잔액이다(closeout-cover.md §2.6) */
function isProvince(recipient: string | undefined): boolean {
  return !!recipient && /경상북도|도지사/.test(recipient);
}

type Input = StagePromptInput & { brief: string; resume: string };

export function closeoutStagePrompt(stage: Extract<Stage, "ledger" | "result" | "settlement" | "submit">, input: Input): StagePrompt {
  const { project, workspaceDir: ws, brief, resume } = input;
  const ledgerRule = `숫자 규칙: 정산 표는 ${SKILL} §0 의 {{정산:…}} 매크로 한 줄로만 넣고, 본문 문장 속 금액·집행률도 값 매크로로 쓴다. ${ws}/ledger/summary.md 의 수치를 손으로 옮겨 적거나 더하지 않는다. 자료·메모에 없는 날짜·인원·기업명·실적은 지어내지 말고 ○○ 로 남긴다.`;
  const role = (r: string) => `${COMMON()}\n역할: ${r}. ${SKILL} 를 먼저 읽고 그대로 따른다.`;
  switch (stage) {
    case "ledger":
      return {
        systemPromptAppend: role("정산 원장 작성자 — 올린 엑셀·문서의 예산과 집행 건을 정산 원장(JSON)으로 옮긴다. 계산하지 않고 옮긴다"),
        prompt: `${brief}\n작업 폴더: ${ws}\n\n1) ${ws}/materials/index.md 를 읽고 목록의 자료를 모두 읽는다(사업계획서·교부결정서 → 예산·재원·사업기간, 집행 집계표·지출결의 → 집행 건, 통장거래내역 → 일자·지급처·이자·최종잔액 대조).
2) ${SKILL} §1 의 스키마와 규칙대로 ${ws}/ledger/ledger.json 을 Write 한다. 금액은 원자료에 적힌 값을 원 단위 정수로 그대로 옮긴다 — 더하거나 나누어 만든 숫자를 넣지 않는다(합계 행은 옮기지 않는다: 프로그램이 계산한다).
3) 세목 이름은 예산과 집행에서 똑같이 쓴다. 재원 합계와 세목 예산 합계가 같아야 한다(원자료끼리 어긋나면 교부결정서·사업계획서 예산표를 따르고 메모에 적는다).
4) 위 지시(주제·메모)에 적힌 잔액 사유가 있으면 해당 세목의 잔액사유에 옮긴다.
5) 원자료로 확정할 수 없는 대응(어느 세목인지 모호한 지출, 통장과 집계표의 차이)은 모두 "메모"에 한 줄씩 남긴다.
자료가 없거나 예산을 전혀 찾을 수 없으면 원장을 지어내지 말고, 무엇이 필요한지(예: "교부결정서 또는 예산표", "집행내역 엑셀")를 마지막 답변에 적고 끝낸다.
저장한 뒤 ledger.json 을 Read 로 한 번 다시 열어 JSON 문법(쉼표·따옴표)을 확인한다. 고칠 것이 있으면 Edit 로 그 부분만 고친다.
마지막 답변은 3줄 이내: 집행 건수, 재원·예산 합계, 메모 건수.${resume}`,
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
        maxTurns: 40,
      };
    case "result":
      return {
        systemPromptAppend: role("결과보고서 작성자 — 사업을 마친 뒤 내부 결재용 결과보고(Ⅰ 사업개요 → Ⅱ 추진결과 → Ⅲ 주요성과 → Ⅳ 예산 집행 현황 → Ⅴ 총평 및 향후계획)를 쓴다"),
        prompt: `${brief}\n작업 폴더: ${ws}\n\n${ws}/materials/index.md 의 자료(특히 사업계획서·실적 자료·메모)와 ${ws}/ledger/summary.md 를 읽고 「${project.title}」 결과보고서를 작성하라.
- ${SKILL} §2 의 front-matter·골격을 따른다. 제목은 「${project.title}」 결과보고, 부서는 ${project.contact.부서명}.
- 사업 유형을 먼저 정하고(행사·협의체 / 교육 / 기업 지원금·바우처·시군위탁 / 소상공인 대량지원 / 해외전시·사절단 / 국내 판로 / 제작물 / 일자리) 그 유형 모듈의 표와 블록을 Ⅱ·Ⅲ 에 넣는다. 유형의 표 열과 실제 예시는 .claude/skills/gepa-closeout-design/reference/result.md §4·§8 을 Read 한다.
- Ⅰ 사업개요는 사업계획서에서 옮긴다(추진배경·목적·사업명·기간·대상·내용). Ⅱ·Ⅲ 의 수치는 자료와 위 메모에 있는 것만 쓴다.
- Ⅳ 예산 집행 현황은 {{정산:항목별}} 한 줄과 잔액·이자 한 줄로 쓴다.
- ${ledgerRule}${DOC_CONTRACT("result", "plan")}${resume}`,
        allowedTools: ["Read", "Write", "Glob", "Grep"],
        maxTurns: 30,
      };
    case "settlement":
      return {
        systemPromptAppend: role("정산보고서 작성자 — 위탁기관 서식 「위탁사업 추진실적 및 정산보고서」를 채운다. 표는 모두 매크로이고, 쓰는 것은 서술 칸뿐이다"),
        prompt: `${brief}\n작업 폴더: ${ws}\n\n${ws}/ledger/summary.md, ${ws}/result/draft.dsl.md(있으면 — 결과보고서), ${ws}/materials/index.md 의 사업계획서를 읽고 정산보고서를 작성하라.
- ${SKILL} §3 의 틀을 **그대로** 쓴다(front-matter 의 표지: 없음, numbering: arabic 포함). {재원명}은 summary.md 의 재원명과 같게 쓴다.
- 제출자: 대표자는 원장 성명을 한 글자씩 띄워 쓰고, 실무책임자·연락처·주소는 위 담당 줄의 값을 옮긴다(없는 칸은 비운다). 귀하 줄은 "${project.contact.수신 ? project.contact.수신.replace(/\(.*\)$/, "").trim() : "(위탁기관장)"} 귀하".
- 제출일은 "${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월    일" 처럼 일을 비워 둔다(직인일).
- 사업개요(요약) 표의 사업목적·추진실적·사업성과·활용계획, 계획 대비 추진실적, 자체평가, 개선 및 건의사항만 쓴다 — 결과보고서와 같은 사실을 더 짧게(칸마다 1~2줄).
- ${ledgerRule}${DOC_CONTRACT("settlement", "plan")}${resume}`,
        allowedTools: ["Read", "Write", "Glob", "Grep"],
        maxTurns: 25,
      };
    case "submit": {
      const province = isProvince(project.contact.수신);
      return {
        systemPromptAppend: role("제출 공문 작성자 — 결과보고서·정산보고서를 붙여 위탁기관에 보내는 별지 제1호 기안문을 쓴다. .claude/skills/gepa-official-design/SKILL.md 의 front-matter·두문/결문 규격도 따른다. 시행번호·접수번호는 만들지 않는다"),
        prompt: `${brief}\n작업 폴더: ${ws}\n\n${ws}/ledger/summary.md 와 ${ws}/result/draft.dsl.md(결과보고서 요지)를 읽고 「${project.title}」 결과 및 정산보고 공문을 작성하라.
- front-matter: 수신유형 수신자, 수신 ${project.contact.수신 ?? "(위 수신 줄)"}, 제목 「${project.title}」 결과 및 정산보고, 처리과 ${project.contact.부서명}. 전결·공개구분·연락처(전송·우편번호·홈페이지)는 위 줄에 있는 값만 옮기고 없으면 적지 않는다. 발신명의·결재라인은 비워 둔다.
- 붙임: [정산보고서 1부., 결과보고서 1부., 통장 거래내역 1부., 지출증빙자료 1식(별송).] — 본문에 직접 타이핑하지 않는다.
- 본문은 ${SKILL} §4 골격. **본문 첫 줄은 "1. ", 둘째 항은 "2. " 로 번호를 직접 적어 시작한다**(그 아래 가. → 1) 순). 인사말은 "${province ? "경상북도의 무궁한 발전을 기원합니다." : "귀 기관의 무궁한 발전을 기원합니다."}", 정산내역의 첫 줄은 "${province ? "1) 통장잔액: {{정산:반납액한글}}" : "1) 반납액: {{정산:반납액한글}}"}", 표는 ${province ? "{{정산:공문표 열=통장잔액}}" : "{{정산:공문표}}"} 한 줄.
- 추진실적 한 줄은 결과보고서의 요지에서 옮긴다(수치는 거기 있는 것만).
- ${ledgerRule}${DOC_CONTRACT("submit", "official")}${resume}`,
        allowedTools: ["Read", "Write", "Glob", "Grep"],
        maxTurns: 20,
      };
    }
  }
}
