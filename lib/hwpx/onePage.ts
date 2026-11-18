/**
 * 원페이지(간략) 업무보고가 한 쪽을 넘겼는지 — 뒷장 「참고 N」 쪽은 세지 않는다.
 *
 * 담당자 2026-11-18: 업무보고 형태를 「원페이지(간략) / 자동 + 우리 양식 중 골라 참조」로 정했다. 원페이지라는 이름을
 * 달았으니 본문이 정말 한 쪽에 끝나야 한다(장부 P3 "작년 문서처럼 한 장에"). 줄 간격으로는 문단 여럿을 당길 수 없어
 * 경고로 에이전트에게 돌려주고, 자동 다듬기(runIntegration)가 문장을 줄이거나 세부를 ☞ 참고 뒷장으로 뺀다.
 *
 * 한글이 읽어 준 쪽별 글(hangul.ts)을 쓴다. 「참고 N」 띠는 표라 쪽 글에 안 나오므로, 첫 참고 띠 다음 글 문단의
 * 앞부분이 처음 나오는 쪽을 참고의 시작 쪽으로 본다. 그 글을 못 찾으면 판정하지 않는다(틀린 경고보다 낫다).
 */
import type { Block, DocModel } from "../docmodel/schema";

const PROBE_LEN = 12;

const squash = (s: string) => s.replace(/\s+/g, "");

function paraText(b: Block): string {
  if (b.k === "sectionChip") return b.title;
  if (b.k !== "para") return "";
  return b.inlines.map((i) => (i.t === "br" ? "" : i.text)).join("");
}

/** 본문(참고 앞) 쪽 수. 판정할 수 없으면 null */
export function bodyPageCount(doc: DocModel, pageTexts: string[]): number | null {
  const refIdx = doc.blocks.findIndex((b) => b.k === "table" && b.role === "refHead");
  if (refIdx < 0) return pageTexts.length;
  const probeBlock = doc.blocks.slice(refIdx + 1).find((b) => squash(paraText(b)).length >= 4);
  if (!probeBlock) return null;
  const probe = squash(paraText(probeBlock)).slice(0, PROBE_LEN);
  // 참고는 새 쪽에서 시작한다 — 첫 쪽(본문 첫머리)은 참고일 수 없으니 둘째 쪽부터 찾는다
  for (let p = 1; p < pageTexts.length; p++) if (squash(pageTexts[p]).includes(probe)) return p;
  return null;
}

export function onePageWarnings(doc: DocModel, pageTexts: string[]): string[] {
  if (doc.family !== "report" || doc.meta.형태 !== "간략") return [];
  const body = bodyPageCount(doc, pageTexts);
  if (body === null || body <= 1) return [];
  return [
    `[한 장 넘침] 원페이지(간략) 보고인데 본문이 ${body}쪽이다(뒷장 참고 제외) — 본문을 한 쪽에 끝낸다. 되풀이·경위·어디에나 붙는 배경 문구를 줄이고, 길지만 근거로 꼭 필요한 세부(기준표·명세·연도별 현황)는 본문에 요지만 두고 ☞ 참고 N 으로 뒷장에 뺀다. 자료에 있는 사실(기간·수량·금액·일정)은 빼지 않는다`,
  ];
}
