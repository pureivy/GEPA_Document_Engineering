import { readFileSync } from "node:fs";
import path from "node:path";
import type { Block, DocModel } from "../../lib/docmodel/schema";

export function fixture(name: "notice" | "plan" | "press"): string {
  return readFileSync(path.join(__dirname, "fixtures", `${name}.dsl.md`), "utf8");
}

export type IdLess = Omit<Block, "id">;

export function stripIds(doc: DocModel): { family: string; meta: unknown; blocks: IdLess[] } {
  return { family: doc.family, meta: doc.meta, blocks: doc.blocks.map((b) => stripId(b)) };
}

export function stripId(b: Block): IdLess {
  const { id: _id, ...rest } = b;
  void _id;
  return rest;
}

export function kinds(doc: DocModel): string[] {
  return doc.blocks.map((b) => b.k);
}

export function paras(doc: DocModel) {
  return doc.blocks.filter((b): b is Extract<Block, { k: "para" }> => b.k === "para");
}

export function tables(doc: DocModel) {
  return doc.blocks.filter((b): b is Extract<Block, { k: "table" }> => b.k === "table");
}

export function plain(b: Extract<Block, { k: "para" }>): string {
  return b.inlines.map((i) => (i.t === "br" ? "\n" : i.text)).join("");
}

/** deterministic PRNG so chunking tests are reproducible */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomChunks(text: string, seed: number, min = 1, max = 40): string[] {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const n = min + Math.floor(rnd() * (max - min + 1));
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}
