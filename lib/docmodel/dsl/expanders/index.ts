import type { DocModel, Family } from "../../schema";
import { noticeContext } from "./notice";
import { officialContext } from "./official";
import { planContext } from "./plan";
import { pressContext } from "./press";
import type { FamilyContext } from "./types";

export type { BlockInput, FamilyContext } from "./types";
export * from "./notice";
export * from "./plan";
export * from "./press";
export * from "./official";

/** Family context (synthesized prelude + numbering/role defaults) for a validated meta. */
export function familyContext(family: Family, meta: DocModel["meta"]): FamilyContext {
  switch (family) {
    case "notice":
      return noticeContext(meta as Extract<DocModel, { family: "notice" }>["meta"]);
    case "plan":
      return planContext(meta as Extract<DocModel, { family: "plan" }>["meta"]);
    case "press":
      return pressContext(meta as Extract<DocModel, { family: "press" }>["meta"]);
    case "official":
      return officialContext();
  }
}
