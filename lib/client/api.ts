/**
 * Browser-side API wrappers. All route paths live here so the server contract is in one place.
 * Pure `fetch`; no server imports (this file is bundled into the client).
 */
import type { DocModel } from "@/lib/docmodel/schema";
import type { ExportReportDTO, ProjectDTO, RunDTO, Stage } from "@/lib/contracts";
import type { ProjectKind } from "@/lib/kinds";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  } catch (e) {
    throw new ApiError(0, `서버에 연결할 수 없습니다 (${(e as Error).message})`);
  }
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : typeof body === "string" && body ? body.slice(0, 300) : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

const json = (v: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(v) });

export interface NewProjectInput {
  /** 문서 종류. 생략하면 서버가 "program" 으로 본다 */
  kind: ProjectKind;
  title: string;
  topic: string;
  region: string;
  organizer: string;
  contact: ProjectDTO["contact"];
}

export interface VersionDTO {
  seq: number;
  source: string;
  createdAt: string;
}

export const stageBase = (projectId: string, stage: Stage) => `/api/projects/${encodeURIComponent(projectId)}/stages/${stage}`;

export interface ProjectDetail {
  project: ProjectDTO;
  runs: RunDTO[];
  /** per-stage summary (present in the current server implementation) */
  stages?: Partial<Record<Stage, { latestRun: RunDTO | null; activeRunId: string | null }>>;
}

export const api = {
  // projects — tolerate both the bare-array and the `{ projects }` envelope
  listProjects: async () => {
    const r = await request<ProjectDTO[] | { projects: ProjectDTO[] }>("/api/projects");
    return Array.isArray(r) ? r : r.projects;
  },
  createProject: async (input: NewProjectInput) => {
    const r = await request<ProjectDTO | { project: ProjectDTO }>("/api/projects", json(input));
    return "project" in r ? r.project : r;
  },
  getProject: (id: string) => request<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`),
  /** upload a 기존 사업계획서 (+ 변경 사항); autoRun starts 조사 → … automatically */
  uploadReference: async (id: string, file: File, changes: string, autoRun: boolean, supplementalResearch = false) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("changes", changes);
    fd.append("autoRun", autoRun ? "1" : "0");
    fd.append("supplementalResearch", supplementalResearch ? "1" : "0");
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/reference`, { method: "POST", body: fd, headers: { Accept: "application/json" } });
    const body = (await res.json().catch(() => ({}))) as { error?: string; project?: ProjectDTO; chars?: number; truncated?: boolean };
    if (!res.ok) throw new ApiError(res.status, body.error ?? `${res.status} ${res.statusText}`, body);
    return body as { project: ProjectDTO; chars: number; truncated: boolean };
  },
  deleteProject: (id: string) => request<{ ok: true; id: string }>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // runs
  runStage: (projectId: string, stage: Stage, opts: { resume?: boolean; instruction?: string; model?: string; autoChain?: boolean; supplementalResearch?: boolean } = {}) =>
    request<{ runId: string; sessionId: string }>(
      `${stageBase(projectId, stage)}/run`,
      json(opts),
    ),
  /** run the reviewer on the given stage's document (stage=review, --json-schema) */
  runReview: (projectId: string, target: Stage) =>
    request<{ runId: string; sessionId: string }>(`/api/projects/${encodeURIComponent(projectId)}/stages/review/run`, json({ reviewTarget: target })),
  getRun: (runId: string) => request<{ run: RunDTO; active: boolean }>(`/api/runs/${encodeURIComponent(runId)}`),
  cancelRun: (runId: string) => request<unknown>(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  eventsUrl: (runId: string) => `/api/runs/${encodeURIComponent(runId)}/events`,

  // documents
  getDoc: (projectId: string, stage: Stage) => request<{ doc: DocModel | null; version: number }>(`${stageBase(projectId, stage)}/doc`),
  getDsl: (projectId: string, stage: Stage) => request<{ dsl?: string; markdown?: string } | string>(`${stageBase(projectId, stage)}/doc?format=dsl`, { headers: { Accept: "text/plain, application/json" } }),
  getResearch: (projectId: string) => request<{ markdown: string }>(`${stageBase(projectId, "research")}/doc`),
  putDoc: (projectId: string, stage: Stage, doc: DocModel) => request<{ version: number }>(`${stageBase(projectId, stage)}/doc`, { method: "PUT", body: JSON.stringify({ doc }) }),

  // export / render / download
  exportStage: (projectId: string, stage: Stage) => request<ExportReportDTO>(`${stageBase(projectId, stage)}/export`, { method: "POST" }),
  renderManifest: (projectId: string, stage: Stage) => request<{ pages: number; hash: string }>(`${stageBase(projectId, stage)}/render/manifest`),
  /** page index is 0-based (docs/architecture.md M4: "page 0 SVG") */
  renderPageUrl: (projectId: string, stage: Stage, page: number, hash?: string) => `${stageBase(projectId, stage)}/render?page=${page}${hash ? `&h=${encodeURIComponent(hash)}` : ""}`,
  downloadUrl: (projectId: string, stage: Stage, format: "hwpx" | "pdf" | "md" | "txt") => `${stageBase(projectId, stage)}/download?format=${format}`,

  // history
  history: (projectId: string, stage: Stage) => request<{ versions: VersionDTO[] }>(`${stageBase(projectId, stage)}/history`),
  restore: (projectId: string, stage: Stage, seq: number) => request<unknown>(`${stageBase(projectId, stage)}/history/restore`, json({ seq })),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.status ? `${e.message} (HTTP ${e.status})` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
