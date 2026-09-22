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
   */
  it("공문이 아닌 프로젝트는 전송·우편번호 값이 있어도 브리프에 싣지 않는다", () => {
    const 물려받은: ProjectDTO = {
      ...project,
      contact: { ...project.contact, 전송: "054-472-2989", 우편번호: "39393" },
    };
    for (const stage of ["plan", "notice", "press"] as const) {
      const q = buildStagePrompt({ stage, project: 물려받은, workspaceDir: ws });
      expect(q.prompt, stage).not.toMatch(/^전송: /m);
      expect(q.prompt, stage).not.toMatch(/^우편번호: /m);
    }
    // 같은 값이 공문에서는 실려야 한다 — 막는 조건이 kind 이지 값의 유무가 아님을 고정한다
    const 공문 = buildStagePrompt({ stage: "official", project: { ...물려받은, kind: "official" }, workspaceDir: ws });
    expect(공문.prompt).toMatch(/^전송: 054-472-2989$/m);
    expect(공문.prompt).toMatch(/^우편번호: 39393$/m);
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
    ["붙임", "붙임에 적을 이름", '"1부."'],
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
