/**
 * 성과 분석 단계 앞에 홈페이지(gepa.kr) 자료를 자료함에 채운다 — 검색어는 사업명과 원장의 세부사업 이름,
 * 기간은 원장의 사업연도. 하루 안에 받은 것이 있으면 다시 받지 않는다(재실행·이어서 수정 때 기다리지 않게).
 * 홈페이지가 응답하지 않아도 단계는 그대로 진행한다 — 보조 자료일 뿐이다.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { readLedger } from "./store";
import { materialsDir, writeMaterialsIndex } from "./materials";
import { saveGepaPosts, searchGepaSite, webDir, type SavedGepaPost } from "./gepaSite";

const FRESH_MS = 24 * 60 * 60 * 1000;

export function projectYear(title: string, startDate?: string): number | undefined {
  const y = Number(startDate?.slice(0, 4)) || Number(/(20\d\d)\s*년/.exec(title)?.[1]);
  return y || undefined;
}

export async function collectWebMaterials(projectId: string, title: string, opts: { force?: boolean } = {}): Promise<{ posts: SavedGepaPost[]; skipped?: boolean; error?: string }> {
  const dir = materialsDir(projectId);
  const marker = join(webDir(dir), "posts.json");
  if (!opts.force && existsSync(marker) && Date.now() - statSync(marker).mtimeMs < FRESH_MS) return { posts: [], skipped: true };
  const l = readLedger(projectId);
  const subprojects = l.ok ? [...new Set(l.ledger.예산.map((b) => b.세부사업).filter((s): s is string => !!s))] : [];
  try {
    const found = await searchGepaSite({ title, subprojects, year: projectYear(title, l.ok ? l.ledger.시작일 : undefined) });
    const posts = await saveGepaPosts(dir, found);
    if (existsSync(dir)) writeMaterialsIndex(projectId);
    return { posts };
  } catch (e) {
    return { posts: [], error: (e as Error).message };
  }
}
