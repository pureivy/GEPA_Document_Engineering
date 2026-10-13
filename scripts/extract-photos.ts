/**
 * 이미 올린 정산·결과 자료(hwpx)에서 사진을 꺼낸다 — 사진 대지 기능(2026-10-07) 이전에 만든 프로젝트용.
 *   pnpm tsx scripts/extract-photos.ts <projectId> [<projectId> …]
 */
import { refreshMaterialPhotos } from "../lib/closeout/materials";

for (const id of process.argv.slice(2)) console.log(id, "사진", refreshMaterialPhotos(id), "장");
