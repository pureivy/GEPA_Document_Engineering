import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { removeSync } from "../lib/fsSafe";

/**
 * 한글 경로 지우기 — Windows Node 24.13 의 rmSync 는 이 자리에서 프로세스를 죽였다(0xC0000409).
 * 서버가 렌더 캐시를 정리하거나 자료·프로젝트를 지울 때마다 꺼지던 원인이다.
 */
describe("removeSync", () => {
  const base = mkdtempSync(path.join(tmpdir(), "gepa-한글-"));

  it("한글 경로의 폴더를 통째로 지운다(읽기 전용 파일 포함)", () => {
    const dir = path.join(base, "정산자료", "하위 폴더");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "통장거래내역.pdf.md"), "x");
    const ro = path.join(base, "정산자료", "위키사본.md");
    writeFileSync(ro, "x");
    chmodSync(ro, 0o444);
    removeSync(path.join(base, "정산자료"));
    expect(existsSync(path.join(base, "정산자료"))).toBe(false);
  });

  it("없는 경로는 조용히 넘어간다", () => {
    expect(() => removeSync(path.join(base, "없음"))).not.toThrow();
    removeSync(base);
    expect(existsSync(base)).toBe(false);
  });
});
