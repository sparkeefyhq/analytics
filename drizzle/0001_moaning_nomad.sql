CREATE INDEX `idx_checks_phase_position` ON `checks` (`phase_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_metrics_phase_position` ON `metrics` (`phase_id`,`position`);