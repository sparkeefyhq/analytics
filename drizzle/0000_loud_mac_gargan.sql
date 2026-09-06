CREATE TABLE `checks` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_id` text NOT NULL,
	`position` integer NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`target` real NOT NULL,
	`actual` real,
	`unit` text DEFAULT '%' NOT NULL,
	`comparator` text DEFAULT 'gte' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `phases` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`objective` text NOT NULL,
	`user_min` integer NOT NULL,
	`user_max` integer NOT NULL,
	`duration_min` integer NOT NULL,
	`duration_max` integer NOT NULL,
	`duration_unit` text DEFAULT 'days' NOT NULL,
	`actual_users` integer DEFAULT 0 NOT NULL,
	`elapsed_days` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'locked' NOT NULL,
	`features` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
