CREATE TABLE `phase1_state` (
	`phase_id` text PRIMARY KEY NOT NULL,
	`decision_1a` text,
	`final_decision` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `phase1_wedge_signals` (
	`wedge` text NOT NULL,
	`field` text NOT NULL,
	`numeric_value` real,
	`text_value` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`wedge`, `field`)
);
--> statement-breakpoint
ALTER TABLE `phases` ADD `started_at` text;