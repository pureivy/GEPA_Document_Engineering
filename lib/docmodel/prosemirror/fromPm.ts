/**
 * ProseMirror JSON → DocModel (pure transform, inverse of ./toPm.ts).
 *
 * Tolerates editor-normalized JSON: extra mark/node attrs with default values, merged text
 * nodes, missing `attrs`, and nodes without a `blockId` (created by the user) which receive
 * fresh ids. Unknown node types are skipped and reported in `warnings`.
 */
import type { Block, Cell, DocModel, Family, Inline, Row } from "../schema";
import { normalizeInlines } from "../dsl/inline";
import { M, N, type PmNode } from "./schema";

export interface FromPmResult {
  doc: DocModel;
  warnings: string[];
}

type Attrs = Record<string, unknown>;

const attrsOf = (n: PmNode): Attrs => n.attrs ?? {};
const has = (v: unknown): boolean => v !== null && v !== undefined;

/** copy only present (non-null) keys from `src` into `dst` */
function put<T extends object>(dst: T, key: keyof T & string, v: unknown): void {
  if (has(v)) (dst as Record<string, unknown>)[key] = v;
}

export function pmToInlines(content: PmNode[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const n of content ?? []) {
    if (n.type === N.hardBreak) {
      out.push({ t: "br" });
      continue;
    }
    if (n.type !== N.text) continue;
    const text = n.text ?? "";
    if (!text) continue;
    const marks = n.marks ?? [];
    const link = marks.find((m) => m.type === M.link);
    if (link) {
      out.push({ t: "link", text, href: String(link.attrs?.href ?? "") });
      continue;
    }
    const inl: Extract<Inline, { t: "text" }> = { t: "text", text };
    if (marks.some((m) => m.type === M.bold)) inl.bold = true;
    const style = marks.find((m) => m.type === M.style);
    if (style) {
      const a = style.attrs ?? {};
      if (has(a.color)) inl.color = String(a.color);
      if (has(a.size)) inl.size = Number(a.size);
      if (has(a.font)) inl.font = a.font as Extract<Inline, { t: "text" }>["font"];
    }
    out.push(inl);
  }
  return normalizeInlines(out);
}

export function pmToString(content: PmNode[] | undefined): string {
  let s = "";
  for (const n of content ?? []) {
    if (n.type === N.text) s += n.text ?? "";
    else if (n.type === N.hardBreak) s += "\n";
  }
  return s;
}

function cellFromPm(n: PmNode): Cell {
  const a = attrsOf(n);
  if (a.covered === true) return { inlines: [], covered: true };
  const cell: Cell = { inlines: pmToInlines(n.content) };
  put(cell, "colSpan", a.colSpan);
  put(cell, "rowSpan", a.rowSpan);
  put(cell, "fill", a.fill);
  put(cell, "align", a.align);
  put(cell, "valign", a.valign);
  put(cell, "bold", a.bold);
  put(cell, "borders", a.borders);
  return cell;
}

function rowFromPm(n: PmNode): Row {
  const a = attrsOf(n);
  const row: Row = { cells: (n.content ?? []).filter((c) => c.type === N.cell).map(cellFromPm) };
  put(row, "heightPt", a.heightPt);
  put(row, "isHeader", a.isHeader);
  put(row, "isTotal", a.isTotal);
  return row;
}

function childrenOfType(n: PmNode, type: string): PmNode[] {
  return (n.content ?? []).filter((c) => c.type === type);
}

function firstChild(n: PmNode, type: string): PmNode | undefined {
  return (n.content ?? []).find((c) => c.type === type);
}

export function blockFromPm(n: PmNode, id: string): Block | null {
  const a = attrsOf(n);
  switch (n.type) {
    case N.paragraph: {
      const out: Extract<Block, { k: "para" }> = {
        id,
        k: "para",
        role: (a.role ?? "plain") as Extract<Block, { k: "para" }>["role"],
        inlines: pmToInlines(n.content),
      };
      put(out, "glyph", a.glyph);
      put(out, "align", a.align);
      put(out, "pageBreakBefore", a.pageBreakBefore);
      put(out, "indent", a.indent);
      return out;
    }
    case N.blank: {
      const out: Extract<Block, { k: "blank" }> = { id, k: "blank" };
      put(out, "role", a.role);
      return out;
    }
    case N.pageBreak:
      return { id, k: "pageBreak" };
    case N.image: {
      const out: Extract<Block, { k: "image" }> = { id, k: "image", asset: String(a.asset ?? "logo") };
      put(out, "widthMm", a.widthMm);
      put(out, "heightMm", a.heightMm);
      put(out, "align", a.align);
      return out;
    }
    case N.table: {
      const out: Extract<Block, { k: "table" }> = {
        id,
        k: "table",
        role: (a.role ?? "generic") as Extract<Block, { k: "table" }>["role"],
        rows: childrenOfType(n, N.row).map(rowFromPm),
      };
      put(out, "caption", a.caption);
      put(out, "widthsPt", Array.isArray(a.widthsPt) ? [...(a.widthsPt as number[])] : null);
      put(out, "headerRows", a.headerRows);
      put(out, "style", a.style);
      return out;
    }
    case N.chapterBand:
      return { id, k: "chapterBand", numeral: String(a.numeral ?? ""), title: pmToString(n.content) };
    case N.sectionChip:
      return { id, k: "sectionChip", label: String(a.label ?? ""), title: pmToString(n.content) };
    case N.summaryBox: {
      const out: Extract<Block, { k: "summaryBox" }> = {
        id,
        k: "summaryBox",
        lines: childrenOfType(n, N.summaryLine).map((l) => pmToInlines(l.content)),
      };
      put(out, "glyph", a.glyph);
      return out;
    }
    case N.approvalBlock:
      return { id, k: "approvalBlock" };
    case N.coverTitle: {
      const out: Extract<Block, { k: "coverTitle" }> = { id, k: "coverTitle", inlines: pmToInlines(n.content) };
      put(out, "sizePt", a.sizePt);
      return out;
    }
    case N.sectionBar: {
      const out: Extract<Block, { k: "sectionBar" }> = { id, k: "sectionBar", number: Number(a.number ?? 0), title: pmToString(n.content) };
      put(out, "variant", a.variant);
      return out;
    }
    case N.infoBox:
      return {
        id,
        k: "infoBox",
        groups: childrenOfType(n, N.infoGroup).map((g) => ({
          heading: pmToString(firstChild(g, N.infoHeading)?.content),
          items: childrenOfType(g, N.infoItem).map((it) => pmToInlines(it.content)),
        })),
      };
    case N.overviewTable:
      return {
        id,
        k: "overviewTable",
        rows: (n.content ?? [])
          .filter((r) => r.type === N.overviewRow || r.type === N.overviewSpacer)
          .map((r) => {
            if (r.type === N.overviewSpacer) return "spacer" as const;
            const ra = attrsOf(r);
            const row: { label: string; value: Inline[]; bullet?: boolean } = {
              label: pmToString(firstChild(r, N.overviewLabel)?.content),
              value: pmToInlines(firstChild(r, N.overviewValue)?.content),
            };
            put(row, "bullet", ra.bullet);
            return row;
          }),
      };
    case N.procedureFlow:
      return {
        id,
        k: "procedureFlow",
        stages: childrenOfType(n, N.flowStage).map((s) => ({
          name: pmToString(firstChild(s, N.flowName)?.content),
          when: pmToString(firstChild(s, N.flowWhen)?.content),
        })),
      };
    case N.noticeHeader:
      return { id, k: "noticeHeader" };
    case N.pressHeader:
      return { id, k: "pressHeader" };
    case N.attachmentList:
      return { id, k: "attachmentList", items: childrenOfType(n, N.attachmentItem).map((it) => pmToString(it.content)) };
    case N.officialHeader:
      return { id, k: "officialHeader" };
    case N.officialFooter:
      return { id, k: "officialFooter" };
    default:
      return null;
  }
}

/** Allocates ids for editor-created nodes: `u001`, `u002`, … skipping ids already in use. */
export function createIdAllocator(used: Iterable<string>): () => string {
  const taken = new Set(used);
  let n = 0;
  return () => {
    let id: string;
    do {
      n += 1;
      id = `u${String(n).padStart(3, "0")}`;
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
}

export function fromPm(pm: PmNode): FromPmResult {
  const warnings: string[] = [];
  const a = attrsOf(pm);
  const family = (a.family ?? "notice") as Family;
  const meta = has(a.meta) ? (JSON.parse(JSON.stringify(a.meta)) as DocModel["meta"]) : ({} as DocModel["meta"]);
  const content = pm.content ?? [];
  const usedIds = content.map((n) => attrsOf(n).blockId).filter((v): v is string => typeof v === "string" && v.length > 0);
  const seen = new Set<string>();
  const nextId = createIdAllocator(usedIds);
  const blocks: Block[] = [];
  content.forEach((n, i) => {
    const raw = attrsOf(n).blockId;
    const id = typeof raw === "string" && raw && !seen.has(raw) ? raw : nextId();
    seen.add(id);
    const b = blockFromPm(n, id);
    if (!b) {
      warnings.push(`알 수 없는 노드 형식을 건너뛰었습니다: ${n.type} (#${i})`);
      return;
    }
    blocks.push(b);
  });
  const doc = { version: 1 as const, family, meta, blocks } as DocModel;
  return { doc, warnings };
}
