import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { extractReferenceText, hwpxText, docxText, referenceExtension, referenceMarkdown } from "../../lib/reference/extract";
import { DEFAULT_REFERENCE_ROLE, referenceRoleFor } from "../../lib/contracts";

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

  /**
   * 공문에 붙인 문서(user 2026-09-22). 에이전트가 **실제로 여는 파일**이라 프롬프트만 갈라서는
   * 모자란다 — 붙임 서식이 스스로를 "기존 사업계획서"라고 소개하면 갱신할 계획서로 읽힌다.
   */
  it("용도가 있으면 붙인 문서가 자기를 용도대로 소개한다", () => {
    const md = referenceMarkdown("서식.hwp", "신청서 서식", "본문", "붙임");
    expect(md).toContain("# 붙임 문서 — 서식.hwp");
    expect(md).toContain("## 붙임에 적을 이름");
    expect(md).toContain("## 붙임 문서 원문");
    expect(md).not.toContain("기존 사업계획서");
    const 받은 = referenceMarkdown("공문.hwpx", "자료 제출 회신", "본문", "받은공문");
    expect(받은).toContain("# 받은 공문 — 공문.hwpx");
    expect(받은).toContain("## 회신 취지");
  });

  it("용도가 있고 적어 둔 내용이 없으면 절 자체를 넣지 않는다(계획서 갱신 전제 문구를 쓰지 않는다)", () => {
    const md = referenceMarkdown("서식.hwp", "  ", "본문", "붙임");
    expect(md).not.toContain("## 붙임에 적을 이름");
    expect(md).not.toContain("미기재");
    expect(md).toContain("## 붙임 문서 원문");
  });

  it("용도가 없으면 예전 문자열 그대로다 — 얼어붙은 세 family 가 읽는 파일", () => {
    expect(referenceMarkdown("plan.hwp", "", "본문")).toContain("(변경 사항 미기재 — 연도·일정·담당만 갱신)");
  });
});

/**
 * 붙인 문서가 스스로를 뭐라고 소개하는가 — **프롬프트와 base-plan.md 가 같은 판정을 써야 한다.**
 * `projectBrief` 만 업무보고용으로 갈라 두면, 에이전트가 여는 파일은 여전히
 * "# 기존 사업계획서 — …" 와 "(변경 사항 미기재 — 연도·일정·담당만 갱신)" 을 들고 있다
 * (lib/contracts.ts REFERENCE_DOC_TITLE 주석이 공문에서 짚은 것과 같은 자리다).
 */
describe("referenceRoleFor — kind 별 참고 문서 용도", () => {
  it("사업계획서 갱신(program)만 용도가 없다 — 얼어붙은 세 family 의 파일이 그대로여야 한다", () => {
    expect(referenceRoleFor("program", undefined)).toBeUndefined();
    expect(referenceRoleFor("program", "붙임")).toBeUndefined();
    expect(referenceMarkdown("plan.hwp", "", "본문", referenceRoleFor("program", undefined))).toContain("# 기존 사업계획서 — plan.hwp");
  });

  it("업무보고는 언제나 근거자료다 — 용도를 묻지 않으므로 계획서 갱신 문구가 실리면 안 된다", () => {
    expect(referenceRoleFor("report", undefined)).toBe(DEFAULT_REFERENCE_ROLE);
    const md = referenceMarkdown("2025년 주요업무보고.hwp", "추진성과만 추려서 씀", "본문", referenceRoleFor("report", undefined));
    expect(md).toContain("# 참고 문서 — 2025년 주요업무보고.hwp");
    expect(md).toContain("## 이 문서에서 쓸 내용");
    expect(md).not.toContain("기존 사업계획서");
    expect(md).not.toContain("미기재");
  });

  it("공문은 고른 용도를 쓰고, 용도 없이 올라오면 근거자료로 본다(프롬프트의 referenceRole 과 같은 기본값)", () => {
    expect(referenceRoleFor("official", "받은공문")).toBe("받은공문");
    expect(referenceRoleFor("official", undefined)).toBe(DEFAULT_REFERENCE_ROLE);
  });
});
