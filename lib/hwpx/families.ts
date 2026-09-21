/**
 * family → HWPX 작성기. build.ts 의 if/else 를 대신한다.
 *
 * 예전에는 `if (notice) … else if (plan) … else writePress(…)` 였다. 새 family가 조용히
 * 보도자료 작성기로 렌더되어, 검증을 통과하는 잘못된 문서가 나왔다.
 * Record<Family, …> 이므로 이제는 항목을 빠뜨리면 컴파일이 실패한다.
 *
 * templates/<dir> 매핑은 lib/hwpx/template.ts 의 TEMPLATE_FAMILY 에 남겨 둔다 —
 * 이미 Record<Family, string> 이고, 여기로 옮기면 순환 import 가 생긴다.
 */
import type { DocModel, Family } from "../docmodel/schema";
import type { WriterContext } from "./writers/context";
import type { XmlNode } from "./xml";
import { writeNotice } from "./writers/notice";
import { writePlan } from "./writers/plan";
import { writePress } from "./writers/press";

/**
 * `write` 는 프로퍼티(화살표 함수) 타입으로 선언한다 — 메서드 표기(`write(ctx, doc): …`)는
 * TS가 이변성(bivariant)으로 검사해 잘못 연결된 작성기도 조용히 컴파일된다. 프로퍼티 표기여야
 * strictFunctionTypes 의 반변(contravariant) 검사가 걸려, family 를 바꿔치기하면 타입 오류가 난다.
 */
export type HwpxFamilyTable = {
  [F in Family]: {
    write: (ctx: WriterContext, doc: Extract<DocModel, { family: F }>) => XmlNode[];
  };
};

export const HWPX_FAMILIES: HwpxFamilyTable = {
  notice: { write: writeNotice },
  plan: { write: writePlan },
  press: { write: writePress },
};
