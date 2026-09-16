import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { BlockSchema, DocModelSchema, type DocModel } from "@/lib/docmodel/schema";
import { toPm } from "@/lib/docmodel/prosemirror/toPm";
import { fromPm } from "@/lib/docmodel/prosemirror/fromPm";
import { BLOCK_NODE_NAMES } from "@/lib/docmodel/prosemirror/schema";
import { gepaExtensions } from "@/components/editor/nodes";
import { kitchenSinkFixture, noticeFixture, planFixture, pressFixture } from "./fixtures/docs";

const FIXTURES: Record<string, () => DocModel> = {
  notice: noticeFixture,
  plan: planFixture,
  press: pressFixture,
  kitchenSink: kitchenSinkFixture,
};

/** the parsed fixture is the reference: zod fills defaults (e.g. BorderSpec, meta) */
function parsed(name: string): DocModel {
  const raw = FIXTURES[name]();
  const res = DocModelSchema.safeParse(raw);
  if (!res.success) throw new Error(`fixture ${name} is not a valid DocModel: ${res.error.message}`);
  return res.data;
}

const strip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("DocModel ⇄ ProseMirror JSON round trip", () => {
  it("the coverage fixture uses every block kind", () => {
    const kinds = new Set(parsed("kitchenSink").blocks.map((b) => b.k));
    const allKinds = BlockSchema.options.map((o) => o.shape.k.value);
    for (const k of allKinds) expect(kinds.has(k), `missing block kind ${k}`).toBe(true);
    expect(allKinds.length).toBe(BLOCK_NODE_NAMES.length);
  });

  for (const name of Object.keys(FIXTURES)) {
    describe(name, () => {
      it("fromPm(toPm(doc)) deep-equals doc (pure JSON path)", () => {
        const doc = parsed(name);
        const pm = toPm(doc);
        const back = fromPm(pm);
        expect(back.warnings).toEqual([]);
        expect(strip(back.doc)).toStrictEqual(strip(doc));
        expect(back.doc).toStrictEqual(doc);
        expect(DocModelSchema.safeParse(back.doc).success).toBe(true);
      });

      it("toPm output is valid against the editor schema and survives ProseMirror normalization", () => {
        const doc = parsed(name);
        const schema = getSchema(gepaExtensions({ family: doc.family }));
        const node = schema.nodeFromJSON(toPm(doc));
        expect(() => node.check()).not.toThrow();
        // toJSON() fills default attrs and merges adjacent text nodes — the editor's own shape
        const back = fromPm(node.toJSON());
        expect(back.warnings).toEqual([]);
        expect(back.doc).toStrictEqual(doc);
      });

      it("every block node keeps its blockId", () => {
        const doc = parsed(name);
        const pm = toPm(doc);
        expect(pm.content.map((n) => n.attrs?.blockId)).toEqual(doc.blocks.map((b) => b.id));
        expect(pm.attrs.family).toBe(doc.family);
        expect(pm.attrs.meta).toStrictEqual(doc.meta);
      });
    });
  }

  it("assigns fresh unique ids to editor-created nodes and skips unknown nodes", () => {
    const doc = parsed("press");
    const pm = toPm(doc);
    pm.content.push({ type: "gepaParagraph", attrs: { role: "pressBody" }, content: [{ type: "text", text: "새 문단" }] });
    pm.content.push({ type: "gepaParagraph", attrs: { blockId: doc.blocks[0].id, role: "pressBody" }, content: [{ type: "text", text: "중복 id" }] });
    pm.content.push({ type: "someUnknownNode" });
    const back = fromPm(pm);
    const ids = back.doc.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(-2)).toEqual(["u001", "u002"]);
    expect(back.warnings).toHaveLength(1);
    expect(DocModelSchema.safeParse(back.doc).success).toBe(true);
  });

  it("marks: bold + style + link inlines map to the expected PM marks", () => {
    const doc = parsed("notice");
    const pm = toPm(doc);
    const para = pm.content.find((n) => n.type === "gepaParagraph" && n.attrs?.role === "body1");
    expect(para?.content?.[0].marks).toEqual([{ type: "bold" }]);
    expect(para?.content?.[2].marks).toEqual([{ type: "gepaStyle", attrs: { color: "#0000ff", size: null, font: null } }]);
    const linkPara = pm.content.find((n) => n.type === "gepaParagraph" && n.attrs?.role === "body2");
    expect(linkPara?.content?.[1].marks).toEqual([{ type: "link", attrs: { href: "mailto:gepa_north@naver.com" } }]);
  });
});
