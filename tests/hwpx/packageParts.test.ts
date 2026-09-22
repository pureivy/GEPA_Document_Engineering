import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildHwpx } from "../../lib/hwpx/build";

/**
 * 생성물이 **가리키기만 하고 담고 있지 않은 파트**가 없어야 한다.
 *
 * 2026-09-22, 업무보고서가 한글을 열자마자 죽였다(EXC_BAD_ACCESS, 널 역참조). 원인은
 * section0 의 secPr 이 `<hp:masterPage idRef="masterpage0"/>` 를 가리키고 content.hpf 도
 * 선언하는데 `Contents/masterpage0.xml` 이 패키지에 빠진 것이었다. build.ts 가 파트를 손으로
 * 나열하고 BinData/ 만 반복 복사했기 때문이고, 업무보고서 전까지는 어느 참고본에도 바탕쪽이
 * 없어 이 경로가 필요한 적이 없었다.
 *
 * rhwp verify·validate 와 resvg 렌더는 **전부 통과했다** — 끊긴 파트를 아무도 안 본다.
 * 그래서 이 테스트는 판독기를 믿지 않고 zip 목록과 참조를 직접 대조한다.
 */
const FM = `---
family: report
제목: 주요업무보고
보고일: 2026. 9.
보고대상: 경상북도지사
부서: 기획조정실
대상기간: 2026년
---
`;

function partsOf(bytes: Uint8Array): Set<string> {
  return new Set(Object.keys(unzipSync(bytes)));
}

describe("생성물이 참조하는 파트는 패키지 안에 있어야 한다", () => {
  const { doc } = parseDsl(FM + "# 일반현황\n본문 한 줄.\n");
  const { bytes } = buildHwpx(doc, { now: new Date("2026-09-22T00:00:00Z") });
  const parts = partsOf(bytes);
  const files = unzipSync(bytes);
  const section = new TextDecoder().decode(files["Contents/section0.xml"]);

  it("secPr 이 가리키는 바탕쪽 파일이 들어 있다", () => {
    const refs = [...section.matchAll(/<hp:masterPage[^>]*idRef="([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0); // 업무보고서는 바탕쪽을 쓴다 — 안 쓰면 이 테스트의 전제가 바뀐 것
    for (const id of refs) expect(parts, `secPr 이 ${id} 를 가리킨다`).toContain(`Contents/${id}.xml`);
  });

  it("참고본에 있던 Contents/ 파트가 하나도 빠지지 않는다", () => {
    const tplDir = join(process.cwd(), "templates", "report", "pkg");
    const tplSection = readFileSync(join(tplDir, "Contents", "section0.xml"));
    expect(tplSection.length).toBeGreaterThan(0);
    // 참고본이 바탕쪽을 갖고 있다는 사실 자체를 고정한다 — 큐레이션을 다시 떠도 이 테스트가 지킨다
    expect(() => readFileSync(join(tplDir, "Contents", "masterpage0.xml"))).not.toThrow();
    expect(parts).toContain("Contents/masterpage0.xml");
  });

  it("binaryItemIDRef 가 가리키는 이미지가 들어 있다", () => {
    const refs = [...section.matchAll(/binaryItemIDRef="([^"]+)"/g)].map((m) => m[1]);
    for (const id of refs) {
      const hit = [...parts].some((p) => p.startsWith("BinData/") && p.includes(id));
      expect(hit, `${id} 를 담은 BinData 파트가 없다`).toBe(true);
    }
  });
});
