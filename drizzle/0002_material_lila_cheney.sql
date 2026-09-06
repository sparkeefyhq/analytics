CREATE TABLE `diary_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`entry_date` text NOT NULL,
	`completed` text DEFAULT '' NOT NULL,
	`moved_forward` text DEFAULT '' NOT NULL,
	`learned` text DEFAULT '' NOT NULL,
	`blocker` text DEFAULT '' NOT NULL,
	`insight` text DEFAULT '' NOT NULL,
	`tomorrow` text DEFAULT '' NOT NULL,
	`mood` text DEFAULT 'Focused' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`finished_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_diary_owner_date` ON `diary_entries` (`owner_email`,`entry_date`);--> statement-breakpoint
CREATE TABLE `founder_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`due_date` text,
	`due_time` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`category` text DEFAULT 'General' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`link` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_founder_tasks_owner_status_due` ON `founder_tasks` (`owner_email`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `routine_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`time` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_routine_occurrence_owner_date` ON `routine_occurrences` (`owner_email`,`date`);--> statement-breakpoint
CREATE INDEX `idx_routine_occurrence_unique` ON `routine_occurrences` (`routine_id`,`date`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`title` text NOT NULL,
	`time` text NOT NULL,
	`position` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suggestion_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`suggestion_id` text NOT NULL,
	`author_email` text NOT NULL,
	`body` text NOT NULL,
	`parent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_suggestion_replies_suggestion` ON `suggestion_replies` (`suggestion_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `suggestion_votes` (
	`suggestion_id` text NOT NULL,
	`author_email` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`author_email` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`category` text DEFAULT 'Other' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`phase_id` text,
	`status` text DEFAULT 'new' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`founder_priority` integer DEFAULT false NOT NULL,
	`founder_note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_suggestions_status_created` ON `suggestions` (`status`,`created_at`);