import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDsl } from "../../lib/docmodel/dsl";
import { toDsl } from "../../lib/docmodel/serialize";
import { DocModelSchema } from "../../lib/docmodel/schema";
import { stripIds } from "./helpers";

/** The three complete examples in grammar.md §3 (fenced with ```markdown or ````markdown). */
function grammarExamples(): Record<string, string> {
  const md = readFileSync(path.join(__dirname, "../../lib/docmodel/dsl/grammar.md"), "utf8");
  const out: Record<string, string> = {};
  const re = /### 3\.(\d) [^\n]+\n\n(`{3,4})markdown\n([\s\S]*?)\n\2\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out[`3.${m[1]}`] = m[3] + "\n";
  return out;
}

describe("grammar.md examples", () => {
  const examples = grammarExamples();
  it("contains the three family examples", () => {
    expect(Object.keys(examples)).toEqual(["3.1", "3.2", "3.3"]);
  });
  for (const [key, text] of Object.entries(examples)) {
    it(`example ${key} parses without warnings, validates and round-trips`, () => {
      const { doc, warnings } = parseDsl(text);
      expect(warnings).toEqual([]);
      expect(DocModelSchema.safeParse(doc).success).toBe(true);
      expect(stripIds(parseDsl(toDsl(doc)).doc)).toEqual(stripIds(doc));
    });
  }
  it("the plan example ends with `.  끝.` via the macro", () => {
    const { doc } = parseDsl(examples["3.2"]);
    const last = doc.blocks.filter((b) => b.k === "para").at(-1)!;
    expect(last.k === "para" && last.inlines.map((i) => (i.t === "text" ? i.text : "")).join("")).toBe("지역 제조업 수출액 증대를 통한 지역경제 활성화.  끝.");
  });
});
