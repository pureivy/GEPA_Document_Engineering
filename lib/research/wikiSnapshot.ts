/**
 * Read-only snapshot of the institution's internal wiki (`GEPA_WIKI_DIR`, e.g. the
 * GEPA_AI_Office LLM wiki) for the research stage. `--add-dir` grants the agent *write* access
 * to a tree, so the original is never mounted; `.md` files are copied into <dataDir>/wiki and
 * made read-only (0444). Only new/changed files (size or mtime) are copied on later runs, and
 * `.md` files the source no longer has are removed from the snapshot (see the sweep below).
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync, utimesSync } from "node:fs";
import path from "node:path";

export interface WikiSyncResult {
  dir: string;
  total: number;
  copied: number;
  /** 원본에서 사라져 사본에서도 지운 글 수 */
  removed: number;
}

export function syncWikiSnapshot(srcDir: string, destDir: string): WikiSyncResult {
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) throw new Error(`GEPA_WIKI_DIR 가 없습니다: ${srcDir}`);
  mkdirSync(destDir, { recursive: true });
  let total = 0;
  let copied = 0;
  const seen = new Set<string>();
  const walk = (rel: string) => {
    for (const ent of readdirSync(path.join(srcDir, rel), { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const relPath = path.join(rel, ent.name);
      if (ent.isDirectory()) {
        walk(relPath);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
      total++;
      seen.add(relPath);
      const src = path.join(srcDir, relPath);
      const dst = path.join(destDir, relPath);
      const s = statSync(src);
      if (existsSync(dst)) {
        const d = statSync(dst);
        if (d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 1000) continue;
        chmodSync(dst, 0o644);
      } else {
        mkdirSync(path.dirname(dst), { recursive: true });
      }
      copyFileSync(src, dst);
      utimesSync(dst, s.atime, s.mtime);
      chmodSync(dst, 0o444);
      copied++;
    }
  };
  walk("");

  /**
   * 원본에서 지워진 글은 사본에서도 지운다. 복사만 하던 시절에는 폐기된 문서가 사본에 영원히
   * 남았고, 에이전트에게 "위키에서 확인한 수치만 쓰라"고 시키는 지금은 그 파일이
   * **이미 폐기된 근거를 되살리는 길**이 된다(user 2026-09-22 지적, 실제로 네 개가 쌓여 있었다).
   *
   * 안전장치: 원본에 `.md` 가 하나도 없으면 아무것도 지우지 않는다. 경로를 잘못 잡았거나
   * 원본이 비어 있을 때 사본을 몽땅 날리면 다음 실행에서 참고할 자료가 사라진다 —
   * 지우지 않아 생기는 손해(낡은 글 몇 개)가 훨씬 작다.
   *
   * 우리가 만든 것만 지운다: `.md` 아닌 파일과 숨김 파일은 건드리지 않는다.
   */
  let removed = 0;
  if (total > 0) {
    const sweep = (rel: string) => {
      const dir = path.join(destDir, rel);
      if (!existsSync(dir)) return;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name.startsWith(".")) continue;
        const relPath = path.join(rel, ent.name);
        if (ent.isDirectory()) {
          sweep(relPath);
          continue;
        }
        if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
        if (seen.has(relPath)) continue;
        chmodSync(path.join(destDir, relPath), 0o644); // 사본은 0444 라 지우기 전에 푼다
        rmSync(path.join(destDir, relPath));
        removed++;
      }
    };
    sweep("");
  }
  return { dir: destDir, total, copied, removed };
}

/** Where the snapshot lives for a data dir. */
export function wikiSnapshotDir(dataDir: string): string {
  return path.join(dataDir, "wiki");
}
