/**
 * family별 문서 모델 층 사실을 한 곳에 모은 레지스트리.
 *
 * 새 family를 추가할 때 여기에 항목을 빠뜨리면 `Record<Family, DocFamilyDef>` 때문에
 * 컴파일이 실패한다. 예전에는 `family === "notice" ? … : family === "plan" ? … : PRESS`
 * 같은 삼항 연쇄여서, 새 family가 보도자료 설정을 조용히 물려받았다.
 *
 * hwpx 층(작성기 선택)은 lib/hwpx/families.ts 에 따로 둔다 — docmodel 은 hwpx 를 import 하지 않는다.
 */
import type { Family } from "./schema";

export interface DocFamilyDef {
  /** 사람이 읽는 이름 (UI·로그·오류 메시지) */
  label: string;
  /** 글머리 기호 → 앞 반각 공백 타수. 참고 문서 관행 사다리("gepa"). */
  indent: Record<string, number>;
  /**
   * ※ / * 참고가 바로 위 항목(ㅇ ○ ◦ -)에 딸릴 때의 들여쓰기.
   * undefined 면 보정하지 않는다.
   */
  noteIndentUnderItem?: number;
}

export const DOC_FAMILIES: Record<Family, DocFamilyDef> = {
  notice: {
    label: "공고문",
    indent: { "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 1 },
    noteIndentUnderItem: 4,
  },
  plan: {
    label: "사업계획서",
    indent: { "□": 1, "ㅇ": 2, "○": 2, "◦": 2, "-": 3, "·": 4, "※": 1, "*": 2 },
    noteIndentUnderItem: 3,
  },
  press: {
    label: "보도자료",
    indent: { "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 2 },
    noteIndentUnderItem: 4,
  },
};
