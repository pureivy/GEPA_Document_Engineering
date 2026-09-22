/**
 * 공문 수신유형 드리프트 가드 — 화면(ProjectList)의 옵션·front-matter 키 매핑이 OfficialMetaSchema
 * 의 수신유형 enum 과 항상 같은 집합인지 검사한다. 한쪽에 값이 늘거나 줄거나 이름이 바뀌면 실패해야
 * 한다(예전에 화면이 손으로 베낀 배열을 따로 갖고 있다가 스키마와 조용히 갈라진 적이 있었다).
 */
import { describe, expect, it } from "vitest";
import { OfficialMetaSchema } from "../../lib/docmodel/schema";
import { RECIPIENT_KEY, RECIPIENT_KINDS } from "../../components/pipeline/ProjectList";

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
