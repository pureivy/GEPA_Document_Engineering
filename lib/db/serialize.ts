/** Row → DTO mapping shared by the project API routes (route files may only export handlers). */
import type { ProjectRow } from "./schema";
import type { ProjectDTO } from "../contracts";
import { isProjectKind } from "../kinds";

export function serializeProject(row: ProjectRow): ProjectDTO {
  let contact: Record<string, string> = {};
  try {
    contact = JSON.parse(row.contact) as Record<string, string>;
  } catch {
    contact = {};
  }
  return {
    id: row.id,
    // 알 수 없는 값(손으로 고친 행, 옛 마이그레이션)은 사업으로 떨어뜨린다 — 단계 목록이 비면 화면이 빈다
    kind: isProjectKind(row.kind) ? row.kind : "program",
    title: row.title,
    topic: row.topic,
    region: row.region,
    organizer: row.organizer,
    contact: contact as ProjectDTO["contact"],
    ...(row.referenceName ? { reference: { fileName: row.referenceName, changes: row.referenceChanges ?? "" } } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
