import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { extractReferenceText, hwpxText, docxText, referenceExtension, referenceMarkdown } from "../../lib/reference/extract";

const planHwpx = join(process.cwd(), "templates", "plan", "reference.hwpx");
const hasPdftotext = spawnSync("pdftotext", ["-v"]).status !== null;

describe("reference document extraction", () => {
  it("recognises the supported extensions (case-insensitive)", () => {
    expect(referenceExtension("계획서.HWP")).toBe(".hwp");
    expect(referenceExtension("a.pdf")).toBe(".pdf");
    expect(referenceExtension("a.xlsx")).toBeNull();
  });
  it("reads every section of an HWPX 사업계획서", () => {
    const text = hwpxText(new Uint8Array(readFileSync(planHwpx)));
    expect(text).toContain("사업계획(안)");
    expect(text).toContain("추진배경");
    expect(text.length).toBeGreaterThan(3000);
  });
  it("extractReferenceText wraps hwpx and reports truncation", () => {
    const r = extractReferenceText("plan.hwpx", new Uint8Array(readFileSync(planHwpx)));
    expect(r.truncated).toBe(false);
    expect(r.text).toContain("사업계획(안)");
  });
  it("reads plain text / markdown as is", () => {
    const r = extractReferenceText("plan.md", new TextEncoder().encode("# 제목\r\n\r\n\r\n\r\n본문  \n"));
    expect(r.text).toBe("# 제목\n\n본문");
  });
  it("reads docx paragraphs from word/document.xml", async () => {
    const { zipSync } = await import("fflate");
    const xml = `<w:document><w:body><w:p><w:r><w:t>첫 문단 &amp; 표기</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">둘째</w:t></w:r><w:r><w:t> 문단</w:t></w:r></w:p></w:body></w:document>`;
    const bytes = zipSync({ "word/document.xml": new TextEncoder().encode(xml) });
    expect(docxText(bytes)).toBe("첫 문단 & 표기\n둘째 문단");
  });
  it.skipIf(!hasPdftotext || !existsSync(join(process.cwd(), "docs/design-system/bumpis-1100-manual.pdf")))("reads a PDF through pdftotext", () => {
    const r = extractReferenceText("manual.pdf", new Uint8Array(readFileSync(join(process.cwd(), "docs/design-system/bumpis-1100-manual.pdf"))));
    expect(r.text).toContain("범정부");
  });
  it("rejects unsupported files and empty documents", () => {
    expect(() => extractReferenceText("a.xlsx", new Uint8Array())).toThrow(/지원하지 않는/);
    expect(() => extractReferenceText("a.txt", new Uint8Array())).toThrow(/읽지 못/);
  });
  it("referenceMarkdown carries the change notes and the body", () => {
    const md = referenceMarkdown("plan.hwp", "2027년으로 변경", "본문");
    expect(md).toContain("# 기존 사업계획서 — plan.hwp");
    expect(md).toContain("2027년으로 변경");
    expect(md.trim().endsWith("본문")).toBe(true);
  });
});
