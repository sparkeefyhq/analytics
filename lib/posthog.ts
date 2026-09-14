/**
 * Phase 0 observation types for the Plan page's `analytics.phase0` payload.
 *
 * Historical note: this module used to hold the PostHog HogQL client and the
 * Phase 0 metric queries. PostHog was removed as a source on 2026-09-15 —
 * every Phase 0 number now comes from sparkeefy-backend's Postgres via
 * `lib/analytics-v2/phase0-backend.ts`. Only the shared types (and the
 * honest `unavailable` helper) remain here so the existing API contract and
 * UI keep the same shape.
 */

export type ObservationStatus = "available" | "pending" | "unavailable" | "error";
export type ObservationSource = "backend" | "posthog" | "play-console" | "manual" | "reconciled";

export type Observation = {
  count: number | null;
  denominator?: number | null;
  pending?: number;
  excluded?: number;
  status: ObservationStatus;
  source: ObservationSource;
};

export type ActivePeriod = "today" | "week" | "month" | "all";

export type TopUser = {
  distinctId: string;
  email: string | null;
  name?: string | null;
  messageCount: number;
};

/** Matches CONTROL_PHASE0_API_CONTRACT.md's `analytics.phase0` shape. */
export type Phase0Snapshot = {
  version: 1;
  cohort: "phase-0";
  updatedAt: string | null;
  metrics: Record<string, Observation>;
  activeUsers: Record<ActivePeriod, Observation>;
  topUsers?: TopUser[];
};

export const unavailable = (source: ObservationSource = "backend"): Observation => ({
  count: null,
  status: "unavailable",
  source,
});
