CREATE TABLE `founder_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT 'Other' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`scheduled_date` text NOT NULL,
	`scheduled_time` text NOT NULL,
	`meeting_link` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`preparation_goal` text DEFAULT '' NOT NULL,
	`talking_points` text DEFAULT '' NOT NULL,
	`questions` text DEFAULT '' NOT NULL,
	`desired_next_step` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`next_step` text DEFAULT '' NOT NULL,
	`follow_up_date` text,
	`private_notes` text DEFAULT '' NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_founder_meetings_owner_date` ON `founder_meetings` (`owner_email`,`scheduled_date`,`scheduled_time`);--> statement-breakpoint
CREATE TABLE `founder_settings` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`launch_date` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `founder_tasks` ADD `icon_type` text;--> statement-breakpoint
ALTER TABLE `founder_tasks` ADD `icon_source` text DEFAULT 'inferred' NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `icon_type` text;--> statement-breakpoint
ALTER TABLE `routines` ADD `icon_source` text DEFAULT 'inferred' NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `link` text DEFAULT '' NOT NULL;