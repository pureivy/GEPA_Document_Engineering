import { describe, it, expect } from "vitest";
import { WriteStreamDecoder } from "../../lib/agents/writeStream";

function run(json: string, chunk: (i: number) => number): { content: string; path: string | null; pieces: string[] } {
  const pieces: string[] = [];
  let path: string | null = null;
  const d = new WriteStreamDecoder({ onContent: (t) => pieces.push(t), onFilePath: (p) => (path = p) });
  for (let i = 0; i < json.length; ) {
    const n = Math.max(1, chunk(i));
    d.push(json.slice(i, i + n));
    i += n;
  }
  return { content: d.content, path, pieces };
}

const DOC = `---\nfamily: notice\n공고번호: "2026070001"\n---\n# 3. 사업목적\n□ **(목적)** "따옴표" \\역슬래시 탭\t 끝\n😀 이모지 ㅇ 항목\n`;
const INPUT = JSON.stringify({ file_path: "/data/projects/p/notice/draft.dsl.md", content: DOC });

describe("WriteStreamDecoder", () => {
  it("decodes the whole content at once", () => {
    const r = run(INPUT, () => INPUT.length);
    expect(r.content).toBe(DOC);
    expect(r.path).toBe("/data/projects/p/notice/draft.dsl.md");
  });
  it("is chunking-invariant (1..7 char fragments, escapes cut anywhere)", () => {
    for (let size = 1; size <= 7; size++) {
      const r = run(INPUT, () => size);
      expect(r.content, `chunk ${size}`).toBe(DOC);
      expect(r.pieces.join(""), `pieces ${size}`).toBe(DOC);
      expect(r.path).toBe("/data/projects/p/notice/draft.dsl.md");
    }
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) % 11;
    for (let k = 0; k < 20; k++) {
      const r = run(INPUT, () => rnd());
      expect(r.content).toBe(DOC);
    }
  });
  it("copes with content before file_path and with extra keys / nested values", () => {
    const j = JSON.stringify({ content: "abc\n", extra: { a: [1, "}\"", { b: null }] }, n: 12, file_path: "x.md", flag: true });
    const r = run(j, () => 3);
    expect(r.content).toBe("abc\n");
    expect(r.path).toBe("x.md");
  });
  it("never emits a lone surrogate when \\uXXXX pairs are split", () => {
    const j = '{"file_path":"a","content":"\\ud83d\\ude00x"}';
    const r = run(j, () => 4);
    expect(r.content).toBe("😀x");
    for (const p of r.pieces) expect(p.isWellFormed()).toBe(true);
  });
});
