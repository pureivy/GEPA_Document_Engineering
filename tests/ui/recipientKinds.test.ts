/**
 * 공문 수신유형 드리프트 가드 — 화면(ProjectList)의 옵션·front-matter 키 매핑이 OfficialMetaSchema
 * 의 수신유형 enum 과 항상 같은 집합인지 검사한다. 한쪽에 값이 늘거나 줄거나 이름이 바뀌면 실패해야
 * 한다(예전에 화면이 손으로 베낀 배열을 따로 갖고 있다가 스키마와 조용히 갈라진 적이 있었다).
 */
import { describe, expect, it } from "vitest";
import { OfficialMetaSchema } from "../../lib/docmodel/schema";
import { DEFAULT_DELEGATION, DELEGATION_LEVELS, DISCLOSURE_KINDS, RECIPIENT_KEY, RECIPIENT_KINDS } from "../../components/pipeline/ProjectList";

describe("공문 수신유형 — 화면과 스키마가 같은 집합인지", () => {
  it("ProjectList 의 RECIPIENT_KINDS 가 OfficialMetaSchema 의 수신유형 enum 과 정확히 같다", () => {
    const schemaValues = OfficialMetaSchema.shape.수신유형.options;
    expect(new Set(RECIPIENT_KINDS)).toEqual(new Set(schemaValues));
    expect(RECIPIENT_KINDS.length).toBe(schemaValues.length);
  });

  it("RECIPIENT_KEY 가 수신유형 값마다 정확히 하나씩 커버한다 — 빠지면 그 수신유형은 문서에 수신 대상 없이 나간다", () => {
    const schemaValues = OfficialMetaSchema.shape.수신유형.options;
    expect(new Set(Object.keys(RECIPIENT_KEY))).toEqual(new Set(schemaValues));
  });

  it("수신자 → 수신, 수신자참조 → 수신자, 내부결재 → 수신 대상 없음", () => {
    expect(RECIPIENT_KEY.수신자).toBe("수신");
    expect(RECIPIENT_KEY.수신자참조).toBe("수신자");
    expect(RECIPIENT_KEY.내부결재).toBe("");
  });
});

/**
 * 전결 단계도 같은 드리프트 가드 — 값은 lib/org.ts 에 한 벌만 두고 화면(ProjectList)과
 * OfficialMetaSchema 가 그것을 쓴다. 스키마 쪽은 zod 내부(`.def.innerType`)를 들추지 않고
 * **실제로 파싱되는지**로 확인한다: 그게 문서가 실제로 겪는 판정이다.
 */
describe("공문 전결 — 화면과 스키마가 같은 집합인지", () => {
  const base = { 수신유형: "내부결재", 제목: "가", 처리과: "마케팅팀" };

  it("화면이 내놓는 단계는 모두 스키마를 통과한다", () => {
    for (const level of DELEGATION_LEVELS) expect(OfficialMetaSchema.safeParse({ ...base, 전결: level }).success, level).toBe(true);
  });

  it("목록 밖의 직위는 스키마가 거절한다 — 화면에 없는 값이 문서로 새지 않는다", () => {
    for (const bad of ["팀장", "지소장", "실장", ""]) expect(OfficialMetaSchema.safeParse({ ...base, 전결: bad }).success, bad).toBe(false);
  });

  it("전결을 적지 않으면 화면의 기본값과 같은 단계가 된다", () => {
    expect(OfficialMetaSchema.parse(base).전결).toBe(DEFAULT_DELEGATION);
    expect(DELEGATION_LEVELS).toContain(DEFAULT_DELEGATION);
  });
});

/**
 * 공개구분도 같은 드리프트 가드 (user 2026-09-22). 결문 오른쪽 끝 칸이고 비공개 문서를 `공개` 로
 * 내보내면 되돌릴 수 없어서 화면에서 고르게 했다 — 화면의 목록과 스키마가 갈라지면 고를 수 없는
 * 값이 생기거나(화면에 없는데 스키마는 받는다) 문서가 거절된다(화면에 있는데 스키마가 막는다).
 *
 * **세 번째 자리를 여기서 함께 못박는다**: `app/api/projects/route.ts` 의 `contactSchema` 는
 * 이 enum 을 **손으로 다시 적는다**(스키마 필드를 빌려 오면 `.default("공개")` 가 딸려 와
 * 공문이 아닌 프로젝트에까지 공개구분이 저장된다 — 전결에서 겪은 그대로다). 그래서 그 리터럴과
 * 같은 집합인지도 여기서 본다.
 */
describe("공문 공개구분 — 화면·스키마·생성 라우트가 같은 집합인지", () => {
  const base = { 수신유형: "내부결재", 제목: "가", 처리과: "마케팅팀" };
  /** app/api/projects/route.ts 의 contactSchema.공개구분 이 손으로 적고 있는 값 */
  const ROUTE_LITERAL = ["공개", "부분공개", "비공개"];

  it("화면이 내놓는 값은 모두 스키마를 통과한다", () => {
    for (const d of DISCLOSURE_KINDS) expect(OfficialMetaSchema.safeParse({ ...base, 공개구분: d }).success, d).toBe(true);
  });

  it("목록 밖의 값은 스키마가 거절한다", () => {
    for (const bad of ["대외비", "공개보류", ""]) expect(OfficialMetaSchema.safeParse({ ...base, 공개구분: bad }).success, bad).toBe(false);
  });

  it("생성 라우트가 손으로 적은 리터럴과 같은 집합이다", () => {
    expect(new Set(DISCLOSURE_KINDS)).toEqual(new Set(ROUTE_LITERAL));
    expect(DISCLOSURE_KINDS.length).toBe(ROUTE_LITERAL.length);
  });

  it("적지 않으면 공개가 기본값이다 — 화면의 첫 항목과 같아야 한다", () => {
    expect(OfficialMetaSchema.parse(base).공개구분).toBe("공개");
    expect(DISCLOSURE_KINDS[0]).toBe("공개");
  });
});
