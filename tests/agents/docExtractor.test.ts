import { describe, expect, it } from "vitest";
import { DocExtractor, extractDocFromText } from "../../lib/agents/docExtractor";

function collect(chunks: string[]): { deltas: string[]; ex: DocExtractor; closed: string | null; opened: number } {
  const ex = new DocExtractor();
  const deltas: string[] = [];
  let closed: string | null = null;
  let opened = 0;
  ex.onDocDelta((t) => deltas.push(t));
  ex.onDocClose((d) => (closed = d));
  ex.onDocOpen(() => opened++);
  for (const c of chunks) ex.feed(c);
  return { deltas, ex, closed, opened };
}

const DOC = "---\nfamily: notice\n---\n# 제목\n본문입니다.";

describe("DocExtractor", () => {
  it("extracts a document delivered in one chunk", () => {
    const { deltas, ex, closed, opened } = collect([`설명 텍스트\n<<<DOC\n${DOC}\nDOC>>>\n끝.`]);
    expect(opened).toBe(1);
    expect(deltas.join("")).toBe(DOC);
    expect(closed).toBe(DOC);
    expect(ex.finalDoc()).toBe(DOC);
    expect(ex.isClosed).toBe(true);
  });

  it("handles the opening marker split across chunks", () => {
    const { deltas, ex } = collect(["안내 <<", "<D", "OC\n", DOC, "\nDOC>>>"]);
    expect(deltas.join("")).toBe(DOC);
    expect(ex.finalDoc()).toBe(DOC);
  });

  it("handles the closing marker split across chunks and never leaks marker fragments", () => {
    const { deltas, ex } = collect(["<<<DOC\n", DOC, "\nDO", "C>", ">>", " 이후 텍스트"]);
    expect(deltas.join("")).toBe(DOC);
    for (const d of deltas) expect(d).not.toContain("DOC>>>");
    expect(ex.finalDoc()).toBe(DOC);
  });

  it("streams character by character", () => {
    const text = `<<<DOC\n${DOC}\nDOC>>>`;
    const { deltas, ex } = collect(text.split(""));
    expect(deltas.join("")).toBe(DOC);
    expect(ex.finalDoc()).toBe(DOC);
  });

  it("waits for the newline after the opening marker across a chunk boundary", () => {
    const { deltas } = collect(["<<<DOC", "\n# 제목\nDOC>>>"]);
    expect(deltas.join("")).toBe("# 제목");
  });

  it("does not strip content when no newline follows the opening marker", () => {
    const { deltas } = collect(["<<<DOC# 제목\nDOC>>>"]);
    expect(deltas.join("")).toBe("# 제목");
  });

  it("flushes the held-back tail in finalDoc when the closing marker never arrives", () => {
    const { deltas, ex } = collect(["<<<DOC\n# 제목\n본문 끝"]);
    expect(deltas.join("").length).toBeLessThan("# 제목\n본문 끝".length); // tail held back
    expect(ex.finalDoc()).toBe("# 제목\n본문 끝");
  });

  it("returns null when no marker was seen", () => {
    const { ex } = collect(["그냥 설명만 있는 응답"]);
    expect(ex.finalDoc()).toBeNull();
    expect(ex.hasStarted).toBe(false);
  });

  it("prefers the authoritative full text when set", () => {
    const { ex } = collect(["<<<DOC\n# 부분\n"]);
    const full = `머리말\n<<<DOC\n${DOC}\nDOC>>>\n꼬리말`;
    expect(ex.setAuthoritativeText(full)).toBe(DOC);
    expect(ex.finalDoc()).toBe(DOC);
  });

  it("ignores text after the document closes", () => {
    const { deltas, ex } = collect(["<<<DOC\nA\nDOC>>>", "\n<<<DOC\nB\nDOC>>>"]);
    expect(deltas.join("")).toBe("A");
    expect(ex.finalDoc()).toBe("A");
  });

  it("extractDocFromText takes the last block and tolerates a missing close marker", () => {
    expect(extractDocFromText("x <<<DOC\nA\nDOC>>> y <<<DOC\nB\nDOC>>>")).toBe("B");
    expect(extractDocFromText("<<<DOC\nunterminated\n")).toBe("unterminated\n");
    expect(extractDocFromText("<<<DOC\r\nwin\r\nDOC>>>")).toBe("win");
    expect(extractDocFromText("nothing")).toBeNull();
  });
});
