import { env } from "@/lib/runtime-env";
import { fetchUserNames, type UserNamesResult } from "@/lib/backend-admin";

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
  /** "Which user used Wingman most" — ranked by raw message volume,
   * project-wide, straight from PostHog. Populated once TopUser is defined
   * further down this file. */
  topUsers?: TopUser[];
  /** Why `topUsers[].name` is null for everyone, when it is — "ok" means
   * names resolved normally (just none matched, or the users genuinely
   * haven't set a name). Anything else means the backend name lookup itself
   * failed: "not_configured" (env vars missing), "unauthorized" (wrong
   * admin key), "backend_error", or "network_error". */
  topUsersNameSource?: UserNamesResult["status"];
  /** The backend's live ANALYTICS_PHASE, read straight off recent events'
   * `phase` property — not something this dashboard decides or assumes.
   * `null` when it can't be determined (PostHog unreachable, or no events
   * yet). See apps/api/src/lib/analytics-context.ts on the backend. */
  activePhase?: "phase_0" | "phase_1" | null;
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

/** Escapes a string for use inside a HogQL literal. */
export function hogqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Launch-reset watermark: the moment "today" starts for every Phase 0
 * metric, matching the `date_from` baked into the PostHog "Sparkeefy
 * Founder View" dashboard's own insights exactly (verified live via
 * `system.insights` on 2026-09-13). Everything before this — dev/test
 * traffic from earlier setup and testing — must never count.
 *
 * IMPORTANT: if that PostHog dashboard is ever reset again to a new
 * moment, this constant must be updated to match, or the two dashboards
 * will silently drift apart again the way they did before this fix.
 */
export const MEASUREMENT_START = "2026-09-13T15:31:00+05:30";

const PHASE0_SCHEMA_VERSION = "2026-09-phase0.1";

/**
 * The same two-part filter every PostHog "Sparkeefy Founder View" insight
 * applies: the current Phase 0 instrumentation schema tag, and the launch
 * watermark above. Apply this to every base event reference in every query
 * below (pass the table alias, e.g. "e.", when the query aliases `events`)
 * so our own analytics page can never show a different number than the
 * PostHog dashboard for the same underlying event.
 */
function phase0Filter(prefix = ""): string {
  return `${prefix}properties.analytics_schema_version = ${hogqlString(PHASE0_SCHEMA_VERSION)} AND ${prefix}timestamp >= toDateTime(${hogqlString(MEASUREMENT_START)})`;
}

/**
 * A specific, known person's PostHog identity — still used by the private
 * Users page (app/api/control/users/route.ts) to look up one individual's
 * own activity. Unrelated to the aggregate metrics below, which are
 * project-wide and never require anyone to be linked first.
 */
export type CohortIdentity = { participantId: string; distinctId: string | null };

/** Simple "unique users who ever fired this event" milestone, project-wide.
 * Used for first_open, onboarding, first_answer, calendar_created, and the
 * person/memory ordinal milestones. Always reflects live PostHog data —
 * never gated on any manual participant-linking step. */
export async function milestone(event: string, extraWhere = ""): Promise<Observation> {
  try {
    const count = await scalar(
      `SELECT count(DISTINCT person_id) FROM events WHERE event = '${event}' AND ${phase0Filter()}${extraWhere ? ` AND ${extraWhere}` : ""}`,
    );
    return { count, status: "available", source: "posthog" };
  } catch {
    return { count: null, status: "error", source: "posthog" };
  }
}

/** person_1/2/3 and memory_1/2: unique users project-wide who reached an
 * ordinal count via the person_count_after / memory_count_after properties
 * added to production on 2026-09-13. */
export function ordinalMilestone(
  event: "person_context_created" | "memory_added",
  property: "person_count_after" | "memory_count_after",
  atLeast: number,
): Promise<Observation> {
  return milestone(event, `properties.${property} >= ${atLeast}`);
}

/** Day-N return window since each user's own first_open, N in [1,2,3,4]
 * mapping to Analytics' [0,24h)/[24,48h)/[48,72h)/[72,96h) convention.
 * Project-wide, not gated behind manual cohort linking.
 *
 * IMPORTANT: the numerator counts anyone who already fired the event within
 * the *elapsed* portion of their own window — it does NOT wait for the full
 * window to close first. A launch-day founder needs to see "3 people opened
 * Wingman on Day 1" grow live as it happens, not a stuck 0 until 24 hours
 * have passed for every single person. The denominator (`eligible`) is
 * everyone whose window has at least *started* (for Day 1 that's
 * everyone with a first_open, immediately); `pending` is how many people
 * haven't reached that window yet at all. This never fabricates a rate —
 * it just stops conflating "hasn't happened yet" with "window not done."
 */
export async function dayWindowReturn(
  returningEvent: string,
  dayIndex: number,
  minimumEvents = 1,
): Promise<Observation> {
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
         FROM events WHERE event = 'first_open' AND ${phase0Filter()}
         GROUP BY distinct_id
       ),
       eligible AS (
         SELECT distinct_id, first_open_at FROM first_opens
         WHERE now() >= first_open_at + INTERVAL ${windowStartHours} HOUR
       ),
       returned AS (
         SELECT e.distinct_id AS distinct_id
         FROM events AS e
         INNER JOIN eligible AS el ON e.distinct_id = el.distinct_id
         WHERE e.event = '${returningEvent}'
           AND ${phase0Filter("e.")}
           AND e.timestamp >= el.first_open_at + INTERVAL ${windowStartHours} HOUR
           AND e.timestamp < el.first_open_at + INTERVAL ${windowEndHours} HOUR
         GROUP BY e.distinct_id
         HAVING count() >= ${Math.max(1, Math.floor(minimumEvents))}
       )
       SELECT (SELECT count() FROM first_opens) AS total_first_opens,
              (SELECT count() FROM eligible) AS eligible_count,
              (SELECT count() FROM returned) AS returned_count`,
    );
    const [totalFirstOpens, eligible, returned] = (rows[0] as [number, number, number] | undefined) ?? [0, 0, 0];
    return {
      count: returned ?? null,
      denominator: eligible ?? null,
      pending: Math.max(0, (totalFirstOpens ?? 0) - (eligible ?? 0)),
      status: "available",
      source: "posthog",
    };
  } catch {
    return { count: null, denominator: null, status: "error", source: "posthog" };
  }
}

/** request_days_2 / request_days_3: how many users sent a message on at
 * least `minDays` distinct calendar days within their own first 3 days
 * since first_open. Project-wide, live — grows as it happens rather than
 * waiting for the full 3-day window to close, same philosophy as
 * dayWindowReturn. Denominator is everyone with a first_open at all, since
 * day 0 (today) is immediately in scope. */
export async function daysActiveWithinWindow(minDays: 2 | 3): Promise<Observation> {
  try {
    // Validated against live PostHog data before landing here (join-based,
    // no correlated subqueries — see dayWindowReturn's comment).
    const rows = await postHogQuery(
      `WITH first_opens AS (
         SELECT distinct_id, min(timestamp) AS first_open_at
         FROM events WHERE event = 'first_open' AND ${phase0Filter()}
         GROUP BY distinct_id
       ),
       daily AS (
         SELECT e.distinct_id AS distinct_id,
                intDiv(dateDiff('second', fo.first_open_at, e.timestamp), 86400) AS day_index
         FROM events AS e
         INNER JOIN first_opens AS fo ON e.distinct_id = fo.distinct_id
         WHERE e.event = 'response_started' AND ${phase0Filter("e.")}
           AND e.timestamp >= fo.first_open_at AND e.timestamp < fo.first_open_at + INTERVAL 72 HOUR
       ),
       distinct_days AS (
         SELECT distinct_id, count(DISTINCT day_index) AS days_active FROM daily GROUP BY distinct_id
       )
       SELECT (SELECT count() FROM first_opens) AS total_first_opens,
              (SELECT count() FROM distinct_days WHERE days_active >= ${minDays}) AS reached_count`,
    );
    const [totalFirstOpens, reached] = (rows[0] as [number, number] | undefined) ?? [0, 0];
    return { count: reached ?? null, denominator: totalFirstOpens ?? null, status: "available", source: "posthog" };
  } catch {
    return { count: null, denominator: null, status: "error", source: "posthog" };
  }
}

/** person_reused: someone who saved a contact and, in a *later* response
 * (not the same request that created it), had that saved context used
 * again — the honest "technical reuse" signal, never presented as proof of
 * usefulness. Project-wide. */
export async function personReused(): Promise<Observation> {
  try {
    const rows = await postHogQuery(
      `WITH first_person AS (
         SELECT distinct_id, min(timestamp) AS created_at
         FROM events WHERE event = 'person_context_created' AND ${phase0Filter()}
         GROUP BY distinct_id
       ),
       reused AS (
         SELECT DISTINCT e.distinct_id AS distinct_id
         FROM events AS e
         INNER JOIN first_person AS fp ON e.distinct_id = fp.distinct_id
         WHERE e.event IN ('response_completed', 'response_failed')
           AND ${phase0Filter("e.")}
           AND e.properties.used_person_context = true
           AND e.timestamp > fp.created_at
       )
       SELECT (SELECT count() FROM first_person) AS total_with_person,
              (SELECT count() FROM reused) AS reused_count`,
    );
    const [totalWithPerson, reused] = (rows[0] as [number, number] | undefined) ?? [0, 0];
    return { count: reused ?? null, denominator: totalWithPerson ?? null, status: "available", source: "posthog" };
  } catch {
    return { count: null, denominator: null, status: "error", source: "posthog" };
  }
}

/** organic_second: a second genuine situation within 72h of the first,
 * attributed organic, project-wide — mirrors the "Second genuine situation
 * within 72h" PostHog funnel already validated in the PostHog UI. */
export async function organicSecondSituation(): Promise<Observation> {
  try {
    // Validated against live PostHog data before landing here (join-based,
    // no correlated subqueries — see dayWindowReturn's comment).
    const rows = await postHogQuery(
      `WITH firsts AS (
         SELECT distinct_id, min(timestamp) AS first_at
         FROM events WHERE event = 'genuine_situation_started' AND ${phase0Filter()}
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
           AND ${phase0Filter("e.")}
           AND e.properties.return_source = 'organic'
           AND e.timestamp < el.first_at + INTERVAL 72 HOUR
       )
       SELECT (SELECT count() FROM eligible) AS eligible_count,
              (SELECT count() FROM organic_second) AS organic_second_count`,
    );
    const [eligible, organicSecond] = (rows[0] as [number, number] | undefined) ?? [0, 0];
    return { count: organicSecond ?? null, denominator: eligible ?? null, status: "available", source: "posthog" };
  } catch {
    return { count: null, denominator: null, status: "error", source: "posthog" };
  }
}

/** reminder_return: a reminder_opened followed by response_started from the
 * same person within 30 minutes, project-wide. Always "assisted", never
 * organic. */
export async function reminderReturn(): Promise<Observation> {
  try {
    // Validated against live PostHog data before landing here (join-based,
    // no correlated subqueries — see dayWindowReturn's comment).
    const rows = await postHogQuery(
      `WITH opens AS (
         SELECT distinct_id, timestamp AS opened_at
         FROM events WHERE event = 'reminder_opened' AND ${phase0Filter()}
       ),
       matched AS (
         SELECT DISTINCT opens.distinct_id AS distinct_id
         FROM opens
         INNER JOIN events AS r ON r.distinct_id = opens.distinct_id
         WHERE r.event = 'response_started'
           AND ${phase0Filter("r.")}
           AND r.timestamp >= opens.opened_at AND r.timestamp < opens.opened_at + INTERVAL 30 MINUTE
       )
       SELECT (SELECT count(DISTINCT distinct_id) FROM opens) AS opened_count,
              (SELECT count() FROM matched) AS returned_count`,
    );
    const [openedCount, returnedCount] = (rows[0] as [number, number] | undefined) ?? [0, 0];
    if (!openedCount) return { count: null, denominator: null, status: "unavailable", source: "posthog" };
    return { count: returnedCount ?? null, denominator: openedCount ?? null, status: "available", source: "posthog" };
  } catch {
    return { count: null, denominator: null, status: "error", source: "posthog" };
  }
}

/** responses_complete / responses_failed: request counts, not user counts. */
export async function requestCount(event: "response_completed" | "response_failed"): Promise<Observation> {
  try {
    const count = await scalar(`SELECT count() FROM events WHERE event = '${event}' AND ${phase0Filter()}`);
    return { count, status: "available", source: "posthog" };
  } catch {
    return { count: null, status: "error", source: "posthog" };
  }
}

/** total_messages_sent: every Wingman request that was ever sent, project-wide
 * — not a user count, a raw message-volume count ("how many messages are we
 * sending"). */
export async function totalMessagesSent(): Promise<Observation> {
  try {
    const count = await scalar(`SELECT count() FROM events WHERE event = 'response_started' AND ${phase0Filter()}`);
    return { count, status: "available", source: "posthog" };
  } catch {
    return { count: null, status: "error", source: "posthog" };
  }
}

/** responses_retried: requests where the backend needed an internal
 * provider-call recovery within the same turn (recovery_triggered=true on
 * response_completed/response_failed) — surfaced by sparkeefy-backend PR #100.
 * A request count, not a user count: retries never count as new messages. */
export async function responsesRetried(): Promise<Observation> {
  try {
    const count = await scalar(
      `SELECT count() FROM events WHERE event IN ('response_completed', 'response_failed') AND ${phase0Filter()} AND properties.recovery_triggered = true`,
    );
    return { count, status: "available", source: "posthog" };
  } catch {
    return { count: null, status: "error", source: "posthog" };
  }
}

export type TopUser = { distinctId: string; email: string | null; name: string | null; messageCount: number };

/** "Which user used Wingman most" — ranked by raw message volume,
 * project-wide, straight from PostHog. `email` comes from whatever the app
 * already sent PostHog via $identify (rarely set — Sparkeefy signs users in
 * by phone, not email). `name` is resolved separately from the backend's own
 * profile data (see lib/backend-admin.ts): for a signed-in user, PostHog's
 * distinct_id is the same Supabase user id used as user_profiles.userId, so
 * it's a direct lookup, not a guess. Admin-only view — showing a user's own
 * chosen profile name to Sparkeefy staff here is not a privacy issue; the
 * privacy rule that matters is never sending that name *to PostHog*. */
export async function topUsersByMessages(
  limit = 10,
): Promise<{ users: TopUser[]; status: "available" | "error"; nameSource: UserNamesResult["status"] }> {
  try {
    const rows = await postHogQuery(
      `SELECT distinct_id, count() AS messages, any(person.properties.email) AS email
       FROM events WHERE event = 'response_started' AND ${phase0Filter()}
       GROUP BY distinct_id ORDER BY messages DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
    );
    const { names, status: nameSource } = await fetchUserNames();
    const users = rows.map((row) => {
      const [distinctId, messageCount, email] = row as [string, number, string | null];
      return { distinctId, messageCount, email: email ?? null, name: names.get(distinctId) ?? null };
    });
    return { users, status: "available", nameSource };
  } catch {
    return { users: [], status: "error", nameSource: "not_configured" };
  }
}

/**
 * The backend's live ANALYTICS_PHASE (see analytics-context.ts on the
 * backend), read off the most recent event's `phase` property rather than
 * assumed. This dashboard has no authority over which phase is active — it
 * only reports what the backend is actually stamping on events right now.
 * `null` when it can't be determined (no events yet, or PostHog unreachable).
 */
export async function currentAnalyticsPhase(): Promise<"phase_0" | "phase_1" | null> {
  try {
    const rows = await postHogQuery(
      `SELECT properties.phase FROM events WHERE ${phase0Filter()} ORDER BY timestamp DESC LIMIT 1`,
    );
    const value = rows[0]?.[0];
    return value === "phase_0" || value === "phase_1" ? value : null;
  } catch {
    return null;
  }
}

const IST_TZ = "Asia/Kolkata";

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
       WHERE event = 'wingman_opened' AND ${phase0Filter()} AND toTimeZone(timestamp, '${IST_TZ}') >= ${boundary}`,
    );
    return { count, status: "available", source: "posthog" };
  } catch {
    return { count: null, status: "error", source: "posthog" };
  }
}
