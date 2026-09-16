/**
 * Read-only snapshot of the institution's internal wiki (`GEPA_WIKI_DIR`, e.g. the
 * GEPA_AI_Office LLM wiki) for the research stage. `--add-dir` grants the agent *write* access
 * to a tree, so the original is never mounted; `.md` files are copied into <dataDir>/wiki and
 * made read-only (0444). Only new/changed files (size or mtime) are copied on later runs.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, utimesSync } from "node:fs";
import path from "node:path";

export interface WikiSyncResult {
  dir: string;
  total: number;
  copied: number;
}

export function syncWikiSnapshot(srcDir: string, destDir: string): WikiSyncResult {
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) throw new Error(`GEPA_WIKI_DIR 가 없습니다: ${srcDir}`);
  mkdirSync(destDir, { recursive: true });
  let total = 0;
  let copied = 0;
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
  return { dir: destDir, total, copied };
}

/** Where the snapshot lives for a data dir. */
export function wikiSnapshotDir(dataDir: string): string {
  return path.join(dataDir, "wiki");
}
