import { describe, it, expect } from "vitest";
import { buildStagePrompt } from "../../lib/agents/prompts";
import { REFERENCE_CHANGES_LABEL, type ProjectDTO, type ReferenceRole } from "../../lib/contracts";

const project: ProjectDTO = {
  id: "p1",
  kind: "program",
  title: "2027년 안동시 수출기업 역량강화 지원사업",
  topic: "안동시 수출기업 30개사 지원",
  region: "안동시",
  organizer: "(재)경상북도경제진흥원",
  contact: { 부서명: "북부지소", 전화: "054-900-3801", 이메일: "gepa_north@naver.com" },
  createdAt: "2026-09-16T00:00:00Z",
  updatedAt: "2026-09-16T00:00:00Z",
};
const ws = "/tmp/ws";

describe("buildStagePrompt — reference plan and 보충 조사 option", () => {
  it("plan stage has no research tools by default and forbids 보충 조사", () => {
    const p = buildStagePrompt({ stage: "plan", project, workspaceDir: ws });
    expect(p.allowedTools).toEqual(["Read", "Write", "Glob", "Grep"]);
    expect(p.prompt).toContain("보충 조사는 하지 않는다");
    expect(p.prompt).not.toContain("reference/base-plan.md");
  });
  it("supplementalResearch re-enables Task/WebSearch/WebFetch with a 2-call cap", () => {
    const p = buildStagePrompt({ stage: "plan", project, workspaceDir: ws, supplementalResearch: true });
    expect(p.allowedTools).toContain("Task");
    expect(p.prompt).toContain("최대 2회");
  });
  it("an uploaded 기존 사업계획서 is announced in the brief and guides research/plan/notice", () => {
    const withRef: ProjectDTO = { ...project, reference: { fileName: "2026 계획서.hwp", changes: "연도 2027, 30개사" } };
    for (const stage of ["research", "plan", "notice", "press"] as const) {
      const p = buildStagePrompt({ stage, project: withRef, workspaceDir: ws });
      expect(p.prompt).toContain(`${ws}/reference/base-plan.md`);
      expect(p.prompt).toContain("연도 2027, 30개사");
    }
    expect(buildStagePrompt({ stage: "research", project: withRef, workspaceDir: ws }).prompt).toContain("바뀌는 내용과 관련된 최신 근거");
    expect(buildStagePrompt({ stage: "plan", project: withRef, workspaceDir: ws }).prompt).toContain("골격");
  });
});

describe("official 단계 프롬프트", () => {
  const p = buildStagePrompt({
    stage: "official",
    project: { id: "x", kind: "official", title: "t", topic: "제출 요청", region: "경상북도", organizer: "(재)경상북도경제진흥원", contact: { 부서명: "전략기획팀", 전화: "054-470-8527", 이메일: "a@gepa.kr" }, createdAt: "", updatedAt: "" },
    workspaceDir: "/tmp",
  });
  it("공문서 작성자를 부르고 시행번호를 만들지 말라고 지시한다", () => {
    expect(p.systemPromptAppend).toContain("공문서");
    expect(p.systemPromptAppend + p.prompt).toMatch(/시행번호|일련번호/);
  });

  /**
   * 전결은 결재란과 발신명의를 함께 정한다 — 화면이 contact 에 얹어 보낸 값이 브리프를 거쳐
   * front-matter 까지 가야 한다(수신유형과 같은 길). 중간에 끊기면 문서가 조용히 기본 단계로 나간다.
   */
  it("contact 의 전결을 브리프에 싣고 front-matter 에 옮기라고 지시한다", () => {
    const q = buildStagePrompt({
      stage: "official",
      project: { id: "x", kind: "official", title: "t", topic: "제출 요청", region: "경상북도", organizer: "(재)경상북도경제진흥원", contact: { 부서명: "마케팅팀", 전화: "054-470-8527", 이메일: "a@gepa.kr", 전결: "원장" }, createdAt: "", updatedAt: "" },
      workspaceDir: "/tmp",
    });
    expect(q.prompt).toMatch(/^전결: 원장$/m); // 브리프의 한 줄
    expect(q.prompt).toContain("front-matter 의 전결");
    // 발신명의·결재라인은 전결에서 파생되므로 비워 두라고 해야 한다
    expect(q.prompt).toContain("발신명의와 결재라인은 비워 둔다");
  });

  it("전결이 없는(예전 방식) 프로젝트에는 브리프에 전결 줄을 만들지 않는다", () => {
    // 지시문에는 `위 "전결: …" 줄` 이라는 안내가 늘 있으므로 브리프 줄만 본다
    expect(p.prompt).not.toMatch(/^전결: (실·단장|본부장|원장)$/m);
  });

/**
   * 결문의 우편번호·전송(user 2026-09-22): 담당 줄(네 단계가 함께 쓴다)을 늘리지 않고 수신유형·
   * 전결처럼 따로 한 줄씩 두고, front-matter 의 연락처 객체(우편번호·주소·전화·전송·이메일)로
   * 옮기라는 지시가 그 줄들을 가리켜야 한다.
   */
  it("우편번호·전송이 있으면 브리프에 따로 한 줄씩 실리고 지시문이 그 줄을 가리킨다", () => {
    const q = buildStagePrompt({
      stage: "official",
      project: {
        id: "x",
        kind: "official",
        title: "t",
        topic: "제출 요청",
        region: "경상북도",
        organizer: "(재)경상북도경제진흥원",
        contact: { 부서명: "전략기획팀", 전화: "054-470-8527", 전송: "054-472-2989", 이메일: "a@gepa.kr", 우편주소: "경상북도 안동시 북순환로 387", 우편번호: "39393" },
        createdAt: "",
        updatedAt: "",
      },
      workspaceDir: "/tmp",
    });
    expect(q.prompt).toMatch(/^전송: 054-472-2989$/m);
    expect(q.prompt).toMatch(/^우편번호: 39393$/m);
    // 담당 줄 자체는 늘리지 않는다 — 전화 뒤에 곧장 슬래시·이메일이 와야 한다(전송이 끼어들지 않는다)
    expect(q.prompt).toMatch(/☎ 054-470-8527 \/ a@gepa\.kr/);
    expect(q.prompt).toContain("연락처 객체: 우편번호·주소·홈페이지·전화·전송·이메일");
    expect(q.prompt).toContain('"전송: …" 줄이 있으면 연락처의 전송에');
    expect(q.prompt).toContain('"우편번호: …" 줄이 있으면 연락처의 우편번호에');
  });

  it("우편번호·전송이 없으면 브리프에 그 줄 자체가 없다", () => {
    expect(p.prompt).not.toMatch(/^전송: /m);
    expect(p.prompt).not.toMatch(/^우편번호: /m);
  });

  /**
   * 값이 있어도 공문이 아니면 실리지 않는다. 폼의 전송·우편번호 칸은 공용 연락처 구역에 있고
   * 브라우저 기억으로 prefill 되므로, 공문을 한 번 만든 담당자가 다음에 세운 사업계획서
   * 프로젝트가 그 값을 물려받는다. kind 로 막지 않으면 얼어붙은 세 family 의 프롬프트가 조용히 바뀐다.
   *
   * **결문 전용 칸 네 개를 한꺼번에 본다**(전송·우편번호·홈페이지·공개구분). 이 branch 에서만
   * 같은 꼴의 누수가 세 번 나왔다 — 전송·우편번호(5a37bf3), 참고 문서 문구(Task 7), 그리고
   * 홈페이지·공개구분. 칸이 늘 때마다 여기 목록에 더한다.
   *
   * 업무보고도 함께 돌린다: 업무보고에는 결문이 없어서 네 칸 모두 쓸 데가 없고, 화면의
   * 연락처 구역은 공용이라 앞서 만든 공문의 값이 그대로 따라온다.
   */
  it("공문이 아닌 프로젝트는 결문 전용 값이 있어도 브리프에 싣지 않는다", () => {
    const 물려받은: ProjectDTO = {
      ...project,
      contact: { ...project.contact, 전송: "054-472-2989", 우편번호: "39393", 홈페이지: "https://gepa.kr", 공개구분: "비공개" },
    };
    const 결문칸 = [/^전송: /m, /^우편번호: /m, /^홈페이지: /m, /^공개구분: /m];
    for (const stage of ["plan", "notice", "press", "report"] as const) {
      const q = buildStagePrompt({ stage, project: { ...물려받은, kind: stage === "report" ? "report" : "program" }, workspaceDir: ws });
      for (const 칸 of 결문칸) expect(q.prompt, `${stage} ${칸}`).not.toMatch(칸);
    }
    // 같은 값이 공문에서는 실려야 한다 — 막는 조건이 kind 이지 값의 유무가 아님을 고정한다
    const 공문 = buildStagePrompt({ stage: "official", project: { ...물려받은, kind: "official" }, workspaceDir: ws });
    expect(공문.prompt).toMatch(/^전송: 054-472-2989$/m);
    expect(공문.prompt).toMatch(/^우편번호: 39393$/m);
    expect(공문.prompt).toMatch(/^홈페이지: https:\/\/gepa\.kr$/m);
    expect(공문.prompt).toMatch(/^공개구분: 비공개$/m);
  });

  /**
   * 홈페이지·공개구분은 **비면 줄 자체가 없어야 한다.** 빈 줄("홈페이지: ")을 실으면 에이전트가
   * 그 자리를 채울 값을 찾으려 들고, 스키마 기본값이 사라진 홈페이지는 특히 지어내기 쉽다.
   */
  it("공문이라도 값이 비면 그 줄 자체가 없다", () => {
    const q = buildStagePrompt({ stage: "official", project: { ...project, kind: "official" }, workspaceDir: ws });
    expect(q.prompt).not.toMatch(/^홈페이지: /m);
    expect(q.prompt).not.toMatch(/^공개구분: /m);
    // 대신 빈 칸을 비워 두라는 지시가 프롬프트에 있다(없는 주소를 지어내는 것이 이 자리의 위험이다)
    expect(q.prompt).toContain("그 줄이 없으면 그 칸을 비워 둔다");
  });
});

/**
 * 공문에 붙인 참고 문서(user 2026-09-22). 같은 파일이 세 가지로 쓰인다 — 내용 근거자료·받은 공문
 * (회신용)·붙임 문서 그 자체 — 그래서 용도 이름이 브리프에 그대로 드러나고 지시가 그 값으로 갈린다.
 */
describe("buildStagePrompt — 공문에 붙인 참고 문서의 용도", () => {
  const 공문 = (참고문서용도?: ReferenceRole, changes = "붙임 이름"): ProjectDTO => ({
    ...project,
    kind: "official",
    contact: { ...project.contact, 수신유형: "수신자", 수신: "경상북도지사", ...(참고문서용도 ? { 참고문서용도 } : {}) },
    reference: { fileName: "서식.hwp", changes },
  });
  const 프롬프트 = (p: ProjectDTO) => buildStagePrompt({ stage: "official", project: p, workspaceDir: ws }).prompt;

  /** 용도 이름이 브리프에 그대로 드러나고, changes 줄의 이름이 폼의 label 과 같다 */
  it.each([
    ["근거자료", "이 문서에서 쓸 내용", "공문 본문은 1쪽 분량으로 줄인다"],
    ["받은공문", "회신 취지", "관련 회신으로 적는다"],
    // 붙임은 front-matter 목록으로 간다 — 본문에 직접 타이핑하면 작성기가 만드는 결문 붙임 줄과 겹친다
    ["붙임", "붙임에 적을 이름", "front-matter 의 붙임 목록"],
  ] as const)("용도 %s 는 브리프 줄과 그 용도의 지시를 싣는다", (역할, 라벨, 고유문구) => {
    const p = 프롬프트(공문(역할, "적어 둔 값"));
    expect(p).toMatch(new RegExp(`^참고 문서\\(용도: ${역할}\\): ${ws}/reference/base-plan.md \\(원본 파일 서식.hwp\\)$`, "m"));
    expect(p).toMatch(new RegExp(`^${라벨}: 적어 둔 값$`, "m"));
    expect(p).toContain(고유문구);
    // 폼 label 과 프롬프트 줄 이름은 한 벌에서 온다 — 갈라지면 담당자가 적은 칸과 이름이 달라진다
    expect(라벨).toBe(REFERENCE_CHANGES_LABEL[역할]);
    // 사업계획서 전용 문구가 공문으로 새지 않는다
    expect(p).not.toContain("기존 사업계획서:");
    expect(p).not.toContain("이번에 바뀌는 내용:");
  });

  it("changes 가 비면 둘째 줄을 아예 싣지 않는다(사업계획서 쪽 '(미기재…)' 기본 문구를 쓰지 않는다)", () => {
    const p = 프롬프트(공문("붙임", ""));
    expect(p).toContain("참고 문서(용도: 붙임)");
    expect(p).not.toMatch(/^붙임에 적을 이름: /m);
    expect(p).not.toContain("미기재");
  });

  it("용도가 없으면(파일만 있을 때) 근거자료와 같이 다룬다", () => {
    const 없음 = 프롬프트(공문(undefined, "쓸 내용"));
    expect(없음).toMatch(/^참고 문서\(용도: 근거자료\): /m);
    expect(없음).toMatch(/^이 문서에서 쓸 내용: 쓸 내용$/m);
    expect(없음).toBe(프롬프트(공문("근거자료", "쓸 내용")));
  });

  /**
   * 회귀: 얼어붙은 세 family 로 가는 프롬프트는 바이트 그대로여야 한다. 용도 분기는 공문에서만 탄다.
   */
  it("program 프로젝트의 plan·notice·press 는 기존 reference 문구 그대로다", () => {
    const withRef: ProjectDTO = { ...project, reference: { fileName: "2026 계획서.hwp", changes: "연도 2027" } };
    for (const stage of ["plan", "notice", "press"] as const) {
      const p = buildStagePrompt({ stage, project: withRef, workspaceDir: ws }).prompt;
      expect(p, stage).toContain(`기존 사업계획서: ${ws}/reference/base-plan.md (원본 파일 2026 계획서.hwp) — 이번 프로젝트는 이 계획서를 갱신하는 것이다.`);
      expect(p, stage).toContain("이번에 바뀌는 내용: 연도 2027");
      expect(p, stage).not.toContain("참고 문서(용도:");
    }
    // changes 가 비었을 때의 기본 문구도 그대로 남는다
    const 빈변경: ProjectDTO = { ...project, reference: { fileName: "a.hwp", changes: "" } };
    expect(buildStagePrompt({ stage: "plan", project: 빈변경, workspaceDir: ws }).prompt).toContain("이번에 바뀌는 내용: (미기재 — 연도·일정·담당만 갱신)");
  });
});

/**
 * 주요업무보고(report) 단계. 담당자가 한글에서 보고 정한 서식 셋이 프롬프트에 살아 있어야 한다:
 * 1단계는 `●`(`ㅇ` 아님), 목차 쪽번호는 짓지 않는다, 요약박스는 요약문으로 시작하는 절에만 단다.
 */
describe("report 단계 프롬프트", () => {
  const 업무보고: ProjectDTO = {
    id: "r1",
    kind: "program",
    title: "2026년 주요업무보고",
    topic: "2026년 주요업무 추진실적 및 계획",
    region: "경상북도",
    organizer: "(재)경상북도경제진흥원",
    contact: { 부서명: "경영기획실", 전화: "054-470-8527", 이메일: "a@gepa.kr" },
    createdAt: "",
    updatedAt: "",
  };
  const p = buildStagePrompt({ stage: "report", project: 업무보고, workspaceDir: ws });

  it("업무보고 작성자를 부르고 전용 규격 스킬을 가리킨다", () => {
    expect(p.systemPromptAppend).toContain("주요업무보고 작성자");
    expect(p.systemPromptAppend).toContain("gepa-report-design");
    // 공고가 아니라 실적·계획이라는 것이 역할 문장에 있어야 한다
    expect(p.systemPromptAppend).toContain("실적과 계획");
  });

  it("사다리 세 칸을 가르치고 ㅇ 를 막는다", () => {
    expect(p.prompt).toContain("□ → ● → -");
    expect(p.prompt).toContain("ㅇ 은 쓰지 않는다");
    expect(p.prompt).toContain("1단계는 언제나 ●");
  });

  /** 결재에 올라가는 문서다 — 쪽번호를 지어내면 틀린 번호가 그대로 실린다 */
  it("목차를 직접 쓰게 하되 쪽번호는 짓지 말라고 한다", () => {
    expect(p.prompt).toContain("```toc");
    expect(p.prompt).toContain("쪽번호를 적지 않는다");
    expect(p.systemPromptAppend).toContain("―(U+2015)");
  });

  it("요약박스는 요약문으로 시작하는 절에만 달라고 한다", () => {
    expect(p.prompt).toContain("```box");
    expect(p.prompt).toContain("목록이나 표로 시작하는 절에는 박스를 두지 않는다");
  });

  it("근거 없는 수치를 막고 날짜를 지어내지 못하게 한다", () => {
    expect(p.prompt).toContain("추진 중");
    expect(p.prompt).toContain("날짜나 받는 사람을 지어내지 않는다");
  });

  it("출력 계약은 report/draft.dsl.md 와 family: report 다", () => {
    expect(p.prompt).toContain(`${ws}`);
    expect(p.prompt).toContain("<작업폴더>/report/draft.dsl.md");
    expect(p.prompt).toContain("family: report");
    expect(p.allowedTools).toEqual(["Read", "Write", "Glob", "Grep"]);
  });

  /** 조사 단계가 없는 문서다 — 웹·하위 에이전트 도구가 새면 안 된다 */
  it("조사 도구를 주지 않는다", () => {
    for (const tool of ["WebSearch", "WebFetch", "Task"]) expect(p.allowedTools).not.toContain(tool);
  });

  /**
   * 회귀: report 분기를 더해도 얼어붙은 네 family 의 프롬프트는 한 글자도 달라지지 않는다.
   * projectBrief·referenceGuide 를 함께 쓰므로 여기서 한 번 더 못박는다.
   */
  it("기존 네 단계의 프롬프트는 그대로다", () => {
    for (const stage of ["plan", "notice", "press", "official"] as const) {
      const q = buildStagePrompt({ stage, project, workspaceDir: ws });
      expect(q.prompt, stage).not.toContain("주요업무보고");
      expect(q.systemPromptAppend, stage).not.toContain("gepa-report-design");
    }
  });
});

/**
 * 업무보고에 붙인 참고 문서 (Task 7 판정, Task 6 구현자가 미리 짚음).
 *
 * `projectBrief` 의 reference 분기는 "공문이면 … 아니면 기존 사업계획서" 두 갈래였다.
 * `report` kind 가 생기는 순간 그 `아니면` 이 업무보고까지 삼켜서, 참고 문서를 붙인
 * 업무보고 프로젝트에 **"이번 프로젝트는 이 계획서를 갱신하는 것이다"** 가 실리고
 * `referenceGuide` 는 빈 문자열을 돌려준다 — 에이전트는 업무보고를 사업계획서 갱신으로
 * 읽고 아무 오류 없이 틀린 문서를 쓴다. 공문의 전송·우편번호 누수와 같은 부류다.
 *
 * 값이 있어도 안 실리는 것과, 같은 값이 제 family 에서는 실리는 것을 함께 고정한다.
 */
describe("buildStagePrompt — 업무보고에 붙인 참고 문서", () => {
  const 업무보고: ProjectDTO = {
    ...project,
    kind: "report",
    title: "2026년 주요업무보고",
    topic: "2026년 주요업무보고",
    reference: { fileName: "2025년 주요업무보고.hwp", changes: "2025년 추진성과와 조직 현황만 추려서 씀" },
  };
  const p = buildStagePrompt({ stage: "report", project: 업무보고, workspaceDir: ws });

  it("사업계획서 갱신 문구가 업무보고로 새지 않는다", () => {
    expect(p.prompt).not.toContain("기존 사업계획서");
    expect(p.prompt).not.toContain("갱신하는 것이다");
    expect(p.prompt).not.toMatch(/^이번에 바뀌는 내용: /m);
    expect(p.prompt).not.toContain("(미기재 — 연도·일정·담당만 갱신)");
  });

  it("참고 문서 줄과 단계 지시가 함께 실린다 — 붙인 문서가 프롬프트에서 사라지면 안 된다", () => {
    expect(p.prompt).toMatch(/^참고 문서: \/tmp\/ws\/reference\/base-plan\.md \(원본 파일 2025년 주요업무보고\.hwp\)$/m);
    // 화면 label·base-plan.md 의 절 제목과 같은 이름을 쓴다(lib/contracts.ts 가 단일 출처)
    expect(p.prompt).toMatch(new RegExp(`^${REFERENCE_CHANGES_LABEL["근거자료"]}: 2025년 추진성과와 조직 현황만 추려서 씀$`, "m"));
    expect(p.prompt).toContain(`${ws}/reference/base-plan.md 를 먼저 Read`);
  });

  /**
   * 업무보고의 참고 문서는 대개 **지난해 업무보고**다. 그 Ⅱ장은 지나간 실적이므로("2025년도
   * 추진성과 … 944개사, 2,771억원"), "지난 연도 표기를 이번 보고 기준으로 고친다"고만 적으면
   * 에이전트가 그 숫자에 올해 연도를 붙인다 — 있지도 않은 실적이 결재에 올라간다.
   * 고쳐도 되는 연도와 그대로 둘 연도를 지시가 갈라 두는지 여기서 고정한다.
   */
  it("실적 수치의 연도를 옮겨 붙이지 말라고 이른다", () => {
    expect(p.prompt).toContain("연도를 옮겨 붙이지 않는다");
    expect(p.prompt).toContain("실적 수치와 그 실적이 일어난 연도는 참고 문서에 적힌 그대로 둔다");
  });

  it("용도를 묻지 않는다 — 업무보고에는 수신유형·전결·참고문서용도가 없다", () => {
    expect(p.prompt).not.toContain("용도:");
    expect(p.prompt).not.toMatch(/^수신유형: /m);
    expect(p.prompt).not.toMatch(/^전결: /m);
  });

  it("붙인 문서가 없으면 참고 문서 줄 자체가 없다", () => {
    const q = buildStagePrompt({ stage: "report", project: { ...업무보고, reference: undefined }, workspaceDir: ws });
    expect(q.prompt).not.toMatch(/^참고 문서: /m);
    expect(q.prompt).not.toContain("base-plan.md");
  });

  it("같은 reference 가 사업 프로젝트에서는 기존 문구 그대로 실린다 — 막는 조건이 kind 다", () => {
    const 사업 = buildStagePrompt({ stage: "plan", project: { ...업무보고, kind: "program" }, workspaceDir: ws });
    expect(사업.prompt).toContain("이번 프로젝트는 이 계획서를 갱신하는 것이다.");
    expect(사업.prompt).toMatch(/^이번에 바뀌는 내용: 2025년 추진성과와 조직 현황만 추려서 씀$/m);
  });
});

/**
 * 업무보고가 내부 위키에 닿는지 (user 2026-09-22: "최근 3년간 비교나 전년 대비 등으로
 * 성과를 극대화해야").
 *
 * 그 전까지 `wikiDir` 은 `researchCapable`(조사·사업계획서)일 때만 설정됐고
 * `sourcesGuide` 도 그 두 단계에서만 불렸다 — **업무보고 에이전트는 위키가 있다는 사실조차
 * 몰랐다.** 도구(Read·Grep)는 있었지만 경로를 받지 못했고 샌드박스에도 붙지 않았다.
 * 그래서 「비교 기준이 있으면 쓴다」는 규칙이 영원히 발동하지 않는 상태였다.
 */
describe("업무보고 — 내부 위키", () => {
  const report: ProjectDTO = {
    id: "r1", kind: "report", title: "2026년 주요업무보고", topic: "x", region: "경상북도",
    organizer: "(재)경상북도경제진흥원", contact: { 부서명: "전략기획팀", 전화: "054-470-8527", 이메일: "a@gepa.kr" },
    createdAt: "", updatedAt: "",
  };

  it("위키가 붙으면 경로와 최근 3년 지시가 프롬프트에 실린다", () => {
    const p = buildStagePrompt({ stage: "report", project: report, workspaceDir: ws, wikiDir: "/tmp/wiki-snap" });
    expect(p.prompt).toContain("/tmp/wiki-snap");
    expect(p.prompt).toContain("최근 3년");
    expect(p.prompt, "읽는 법을 알려 줘야 한다").toMatch(/Grep/);
  });

  it("위키가 없으면 비교를 지어내지 말라고 한다", () => {
    // 경로가 없는데 비교를 요구하면 에이전트가 수치를 만들어 낸다 — 결재에 올라가는 문서다.
    const p = buildStagePrompt({ stage: "report", project: report, workspaceDir: ws });
    expect(p.prompt).toMatch(/비교 표기는 넣지 않는다/);
    expect(p.prompt).not.toContain("최근 3년 비교를 만든다");
  });

  it("얼어붙은 네 단계의 프롬프트는 wikiDir 로 바뀌지 않는다", () => {
    for (const stage of ["notice", "press", "official"] as const) {
      const kind = stage === "official" ? "official" : "program";
      const base = buildStagePrompt({ stage, project: { ...report, kind }, workspaceDir: ws });
      const withWiki = buildStagePrompt({ stage, project: { ...report, kind }, workspaceDir: ws, wikiDir: "/tmp/wiki-snap" });
      expect(withWiki.prompt, stage).toBe(base.prompt);
    }
  });
});
