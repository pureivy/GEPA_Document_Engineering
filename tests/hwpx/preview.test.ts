import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { buildHwpx } from "../../lib/hwpx/build";
import { exportStageDoc } from "../../lib/hwpx/export";
import { replacePreviewImage } from "../../lib/hwpx/preview";
import { noticeFixture } from "../fixtures/docs";

describe("Preview/PrvImage.png", () => {
  it("replacePreviewImage keeps entry order and the stored mimetype", () => {
    const built = buildHwpx(noticeFixture(), { now: new Date("2026-09-15T00:00:00Z") });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const out = replacePreviewImage(built.bytes, png);
    const names = Object.keys(unzipSync(out));
    expect(names[0]).toBe("mimetype");
    expect(names).toEqual(Object.keys(unzipSync(built.bytes)));
    expect(out[8]).toBe(0); // mimetype stored
    expect(Buffer.from(unzipSync(out)["Preview/PrvImage.png"])).toEqual(Buffer.from(png));
  });

  it("exportStageDoc embeds a real page-1 thumbnail and seeds the render cache", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gepa-preview-"));
    try {
      const r = await exportStageDoc(dir, noticeFixture(), { now: new Date("2026-09-15T00:00:00Z") });
      expect(r.report.ok).toBe(true);
      const files = unzipSync(readFileSync(join(dir, "out.hwpx")));
      const png = files["Preview/PrvImage.png"];
      expect(png.length).toBeGreaterThan(2000); // the template stub is 68 bytes
      expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // IHDR width = 200 px
      const width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
      expect(width).toBe(200);
      expect(r.report.warnings.filter((w) => w.includes("미리보기"))).toEqual([]);
      // render cache written for the final hash
      expect(readFileSync(join(dir, "render", r.report.hash, "manifest.json"), "utf8")).toContain(`"hash":"${r.report.hash}"`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
