import { env } from "@/lib/runtime-env";
import { trackerAccess } from "@/lib/auth";
import { hogqlString, postHogQuery, PostHogUnavailableError } from "@/lib/posthog";
import { ensurePhase0PostHogSchema } from "@/app/api/tracker/route";

export const dynamic = "force-dynamic";

function db() {
  if (!env.DB) throw new Error("Database is unavailable.");
  return env.DB;
}

type CohortRow = {
  id: string;
  participant_id: string;
  posthog_distinct_id: string | null;
  onboarding_completed: number;
  created_at: string;
  updated_at: string;
};

/**
 * Private per-participant identity. Name/email/phone are always null here:
 * this ledger (cohort_evidence) is deliberately pseudonymous — it never
 * stored contact details, and this connector does not reach into the main
 * Sparkeefy app database (a separate system) to fetch them. That's an
 * honest `null`, not a bug — see USERS_POSTHOG_HANDOFF.md's explicit
 * allowance for unknown contact details.
 */
function userSummary(row: CohortRow, firstOpenAt: string | null, lastActiveAt: string | null) {
  return {
    id: row.id,
    name: row.participant_id,
    email: null as string | null,
    phone: null as string | null,
    onboardedAt: row.onboarding_completed ? row.updated_at : null,
    firstOpenAt,
    lastActiveAt,
  };
}

async function firstOpenAndLastActive(distinctId: string | null): Promise<{ firstOpenAt: string | null; lastActiveAt: string | null }> {
  if (!distinctId) return { firstOpenAt: null, lastActiveAt: null };
  const identity = hogqlString(distinctId);
  try {
    const rows = await postHogQuery(
      `SELECT
         (SELECT min(timestamp) FROM events WHERE event = 'first_open' AND distinct_id = ${identity}) AS first_open_at,
         (SELECT max(timestamp) FROM events WHERE event = 'wingman_opened' AND distinct_id = ${identity}) AS last_active_at`,
    );
    const [firstOpenAt, lastActiveAt] = (rows[0] as [string | null, string | null] | undefined) ?? [null, null];
    return { firstOpenAt, lastActiveAt };
  } catch {
    return { firstOpenAt: null, lastActiveAt: null };
  }
}

const PAGE_SIZE = 50;

async function listUsers(cursor: string | null) {
  await ensurePhase0PostHogSchema();
  const database = db();
  const offset = cursor ? Math.max(0, parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10) || 0) : 0;
  const rows = await database
    .prepare(
      "SELECT id, participant_id, posthog_distinct_id, onboarding_completed, created_at, updated_at FROM cohort_evidence WHERE phase_id='phase-0' AND onboarding_completed=1 ORDER BY participant_id LIMIT ? OFFSET ?",
    )
    .bind(PAGE_SIZE + 1, offset)
    .all<CohortRow>();
  const page = rows.results.slice(0, PAGE_SIZE);
  const hasMore = rows.results.length > PAGE_SIZE;
  const users = await Promise.all(
    page.map(async (row) => {
      const { firstOpenAt, lastActiveAt } = await firstOpenAndLastActive(row.posthog_distinct_id);
      return userSummary(row, firstOpenAt, lastActiveAt);
    }),
  );
  return {
    version: 1 as const,
    status: "available" as const,
    updatedAt: new Date().toISOString(),
    users,
    nextCursor: hasMore ? Buffer.from(String(offset + PAGE_SIZE)).toString("base64url") : null,
  };
}

type DayTotals = {
  day: number;
  startedAt: string;
  status: "available" | "pending";
  wingmanSessions: number | null;
  messages: number | null;
  activeSeconds: number | null;
  profiles: number | null;
  memories: number | null;
  calendarEvents: number | null;
};

async function userDetail(id: string) {
  await ensurePhase0PostHogSchema();
  const database = db();
  const row = await database
    .prepare(
      "SELECT id, participant_id, posthog_distinct_id, onboarding_completed, created_at, updated_at FROM cohort_evidence WHERE phase_id='phase-0' AND id=?",
    )
    .bind(id)
    .first<CohortRow>();
  if (!row) return null;

  if (!row.posthog_distinct_id) {
    return {
      version: 1 as const,
      status: "pending" as const,
      updatedAt: new Date().toISOString(),
      user: userSummary(row, null, null),
      totals: { wingmanSessions: null, messages: null, activeSeconds: null, profiles: null, memories: null, calendarEvents: null },
      days: [] as DayTotals[],
      activities: [] as { id: string; at: string; label: string }[],
      activityTruncated: false,
    };
  }

  const distinctId = row.posthog_distinct_id;
  const identity = hogqlString(distinctId);
  try {
    const totalsRows = await postHogQuery(
      `SELECT
         countIf(event = 'response_started') AS messages,
         countIf(event = 'person_context_created') AS profiles,
         countIf(event = 'memory_added') AS memories,
         countIf(event = 'calendar_event_created') AS calendar_events,
         (SELECT min(timestamp) FROM events WHERE event = 'first_open' AND distinct_id = ${identity}) AS first_open_at
       FROM events WHERE distinct_id = ${identity}`,
    );
    const [messages, profiles, memories, calendarEvents, firstOpenAt] =
      (totalsRows[0] as [number, number, number, number, string | null] | undefined) ?? [0, 0, 0, 0, null];

    // Wingman sessions require at least one accepted message, not page
    // opens — approximate as distinct calendar days with a response_started,
    // which is the closest signal available without a stored session ID.
    const sessionRows = firstOpenAt
      ? await postHogQuery(
          `SELECT count(DISTINCT toDate(timestamp)) FROM events WHERE event = 'response_started' AND distinct_id = ${identity}`,
        )
      : [[0]];
    const wingmanSessions = (sessionRows[0]?.[0] as number | undefined) ?? null;

    const activityRows = firstOpenAt
      ? await postHogQuery(
          `SELECT timestamp, event FROM events
           WHERE distinct_id = ${identity}
             AND event IN ('response_started','response_completed','person_context_created','memory_added','calendar_event_created')
           ORDER BY timestamp DESC LIMIT 101`,
        )
      : [];
    const activityLabels: Record<string, string> = {
      response_started: "Sent a Wingman message",
      response_completed: "Received a Wingman reply",
      person_context_created: "Added a person",
      memory_added: "Added a memory",
      calendar_event_created: "Added a calendar event",
    };
    const activityTruncated = activityRows.length > 100;
    const activities = activityRows.slice(0, 100).map((activityRow, index) => {
      const [timestamp, event] = activityRow as [string, string];
      return { id: `${distinctId}-${index}`, at: timestamp, label: activityLabels[event] ?? "Activity" };
    });

    const days: DayTotals[] = [];
    if (firstOpenAt) {
      const firstOpenMs = Date.parse(firstOpenAt);
      for (let day = 0; day < 4; day += 1) {
        const startMs = firstOpenMs + day * 24 * 60 * 60 * 1000;
        const endMs = startMs + 24 * 60 * 60 * 1000;
        const closed = Date.now() >= endMs;
        // eslint-disable-next-line no-await-in-loop -- four small windows per user detail view, not a hot list path
        const dayRows = await postHogQuery(
          `SELECT
             countIf(event='response_started') AS messages,
             countIf(event='person_context_created') AS profiles,
             countIf(event='memory_added') AS memories,
             countIf(event='calendar_event_created') AS calendar_events
           FROM events
           WHERE distinct_id = ${identity}
             AND timestamp >= toDateTime('${new Date(startMs).toISOString()}')
             AND timestamp < toDateTime('${new Date(endMs).toISOString()}')`,
        );
        const [dayMessages, dayProfiles, dayMemories, dayCalendar] =
          (dayRows[0] as [number, number, number, number] | undefined) ?? [0, 0, 0, 0];
        days.push({
          day,
          startedAt: new Date(startMs).toISOString(),
          status: closed ? "available" : "pending",
          wingmanSessions: null,
          messages: dayMessages ?? null,
          activeSeconds: null,
          profiles: dayProfiles ?? null,
          memories: dayMemories ?? null,
          calendarEvents: dayCalendar ?? null,
        });
      }
    }

    return {
      version: 1 as const,
      status: "available" as const,
      updatedAt: new Date().toISOString(),
      user: userSummary(row, firstOpenAt, activities[0]?.at ?? null),
      totals: {
        wingmanSessions,
        messages,
        // activeSeconds requires foreground heartbeat instrumentation that
        // doesn't exist yet — never approximated from session duration.
        activeSeconds: null,
        profiles,
        memories,
        calendarEvents,
      },
      days,
      activities,
      activityTruncated,
    };
  } catch (error) {
    if (error instanceof PostHogUnavailableError) {
      return {
        version: 1 as const,
        status: "unavailable" as const,
        updatedAt: null,
        user: userSummary(row, null, null),
        totals: { wingmanSessions: null, messages: null, activeSeconds: null, profiles: null, memories: null, calendarEvents: null },
        days: [] as DayTotals[],
        activities: [] as { id: string; at: string; label: string }[],
        activityTruncated: false,
      };
    }
    throw error;
  }
}

export async function GET(request: Request) {
  const access = await trackerAccess(request);
  if (!access.canEdit) {
    return Response.json(
      { error: "Sign in with an authorized staff account." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const cursor = url.searchParams.get("cursor");
  if (id && id.length > 256) {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  if (id) {
    try {
      const detail = await userDetail(id);
      if (!detail) {
        return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
      }
      return Response.json(detail, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return Response.json(
        {
          version: 1,
          status: "unavailable",
          updatedAt: null,
          user: null,
          totals: { wingmanSessions: null, messages: null, activeSeconds: null, profiles: null, memories: null, calendarEvents: null },
          days: [],
          activities: [],
          activityTruncated: false,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }
  try {
    const list = await listUsers(cursor);
    return Response.json(list, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json(
      { version: 1, status: "unavailable", updatedAt: null, users: [], nextCursor: null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
