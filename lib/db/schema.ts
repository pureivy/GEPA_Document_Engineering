import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Timestamps are ISO-8601 strings (matches lib/contracts.ts DTOs). */

export const STAGE_VALUES = ["research", "plan", "notice", "press", "official", "review"] as const;
export const RUN_STATUS_VALUES = ["running", "succeeded", "failed", "cancelled"] as const;
export const DOC_SOURCE_VALUES = ["agent", "user", "restore"] as const;

export type StageValue = (typeof STAGE_VALUES)[number];
export type RunStatus = (typeof RUN_STATUS_VALUES)[number];
export type DocSource = (typeof DOC_SOURCE_VALUES)[number];

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  /** ProjectKind (lib/kinds.ts) — derives the project's stage list. Existing rows default to program. */
  kind: text("kind").notNull().default("program"),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  region: text("region").notNull().default(""),
  organizer: text("organizer").notNull().default(""),
  /** JSON: { 담당자?, 부서?, 전화?, 이메일?, 우편주소? … } */
  contact: text("contact").notNull().default("{}"),
  /** uploaded 기존 사업계획서 (file name under projects/<id>/reference/, extracted text in base-plan.md) */
  referenceName: text("reference_name"),
  /** what changed versus the uploaded plan (free text) */
  referenceChanges: text("reference_changes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: STAGE_VALUES }).notNull(),
    sessionId: text("session_id").notNull(),
    status: text("status", { enum: RUN_STATUS_VALUES }).notNull().default("running"),
    model: text("model").notNull().default("opus"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    numTurns: integer("num_turns"),
    costUsd: real("cost_usd"),
    error: text("error"),
    /** JSON: free-form summary (usage, subtype, final text excerpt …) */
    summary: text("summary"),
  },
  (t) => [index("runs_project_stage_idx").on(t.projectId, t.stage, t.startedAt)],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** `<kind>:<data.type>` e.g. `agent:text.delta`, `doc:block.open`, `run:status` */
    type: text("type").notNull(),
    /** JSON-encoded frame data (AgentEvent for kind=agent) */
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("run_events_run_seq_uq").on(t.runId, t.seq)],
);

export const docVersions = sqliteTable(
  "doc_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: STAGE_VALUES }).notNull(),
    seq: integer("seq").notNull(),
    source: text("source", { enum: DOC_SOURCE_VALUES }).notNull(),
    /** JSON-encoded DocModel */
    doc: text("doc").notNull(),
    dsl: text("dsl"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("doc_versions_project_stage_seq_uq").on(t.projectId, t.stage, t.seq)],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;
export type RunEventRow = typeof runEvents.$inferSelect;
export type NewRunEventRow = typeof runEvents.$inferInsert;
export type DocVersionRow = typeof docVersions.$inferSelect;
export type NewDocVersionRow = typeof docVersions.$inferInsert;
