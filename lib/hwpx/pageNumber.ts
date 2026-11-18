/**
 * 한 장짜리 문서의 쪽번호 빼기.
 *
 * 담당자 2026-11-18: "한장짜리 보고자료에는 따로 쪽번호를 넣지 않는게 좋아. 1장짜리인데 1이라고 표시할 필요가 없다."
 * 쪽번호는 꼬리말 자리에 찍혀 본문 배치에는 영향이 없다 — 빼도 쪽 넘김은 그대로다.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";

const PAGE_NUM_CTRL = /<hp:ctrl>\s*<hp:pageNum\b[^>]*\/>\s*<\/hp:ctrl>/g;
const SECTION = /^Contents\/section\d+\.xml$/;

/** 구역 XML 에서 쪽번호 컨트롤을 뺀다 */
export function stripPageNumberXml(xml: string): string {
  return xml.replace(PAGE_NUM_CTRL, "");
}

/** hwpx 의 모든 구역에서 쪽번호 컨트롤을 뺀다. 없으면 그대로 돌려준다 */
export function dropPageNumber(bytes: Uint8Array): { bytes: Uint8Array; removed: boolean } {
  const entries = unzipSync(bytes);
  let removed = false;
  const out: Zippable = {};
  for (const [name, data] of Object.entries(entries)) {
    let d = data;
    if (SECTION.test(name)) {
      const xml = strFromU8(data);
      const next = stripPageNumberXml(xml);
      if (next !== xml) {
        removed = true;
        d = strToU8(next);
      }
    }
    out[name] = name === "mimetype" ? [d, { level: 0 }] : [d, { level: 6 }];
  }
  if (!removed) return { bytes, removed };
  return { bytes: zipSync(out, { mtime: new Date("1980-01-01T00:00:00Z") }), removed };
}
