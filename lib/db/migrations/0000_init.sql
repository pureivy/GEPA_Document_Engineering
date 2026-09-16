CREATE TABLE `doc_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`seq` integer NOT NULL,
	`source` text NOT NULL,
	`doc` text NOT NULL,
	`dsl` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_versions_project_stage_seq_uq` ON `doc_versions` (`project_id`,`stage`,`seq`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`topic` text NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`organizer` text DEFAULT '' NOT NULL,
	`contact` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_run_seq_uq` ON `run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`session_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`model` text DEFAULT 'opus' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`num_turns` integer,
	`cost_usd` real,
	`error` text,
	`summary` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_project_stage_idx` ON `runs` (`project_id`,`stage`,`started_at`);