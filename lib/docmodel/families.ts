/**
 * family별 문서 모델 층 사실을 한 곳에 모은 레지스트리.
 *
 * 새 family를 추가할 때 여기에 항목을 빠뜨리면 `Record<Family, DocFamilyDef>` 때문에
 * 컴파일이 실패한다. 예전에는 `family === "notice" ? … : family === "plan" ? … : PRESS`
 * 같은 삼항 연쇄여서, 새 family가 보도자료 설정을 조용히 물려받았다.
 *
 * hwpx 층(작성기 선택)은 lib/hwpx/families.ts 에 따로 둔다 — docmodel 은 hwpx 를 import 하지 않는다.
 */
import type { DocModel, Family } from "./schema";

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
  /** HWPX 문서 제목과 내보내기 파일명에 쓰는 제목 */
  docTitle(doc: DocModel): string;
  /**
   * 다운로드 파일명 베이스(확장자 제외). family마다 다른 접미사 규칙을
   * 삼항 연쇄로 두면 새 family가 마지막 분기(보도자료)를 조용히 물려받는다
   * (app/api/projects/[id]/stages/[stage]/download/route.ts).
   */
  exportBaseName(doc: DocModel): string;
  /**
   * `#` / `##` 제목을 어떤 블록으로 펼치는가.
   *   "chapterChip" = 사업계획서(장 띠 + 절 칩)
   *   "sectionBar"  = 공고문(번호 섹션바)
   *   "none"        = 제목 문법을 쓰지 않는 family(보도자료)
   *
   * "none" 인 family 는 반드시 확장기의 FamilyContext.allowHeadings 도 false 여야 한다
   * (lib/docmodel/dsl/expanders/press.ts:16). 둘이 어긋나면 parser.ts:509 를 통과해
   * `#` 이 조용히 공고문 섹션바로 펼쳐진다.
   */
  headingStyle: "sectionBar" | "chapterChip" | "none";
  /**
   * 본문 끝에 붙임 표시와 `끝.` 을 요구하는가.
   * 행정업무규정 시행규칙 제4조제4·5항 — 발신하는 문서와 내부결재문서에 적용된다.
   * 보도자료는 공문서가 아니므로 해당 없음.
   */
  requiresClosingMark: boolean;
}

export const DOC_FAMILIES: Record<Family, DocFamilyDef> = {
  notice: {
    label: "공고문",
    indent: { "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 1 },
    noteIndentUnderItem: 4,
    docTitle: (doc) => {
      const m = doc.meta as Extract<DocModel, { family: "notice" }>["meta"];
      return `「${m.사업명}」 ${m.모집대상} 모집 공고`;
    },
    exportBaseName: (doc) => (doc.meta as Extract<DocModel, { family: "notice" }>["meta"]).사업명 + "_공고문",
    headingStyle: "sectionBar",
    requiresClosingMark: true,
  },
  plan: {
    label: "사업계획서",
    indent: { "□": 1, "ㅇ": 2, "○": 2, "◦": 2, "-": 3, "·": 4, "※": 1, "*": 2 },
    noteIndentUnderItem: 3,
    docTitle: (doc) => (doc.meta as Extract<DocModel, { family: "plan" }>["meta"]).제목,
    exportBaseName: (doc) => (doc.meta as Extract<DocModel, { family: "plan" }>["meta"]).제목,
    headingStyle: "chapterChip",
    requiresClosingMark: true,
  },
  press: {
    label: "보도자료",
    indent: { "□": 0, "ㅇ": 1, "○": 1, "◦": 1, "-": 3, "·": 4, "※": 2, "*": 2 },
    noteIndentUnderItem: 4,
    docTitle: (doc) => (doc.meta as Extract<DocModel, { family: "press" }>["meta"]).제목,
    exportBaseName: (doc) => (doc.meta as Extract<DocModel, { family: "press" }>["meta"]).제목 + "_보도자료",
    headingStyle: "none",
    requiresClosingMark: false,
  },
};
