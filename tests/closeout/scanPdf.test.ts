import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ocrMarkdown } from "@/lib/closeout/scanPdf";

describe("스캔 PDF 글자 인식 결과(ocrMarkdown)", () => {
  it("쪽마다 그림 경로를 달고, 수치는 그림으로 확인하라고 적는다", () => {
    const md = ocrMarkdown("2998_지급.pdf", "=== p001\n사 업 자 등 록 증\n등록번호 : 512-04-61906\n=== p002\n\n", 2, 2);
    expect(md).toContain("# 자료 — 2998_지급.pdf (스캔 PDF, 글자 인식)");
    expect(md).toContain("`materials/pages/2998_지급/pNNN.jpg`");
    expect(md).toContain("## 1쪽 — `materials/pages/2998_지급/p001.jpg`");
    expect(md).toContain("등록번호 : 512-04-61906");
    // 글자가 없는 쪽(사진·도장)도 쪽 머리는 남긴다
    expect(md).toContain("## 2쪽 — `materials/pages/2998_지급/p002.jpg`\n\n(글자 없음 — 사진·도장 쪽)");
  });

  it("앞쪽만 그렸으면 그렇다고 밝힌다", () => {
    expect(ocrMarkdown("a.pdf", "=== p001\n가\n", 300, 150)).toContain("300쪽, 앞 150쪽만");
  });
});

describe("글자 인식이 남은 자료(pendingScans)", () => {
  it("텍스트로 옮긴 PDF·실패 표시가 있는 PDF는 빼고 남은 스캔 PDF만 센다", async () => {
    const root = join(process.env.TMPDIR ?? process.env.TEMP ?? "/tmp", `gepa-scan-${process.pid}-${Date.now()}`);
    const dir = join(root, "materials");
    mkdirSync(join(dir, "text"), { recursive: true });
    for (const n of ["a.pdf", "b.pdf", "c.pdf", "d.hwpx"]) writeFileSync(join(dir, n), "x");
    writeFileSync(join(dir, "text", "a.pdf.md"), "글");
    writeFileSync(join(dir, "text", "b.pdf.scanfail"), "실패");
    vi.resetModules();
    vi.doMock("@/lib/closeout/materials", () => ({ materialsDir: () => dir, writeMaterialsIndex: () => {} }));
    const { pendingScans } = await import("@/lib/closeout/scanPdf");
    expect(pendingScans("p")).toEqual(["c.pdf"]);
    vi.doUnmock("@/lib/closeout/materials");
  });
});
