import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncWikiSnapshot } from "../../lib/research/wikiSnapshot";

const tmp = () => mkdtempSync(join(tmpdir(), "wiki-"));
const put = (dir: string, rel: string, body: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), body, "utf8");
};

/**
 * 원본에서 지워진 글은 사본에서도 지워져야 한다 (user 2026-09-22).
 *
 * 그 전에는 복사만 하고 지우지 않아서 폐기된 문서가 사본에 영원히 남았다 — 실제로 네 개가
 * 쌓여 있었고 그중 하나는 직원 실명이 든 노트였다. 업무보고 에이전트에게 "위키에서 확인한
 * 수치만 쓰라"고 지시해 둔 터라, 남은 파일은 **이미 폐기된 근거를 되살리는 길**이 된다.
 */
describe("syncWikiSnapshot — 지워진 글", () => {
  it("원본에 없는 사본을 지운다", () => {
    const src = tmp(), dst = tmp();
    put(src, "a.md", "살아 있음");
    put(dst, "a.md", "살아 있음");
    put(dst, "없어진글.md", "폐기됨");
    const r = syncWikiSnapshot(src, dst);
    expect(existsSync(join(dst, "없어진글.md")), "폐기된 글이 남아 있다").toBe(false);
    expect(existsSync(join(dst, "a.md"))).toBe(true);
    expect(r.removed).toBe(1);
  });

  it("읽기 전용(0444) 사본도 지운다", () => {
    const src = tmp(), dst = tmp();
    put(src, "a.md", "x");
    put(dst, "낡은글.md", "x");
    chmodSync(join(dst, "낡은글.md"), 0o444); // 동기화가 사본에 거는 권한 그대로
    syncWikiSnapshot(src, dst);
    expect(existsSync(join(dst, "낡은글.md"))).toBe(false);
  });

  /**
   * 안전장치. 원본 경로가 잘못 잡히거나(빈 폴더를 가리킴) 원본이 통째로 비어 있을 때
   * 사본을 몽땅 날리면, 다음 실행에서 에이전트가 참고할 자료가 사라진다.
   * 그런 때는 **아무것도 지우지 않는다** — 지우지 않아 생기는 손해가 훨씬 작다.
   */
  it("원본에 .md 가 하나도 없으면 아무것도 지우지 않는다", () => {
    const src = tmp(), dst = tmp();
    put(src, "읽지않는파일.txt", "md 가 아니다");
    put(dst, "소중한글.md", "지키자");
    const r = syncWikiSnapshot(src, dst);
    expect(existsSync(join(dst, "소중한글.md")), "원본이 비었는데 사본을 지웠다").toBe(true);
    expect(r.removed).toBe(0);
  });

  it("우리가 만들지 않은 파일(.md 아닌 것)은 건드리지 않는다", () => {
    const src = tmp(), dst = tmp();
    put(src, "a.md", "x");
    put(dst, "메모.txt", "남의 파일");
    syncWikiSnapshot(src, dst);
    expect(existsSync(join(dst, "메모.txt"))).toBe(true);
  });

  it("하위 폴더에서도 지운다", () => {
    const src = tmp(), dst = tmp();
    put(src, "팀/a.md", "x");
    put(dst, "팀/a.md", "x");
    put(dst, "팀/없어짐.md", "x");
    syncWikiSnapshot(src, dst);
    expect(existsSync(join(dst, "팀/없어짐.md"))).toBe(false);
    expect(existsSync(join(dst, "팀/a.md"))).toBe(true);
  });
});
