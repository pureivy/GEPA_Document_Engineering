/** Row → DTO mapping shared by the project API routes (route files may only export handlers). */
import type { ProjectRow } from "./schema";
import type { ProjectDTO } from "../contracts";

export function serializeProject(row: ProjectRow): ProjectDTO {
  let contact: Record<string, string> = {};
  try {
    contact = JSON.parse(row.contact) as Record<string, string>;
  } catch {
    contact = {};
  }
  return {
    id: row.id,
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
