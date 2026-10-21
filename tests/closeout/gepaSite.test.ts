import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coreTitle, keywordTokens, parsePost, parseSearchVids, readSavedGepaPosts, saveGepaPosts, searchGepaSite, searchQueries } from "@/lib/closeout/gepaSite";
import { projectYear } from "@/lib/closeout/webMaterials";

// gepa.kr 망보드 마크업을 줄인 것(2026-10-21 실측)
const LIST = `<div class="gallery-item-img"><a href="https://www.gepa.kr/?page_id=57&#038;search_field=all&#038;search_text=x&#038;vid=688" title="a"></a></div>
<div class="gallery-title"><a href="https://www.gepa.kr/?page_id=57&#038;search_field=all&#038;search_text=x&#038;vid=688"><div>a</div></a></div>
<a href="https://www.gepa.kr/?page_id=57&#038;vid=558">b</a>`;
const VIEW = (title: string, date: string, img = "F1_a.jpg") => `<div class="mb-vew-title"><span>${title}</span></div>
<span class="mb-label-style1">작성일</span><span class="mb-text-style1">${date}</span>
<span class="mb-label-style1">분류</span><span class="mb-text-style1">행사</span>
<table><tr><td class="content-box text-left" colspan="2"><p><img src="https://www.gepa.kr/wp-content/uploads/mangboard/2025/12/02/${img}" alt="x" /><br />🔹 일시: 2025년 11월 26일(수) 17:00 ~</p><p>장소: 경북도청 &#40;동락관&#41;</p></td></tr></table>`;

describe("gepa.kr 홈페이지 자료", () => {
  it("사업명에서 꾸밈을 떼고 검색어를 만든다", () => {
    expect(coreTitle("[시험] 2025년 경상북도 전통시장 청년상인 온라인 판로 지원사업")).toBe("전통시장 청년상인 온라인 판로");
    expect(searchQueries("2025년 경상북도 향토뿌리기업 및 산업유산 육성 사업", ["디자인 역량 강화 지원사업"])).toEqual(["향토뿌리기업 및 산업유산", "향토뿌리기업 산업유산", "향토뿌리기업", "산업유산", "디자인 역량 강화"]);
    expect(searchQueries("2025년 경상북도 청년 로컬크리에이터 육성 지원사업")).toEqual(["청년 로컬크리에이터", "로컬크리에이터"]);
    expect(keywordTokens("2025년 경상북도 향토뿌리기업 및 산업유산 육성 사업")).toEqual(["향토뿌리기업", "산업유산"]);
  });
  it("검색 결과에서 글 번호를, 글에서 제목·작성일·본문·사진을 읽는다", () => {
    expect(parseSearchVids(LIST, "photo")).toEqual([688, 558]);
    const p = parsePost(VIEW("2025년 경상북도 향토뿌리기업 신규지정 인증서 수여식", "2025-12-02"), "photo", 688)!;
    expect(p.date).toBe("2025-12-02");
    expect(p.category).toBe("행사");
    expect(p.text).toContain("장소: 경북도청 (동락관)");
    expect(p.images).toEqual(["https://www.gepa.kr/wp-content/uploads/mangboard/2025/12/02/F1_a.jpg"]);
  });
  it("사업연도 글 가운데 제목에 사업 낱말이 있는 것만 고른다", async () => {
    const pages: Record<string, string> = {
      "vid=688": VIEW("2025년 경상북도 향토뿌리기업 신규지정 인증서 수여식", "2025-12-02"),
      "vid=558": VIEW("경상북도 향토뿌리기업 및 산업유산 신규선정", "2024-12-23"),
    };
    const fetcher = async (url: string) => {
      const key = Object.keys(pages).find((k) => url.endsWith(k));
      return new Response(key ? pages[key] : url.includes("page_id=57") ? LIST : "");
    };
    const posts = await searchGepaSite({ title: "2025년 경상북도 향토뿌리기업 및 산업유산 육성 사업", year: 2025, fetcher });
    expect(posts.map((p) => p.vid)).toEqual([688]);
  });
  it("글과 사진을 materials/web 에 저장하고 목록을 남긴다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gepa-web-"));
    const post = parsePost(VIEW("수여식", "2025-12-02"), "photo", 688)!;
    const jpg = new Uint8Array(20 * 1024).fill(1);
    const saved = await saveGepaPosts(dir, [post], async () => new Response(jpg));
    expect(saved[0].photos).toEqual(["materials/web/photo_688_01.jpg"]);
    expect(existsSync(join(dir, "web", "photo_688_01.jpg"))).toBe(true);
    expect(readFileSync(join(dir, "web", "photo_688.md"), "utf8")).toContain("작성일: 2025-12-02");
    expect(readSavedGepaPosts(dir)).toHaveLength(1);
    await saveGepaPosts(dir, []);
    expect(readSavedGepaPosts(dir)).toEqual([]);
  });
  it("사업연도는 원장 시작일, 없으면 사업명의 연도", () => {
    expect(projectYear("2025년 경상북도 …", "2025-03-01")).toBe(2025);
    expect(projectYear("2024년 경상북도 …")).toBe(2024);
    expect(projectYear("경상북도 …")).toBeUndefined();
  });
});
