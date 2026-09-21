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
import type { DocModel, Family, NoticeDoc, PlanDoc, PressDoc } from "../docmodel/schema";
import type { WriterContext } from "./writers/context";
import type { XmlNode } from "./xml";
import { writeNotice } from "./writers/notice";
import { writePlan } from "./writers/plan";
import { writePress } from "./writers/press";

export interface HwpxFamilyDef {
  write(ctx: WriterContext, doc: DocModel): XmlNode[];
}

export const HWPX_FAMILIES: Record<Family, HwpxFamilyDef> = {
  notice: { write: (ctx, doc) => writeNotice(ctx, doc as NoticeDoc) },
  plan: { write: (ctx, doc) => writePlan(ctx, doc as PlanDoc) },
  press: { write: (ctx, doc) => writePress(ctx, doc as PressDoc) },
};
