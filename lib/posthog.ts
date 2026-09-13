import { env } from "@/lib/runtime-env";

/**
 * Server-only PostHog query client + Phase 0 metric builders.
 *
 * This module never runs in a browser and its credential (POSTHOG_API_KEY)
 * must only ever exist as a server-side secret — never a Vite public env
 * var. See CONTROL_PHASE0_API_CONTRACT.md and
 * USERS_POSTHOG_HANDOFF.md for the full contract this implements.
 */

export type ObservationStatus = "available" | "pending" | "unavailable" | "error";
export type ObservationSource = "posthog" | "play-console" | "manual" | "reconciled";

export type Observation = {
  count: number | null;
  denominator?: number | null;
  pending?: number;
  excluded?: number;
  status: ObservationStatus;
  source: ObservationSource;
};

/** Matches CONTROL_PHASE0_API_CONTRACT.md's `analytics.phase0` shape
 * exactly. `metrics` is intentionally an open record — the frontend
 * (vercel-static/src/phase0-data.ts) only renders the IDs it knows about
 * today, but the API is free to carry more (e.g. the day2-4 return metrics)
 * for a future UI update without another backend change. */
export type Phase0Snapshot = {
  version: 1;
  cohort: "phase-0";
  updatedAt: string | null;
  metrics: Record<string, Observation>;
  activeUsers: Record<ActivePeriod, Observation>;
};

export const unavailable = (source: ObservationSource = "posthog"): Observation => ({
  count: null,
  status: "unavailable",
  source,
});

export class PostHogUnavailableError extends Error {}

function posthogConfig() {
  const record = env as unknown as Record<string, string | undefined>;
  const host = record.POSTHOG_HOST;
  const projectId = record.POSTHOG_PROJECT_ID;
  const apiKey = record.POSTHOG_API_KEY;
  if (!host || !projectId || !apiKey) return null;
  return { host, projectId, apiKey };
}

/**
 * Runs one HogQL query against PostHog's private query API and returns the
 * raw result rows. Callers degrade a single metric to `unavailable`/`error`
 * on failure — one PostHog hiccup must never fail the whole tracker response.
 */
export async function postHogQuery(hogql: string): Promise<unknown[][]> {
  const config = posthogConfig();
  if (!config) throw new PostHogUnavailableError("PostHog is not configured.");
  let response: Response;
  try {
    response = await fetch(`${config.host}/api/projects/${config.projectId}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new PostHogUnavailableError(
      error instanceof Error ? error.message : "PostHog request failed.",
    );
  }
  if (!response.ok) {
    throw new PostHogUnavailableError(`PostHog query failed with status ${response.status}.`);
  }
  const body = (await response.json()) as { results?: unknown[][] };
  if (!Array.isArray(body.results)) throw new PostHogUnavailableError("Malformed PostHog response.");
  return body.results;
}

async function scalar(hogql: string): Promise<number | null> {
  const rows = await postHogQuery(hogql);
  const value = rows[0]?.[0];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Escapes a distinct_id list for a HogQL `IN (...)` clause. Values here are
 * opaque distinct_ids we ourselves stored in D1, never end-user free text,
 * but this still avoids building HogQL by naive string concatenation. */
export function hogqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function idList(distinctIds: string[]): string {
  return distinctIds.map(hogqlString).join(",");
}

export type CohortIdentity = { participantId: string; distinctId: string | null };

/**
 * Every "eligible cohort" metric needs the set of mapped distinct_ids and
 * how many participants are still unmapped (those stay `pending`, never
 * silently dropped from the denominator or coerced to zero).
 */
function splitCohort(cohort: CohortIdentity[]) {
  const mapped = cohort.filter((p): p is { participantId: string; distinctId: string } => p.distinctId !== null);
  const unmapped = cohort.length - mapped.length;
  return { mapped, unmapped };
}

/** Simple "unique users who ever fired this event" milestone, scoped to the
 * mapped cohort. Used for first_open, onboarding, first_answer,
 * calendar_created, and the person/memory ordinal milestones. */
export async function cohortMilestone(
  cohort: CohortIdentity[],
  event: string,
  extraWhere = "",
): Promise<Observation> {
  const { mapped, unmapped } = splitCohort(cohort);
  if (mapped.length === 0) return { count: null, denominator: cohort.length || null, pending: unmapped, status: "pending", source: "posthog" };
  try {
    const count = await scalar(
      `SELECT count(DISTINCT person_id) FROM events WHERE event = '${event}' AND distinct_id IN (${idList(mapped.map((p) => p.distinctId))})${extraWhere ? ` AND ${extraWhere}` : ""}`,
    );
    return { count, denominator: cohort.length || null, pending: unmapped, status: "available", source: "posthog" };
  } catch {
    return { count: null, denominator: cohort.length || null, pending: unmapped, status: "error", source: "posthog" };
  }
}

/** person_1/2/3 and memory_1/2: unique cohort users who reached an ordinal
 * count via the person_count_after / memory_count_after properties added to
 * production on 2026-09-13. */
export function cohortOrdinalMilestone(
  cohort: CohortIdentity[],
  event: "person_context_created" | "memory_added",
  property: "person_count_after" | "memory_count_after",
  atLeast: number,
): Promise<Observation> {
  return cohortMilestone(cohort, event, `properties.${property} >= ${atLeast}`);
}

/** Day-N return window since each participant's own first_open, N in
 * [1,2,3,4] mapping to Analytics' [0,24h)/[24,48h)/[48,72h)/[72,96h)
 * convention. Denominator only includes participants whose window has fully
 * elapsed; everyone else is `pending`, never counted as a failed return. */
export async function cohortDayWindowReturn(
  cohort: CohortIdentity[],
  returningEvent: string,
  dayIndex: number,
  minimumEvents = 1,
): Promise<Observation> {
  const { mapped, unmapped } = splitCohort(cohort);
  if (mapped.length === 0) return { count: null, denominator: null, pending: cohort.length, status: "pending", source: "posthog" };
  const windowStartHours = (dayIndex - 1) * 24;
  const windowEndHours = dayIndex * 24;
  try {
    // Validated against live PostHog data before landing here — ClickHouse/
    // HogQL does not support correlated subqueries, so the "did this person
    // return in their window" check is an INNER JOIN, not an EXISTS/IN
    // referencing the outer row.
    const rows = await postHogQuery(
      `WITH first_opens AS (
         SELECT distinct_id, min(timestamp) AS first_open_at
         FROM events WHERE event = 'first_open' AND distinct_id IN (${idList(mapped.map((p) => p.distinctId))})
         GROUP BY distinct_id
       ),
       window_closed AS (
         SELECT distinct_id, first_open_at FROM first_opens
         WHERE now() >= first_open_at + INTERVAL ${windowEndHours} HOUR
       ),
       returned AS (
         SELECT e.distinct_id AS distinct_id
         FROM events AS e
         INNER JOIN window_closed AS w ON e.distinct_id = w.distinct_id
         WHERE e.event = '${returningEvent}'
           AND e.timestamp >= w.first_open_at + INTERVAL ${windowStartHours} HOUR
           AND e.timestamp < w.first_open_at + INTERVAL ${windowEndHours} HOUR
         GROUP BY e.distinct_id
         HAVING count() >= ${Math.max(1, Math.floor(minimumEvents))}
       )
       SELECT (SELECT count() FROM window_closed) AS window_closed_count,
              (SELECT count() FROM returned) AS returned_count`,
    );
    const [windowClosed, returned] = (rows[0] as [number, number] | undefined) ?? [0, 0];
    return {
      count: returned ?? null,
      denominator: windowClosed ?? null,
      pending: mapped.length - (windowClosed ?? 0) + unmapped,
      status: "available",
      source: "posthog",
    };
  } catch {
    return { count: null, denominator: null, pending: cohort.length, status: "error", source: "posthog" };
  }
}

/** organic_second: a second genuine situation within 72h of the first,
 * attributed organic — mirrors the "Second genuine situation within 72h"
 * PostHog funnel already validated in the PostHog UI this session. */
export async function organicSecondSituation(cohort: CohortIdentity[]): Promise<Observation> {
  const { mapped, unmapped } = splitCohort(cohort);
  if (mapped.length === 0) return { count: null, denominator: null, pending: cohort.length, status: "pending", source: "posthog" };
  try {
    // Validated against live PostHog data before landing here (join-based,
    // no correlated subqueries — see cohortDayWindowReturn's comment).
    const rows = await postHogQuery(
      `WITH firsts AS (
         SELECT distinct_id, min(timestamp) AS first_at
         FROM events WHERE event = 'genuine_situation_started' AND distinct_id IN (${idList(mapped.map((p) => p.distinctId))})
         GROUP BY distinct_id
       ),
       eligible AS (
         SELECT distinct_id, first_at FROM firsts WHERE now() >= first_at + INTERVAL 72 HOUR
       ),
       organic_second AS (
         SELECT DISTINCT e.distinct_id AS distinct_id
         FROM events AS e
         INNER JOIN eligible AS el ON e.distinct_id = el.distinct_id
         WHERE e.event = 'second_situation_started'
           AND e.properties.return_source = 'organic'
           AND e.timestamp < el.first_at + INTERVAL 72 HOUR
       )
       SELECT (SELECT count() FROM eligible) AS eligible_count,
              (SELECT count() FROM organic_second) AS organic_second_count`,
    );
    const [eligible, organicSecond] = (rows[0] as [number, number] | undefined) ?? [0, 0];
    return { count: organicSecond ?? null, denominator: eligible ?? null, pending: unmapped, status: "available", source: "posthog" };
  } catch {
    return { count: null, denominator: null, pending: cohort.length, status: "error", source: "posthog" };
  }
}

/** reminder_return: a reminder_opened followed by response_started from the
 * same person within 30 minutes. Always "assisted", never organic. */
export async function reminderReturn(cohort: CohortIdentity[]): Promise<Observation> {
  const { mapped, unmapped } = splitCohort(cohort);
  if (mapped.length === 0) return { count: null, denominator: null, pending: cohort.length, status: "pending", source: "posthog" };
  try {
    // Validated against live PostHog data before landing here (join-based,
    // no correlated subqueries — see cohortDayWindowReturn's comment).
    const rows = await postHogQuery(
      `WITH opens AS (
         SELECT distinct_id, timestamp AS opened_at
         FROM events WHERE event = 'reminder_opened' AND distinct_id IN (${idList(mapped.map((p) => p.distinctId))})
       ),
       matched AS (
         SELECT DISTINCT opens.distinct_id AS distinct_id
         FROM opens
         INNER JOIN events AS r ON r.distinct_id = opens.distinct_id
         WHERE r.event = 'response_started'
           AND r.timestamp >= opens.opened_at AND r.timestamp < opens.opened_at + INTERVAL 30 MINUTE
       )
       SELECT (SELECT count(DISTINCT distinct_id) FROM opens) AS opened_count,
              (SELECT count() FROM matched) AS returned_count`,
    );
    const [openedCount, returnedCount] = (rows[0] as [number, number] | undefined) ?? [0, 0];
    if (!openedCount) return { count: null, denominator: null, pending: cohort.length, status: "unavailable", source: "posthog" };
    return { count: returnedCount ?? null, denominator: openedCount ?? null, pending: unmapped, status: "available", source: "posthog" };
  } catch {
    return { count: null, denominator: null, pending: cohort.length, status: "error", source: "posthog" };
  }
}

/** responses_complete / responses_failed: request counts, not user counts. */
export async function requestCount(event: "response_completed" | "response_failed"): Promise<Observation> {
  try {
    const count = await scalar(`SELECT count() FROM events WHERE event = '${event}'`);
    return { count, status: "available", source: "posthog" };
  } catch {
    return { count: null, status: "error", source: "posthog" };
  }
}

const IST_TZ = "Asia/Kolkata";
/** Measurement-start watermark for the "all" active-users window — the day
 * Phase 0 instrumentation went live in production. Not a magic literal
 * scattered through query strings. */
export const MEASUREMENT_START = "2026-09-13T00:00:00+05:30";

export type ActivePeriod = "today" | "week" | "month" | "all";

/** activeUsers.{today,week,month,all}: unique users with foreground activity
 * (wingman_opened) in each IST calendar window, project-wide. Deliberately
 * NOT scoped to the manually-verified Phase 0 cohort — this widget mirrors
 * the same live PostHog activity already shown on the "Sparkeefy Founder
 * View" PostHog dashboard, so it stays connected the moment PostHog
 * credentials are configured rather than waiting on anyone to manually link
 * individual cohort participants to a distinct_id. */
export async function activeUsersForPeriod(period: ActivePeriod): Promise<Observation> {
  const boundary =
    period === "today"
      ? `toStartOfDay(toTimeZone(now(), '${IST_TZ}'))`
      : period === "week"
        ? `toStartOfWeek(toTimeZone(now(), '${IST_TZ}'), 1)`
        : period === "month"
          ? `toStartOfMonth(toTimeZone(now(), '${IST_TZ}'))`
          : `toDateTime('${MEASUREMENT_START}')`;
  try {
    const count = await scalar(
      `SELECT count(DISTINCT distinct_id) FROM events
       WHERE event = 'wingman_opened' AND toTimeZone(timestamp, '${IST_TZ}') >= ${boundary}`,
    );
    return { count, status: "available", source: "posthog" };
  } catch {
    return { count: null, status: "error", source: "posthog" };
  }
}
