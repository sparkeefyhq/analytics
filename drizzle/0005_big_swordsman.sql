CREATE TABLE `cohort_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`age_band` text DEFAULT 'other' NOT NULL,
	`relationship_state` text DEFAULT 'other' NOT NULL,
	`recruitment_source` text DEFAULT '' NOT NULL,
	`close_friend_or_teammate` integer DEFAULT false NOT NULL,
	`situation_category` text DEFAULT 'other' NOT NULL,
	`onboarding_completed` integer DEFAULT false NOT NULL,
	`meaningful_activation` integer DEFAULT false NOT NULL,
	`independently_activated` integer DEFAULT false NOT NULL,
	`first_answer_useful` text DEFAULT 'not-rated' NOT NULL,
	`genuine_request_count` integer DEFAULT 0 NOT NULL,
	`usefulness_response_count` integer DEFAULT 0 NOT NULL,
	`reminder_test_count` integer DEFAULT 0 NOT NULL,
	`reminder_tested` integer DEFAULT false NOT NULL,
	`reminder_delivery_result` text DEFAULT 'not-tested' NOT NULL,
	`reminder_destination_result` text DEFAULT 'not-tested' NOT NULL,
	`return_source` text DEFAULT 'unknown' NOT NULL,
	`founder_explained_product` integer DEFAULT false NOT NULL,
	`founder_helped_onboarding` integer DEFAULT false NOT NULL,
	`founder_suggested_situation` integer DEFAULT false NOT NULL,
	`founder_helped_request` integer DEFAULT false NOT NULL,
	`founder_solved_problem` integer DEFAULT false NOT NULL,
	`founder_prompted_return` integer DEFAULT false NOT NULL,
	`trust_concern` integer DEFAULT false NOT NULL,
	`product_issue` integer DEFAULT false NOT NULL,
	`evidence_note` text DEFAULT '' NOT NULL,
	`notion_reference_url` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cohort_evidence_phase_participant` ON `cohort_evidence` (`phase_id`,`participant_id`);--> statement-breakpoint
CREATE TABLE `release_gates` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`actual` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_release_gates_phase_position` ON `release_gates` (`phase_id`,`position`);--> statement-breakpoint
ALTER TABLE `metrics` ADD `value_type` text DEFAULT 'number' NOT NULL;--> statement-breakpoint
ALTER TABLE `metrics` ADD `target_denominator` integer;--> statement-breakpoint
ALTER TABLE `metrics` ADD `actual_denominator` integer;--> statement-breakpoint
ALTER TABLE `metrics` ADD `minimum_denominator` integer;--> statement-breakpoint
ALTER TABLE `metrics` ADD `definition` text DEFAULT '' NOT NULL;