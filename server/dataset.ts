/**
 * Loads the raw inputs every page is computed from:
 *  - the real account list from sparkeefy-backend (one row per signed-up human),
 *  - in-app model cost and completed chat replies from the backend (Postgres),
 *  - user-level event rows from PostHog.
 *
 * Who counts as a real user is decided here and only here:
 *  1. The id must be a current account in the backend (deleted temp/smoke users vanish).
 *  2. It must not be on EXCLUDED_USER_IDS (smoke leftovers, Play reviewer, test lab).
 *  3. It must never have sent an event labelled traffic_class = "test".
 *  4. Team accounts (TEAM_USER_IDS, or any event labelled "internal") are kept apart:
 *     they appear only when the Internal audience is selected.
 * Anonymous pre-login ids (anon_*) are not users and are never counted.
 */
import { applyCountFrom } from './count-from';
import type { Config } from './config';
import { hogql } from './posthog';
import { type AccountClass, syncAccountClasses } from './posthog-sync';
import type { Dataset } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BackendMember {
  id: string;
  firstOpen: string;
  name: string | null;
}

interface BackendOverlayCall {
  user: string;
  at: string;
  request: string;
  ok: boolean;
  latency: number | null;
  cost: number | null;
}

interface BackendFact {
  user: string;
  at: string;
  kind: string;
  cost?: number;
}

async function fetchBackend(cfg: Config): Promise<{ members: BackendMember[]; facts: BackendFact[]; overlay: BackendOverlayCall[] | null }> {
  if (!cfg.backendUrl || !cfg.backendAdminKey) throw new Error('Backend URL/admin key not set');
  const response = await fetch(`${cfg.backendUrl}/api/admin/analytics/v2`, {
    headers: { 'x-admin-api-key': cfg.backendAdminKey },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Backend accounts ${response.status}`);
  const body = (await response.json()) as { data?: { members?: BackendMember[]; facts?: BackendFact[]; overlay?: BackendOverlayCall[] } };
  const members = body.data?.members;
  if (!Array.isArray(members)) throw new Error('Unexpected backend accounts response');
  return {
    members: members.filter((m) => typeof m.id === 'string' && UUID.test(m.id) && Number.isFinite(Date.parse(m.firstOpen))),
    facts: Array.isArray(body.data?.facts) ? body.data.facts : [],
    // Older backends (before PR #357) don't send overlay calls; PostHog drafts are used instead.
    overlay: Array.isArray(body.data?.overlay) ? body.data.overlay : null,
  };
}

/** In-app activity. Overlay activity comes from the overlay rows below. */
const APP_EVENTS = [
  'app_open',
  'wingman_opened',
  'response_completed',
  'recommendation_card_clicked',
  'calendar_event_created',
  'reminder_created',
];

/** Runs tasks with at most `limit` in flight (PostHog queues concurrent queries per project). */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
}

type ActivityRow = { id: string; hour: string; tc: string; n: number; version: string };
type OverlayRow = {
  id: string; ts: string; tc: string; action: string; status: string; app: string; latency: number | null; cost: number | null; panel: string;
  outcome: string; mood: string; rel: string;
};
type SessionRow = { id: string; ts: string; tc: string; panel: string; taps: number | null; firstTry: number | null; used: number | null; app: string };
/** One onboarding screen (or granted permission) per PostHog person; uid = the account, '' before sign-in. */
type StepRow = { pid: string; uid: string; did: string; screen: string; ts: string };
interface Raw {
  overlay: OverlayRow[];
  activity: ActivityRow[];
  sessions: SessionRow[];
  steps: StepRow[];
}

/**
 * Freshness on PostHog's free plan (about 120 queries an hour):
 *  - history (4 queries) is re-read every HISTORY_MS,
 *  - the minutes since then come from ONE small combined query, at most every RECENT_MS,
 *  - the backend (accounts, chat replies, in-app cost) is re-read every RECENT_MS.
 * On a PostHog error or throttle, the last good rows are kept and PostHog is left alone for BACKOFF_MS.
 */
const HISTORY_MS = 15 * 60_000;
const RECENT_MS = 60_000;
/** Backend reads are cheap (one admin query), so they refresh faster than PostHog. */
const BACKEND_MS = 15_000;
const BACKOFF_MS = 5 * 60_000;
const OVERLAP_MS = 2 * 60_000;

const state: {
  history: { at: number; since: number; raw: Raw } | null;
  recent: { at: number; raw: Raw } | null;
  backend: { at: number; data: Awaited<ReturnType<typeof fetchBackend>> } | null;
  backoffUntil: number;
  lastError: string | null;
} = { history: null, recent: null, backend: null, backoffUntil: 0, lastError: null };
let inflight: Promise<Dataset> | null = null;

const hourOf = (ts: string) => new Date(Math.floor(Date.parse(ts) / 3_600_000) * 3_600_000).toISOString();

function baseFilter(cfg: Config, start: string) {
  const excluded = [...cfg.excludedIds].filter((id) => UUID.test(id));
  // Test traffic is kept in the rows (tc column) so its ids can be dropped everywhere; system traffic is never read.
  return [
    // Always UTC: PostHog reads a bare toDateTime() in the project's time zone (IST), which made the
    // 1-minute "recent" query start 5.5 h early and count those hours twice (fixed 6 Nov).
    `timestamp >= toDateTime('${start}', 'UTC')`,
    'length(distinct_id) = 36',
    `ifNull(toString(properties.traffic_class), '') != 'system'`,
    excluded.length ? `distinct_id NOT IN (${excluded.map((id) => `'${id}'`).join(',')})` : 'true',
  ].join(' AND ');
}
const str = (expr: string) => `ifNull(toString(${expr}), '')`;
const FIRST_TRY = `multiIf(toString(properties.first_try) IN ('true', '1'), 1., toString(properties.first_try) IN ('false', '0'), 0., toFloatOrNull(''))`;
const USED = `multiIf(toString(properties.used) IN ('true', '1'), 1., toString(properties.used) IN ('false', '0'), 0., toFloatOrNull(''))`;
const STEP_EVENTS = `event IN ('onboarding_step', 'onboarding_permission') AND (event = 'onboarding_step' OR toString(properties.granted) IN ('true', '1'))`;
const STEP = `multiIf(event = 'onboarding_permission', concat('perm:', ifNull(toString(properties.permission), '')), ifNull(toString(properties.screen), ''))`;
const OVERLAY_EXTRA = `${str('properties.sent_outcome')} AS outcome, ${str('properties.mood_applied')} AS mood, ${str('properties.relationship')} AS rel`;
/** Onboarding screens run before sign-in under an anonymous id, so this filter keeps every id. */
function stepFilter(cfg: Config, start: string) {
  return baseFilter(cfg, start).replace('length(distinct_id) = 36', 'true');
}

async function queryHistory(cfg: Config, start: string): Promise<Raw> {
  const base = baseFilter(cfg, `${start} 00:00:00`);
  const [overlay, activity, sessions, steps] = (await pool<unknown[]>(
    [
      () =>
        hogql<OverlayRow>(
          cfg,
          `SELECT distinct_id AS id, timestamp AS ts, ${str('properties.traffic_class')} AS tc,
                  ${str('properties.action')} AS action, ${str('properties.status')} AS status, ${str('properties.app')} AS app,
                  toFloatOrNull(toString(properties.latency_ms)) AS latency,
                  toFloatOrNull(toString(properties.cost_usd)) AS cost,
                  ${str('properties.panel_id')} AS panel, ${OVERLAY_EXTRA}
           FROM events
           WHERE event = 'overlay_used' AND ${base}
           ORDER BY ts LIMIT 1000000`,
        ),
      () =>
        hogql<ActivityRow>(
          cfg,
          `SELECT distinct_id AS id, toStartOfHour(timestamp) AS hour, ${str('properties.traffic_class')} AS tc, count() AS n,
                  argMax(${str('properties.app_version')}, timestamp) AS version
           FROM events
           WHERE event IN (${APP_EVENTS.map((e) => `'${e}'`).join(',')}) AND ${base}
           GROUP BY id, hour, tc LIMIT 500000`,
        ),
      () =>
        hogql<SessionRow>(
          cfg,
          `SELECT distinct_id AS id, timestamp AS ts, ${str('properties.traffic_class')} AS tc, ${str('properties.panel_id')} AS panel,
                  toFloatOrNull(toString(properties.taps)) AS taps, ${FIRST_TRY} AS firstTry, ${USED} AS used,
                  ${str('properties.app')} AS app
           FROM events
           WHERE event = 'overlay_session' AND ${base}
           LIMIT 500000`,
        ),
      () =>
        hogql<StepRow>(
          cfg,
          `SELECT toString(e.person_id) AS pid, ifNull(m.uid, '') AS uid, '' AS did, ${STEP.replaceAll('properties.', 'e.properties.').replaceAll('event =', 'e.event =')} AS screen,
                  min(e.timestamp) AS ts
           FROM events AS e
           LEFT JOIN (SELECT person_id, max(distinct_id) AS uid FROM person_distinct_ids WHERE length(distinct_id) = 36 GROUP BY person_id) AS m
             ON m.person_id = e.person_id
           WHERE ${STEP_EVENTS.replaceAll('properties.', 'e.properties.').replaceAll('event ', 'e.event ')}
             AND ${stepFilter(cfg, `${start} 00:00:00`).replaceAll('timestamp', 'e.timestamp').replaceAll('distinct_id', 'e.distinct_id').replaceAll('properties.', 'e.properties.')}
           GROUP BY pid, uid, screen LIMIT 200000`,
        ),
    ],
    3,
  )) as [OverlayRow[], ActivityRow[], SessionRow[], StepRow[]];
  return { overlay, activity, sessions, steps };
}

/** Everything since `since`, in one query. */
async function queryRecent(cfg: Config, since: number): Promise<Raw> {
  const at = new Date(since).toISOString().slice(0, 19).replace('T', ' ');
  const base = baseFilter(cfg, at);
  type Row = {
    k: string; id: string; ts: string; tc: string; action: string; status: string; app: string;
    latency: number | null; cost: number | null; panel: string; taps: number | null; firstTry: number | null; used: number | null; extra: string;
    outcome: string; mood: string; rel: string;
  };
  const none = `'' AS outcome, '' AS mood, '' AS rel`;
  const rows = await hogql<Row>(
    cfg,
    `SELECT 'o' AS k, distinct_id AS id, timestamp AS ts, ${str('properties.traffic_class')} AS tc,
            ${str('properties.action')} AS action, ${str('properties.status')} AS status, ${str('properties.app')} AS app,
            toFloatOrNull(toString(properties.latency_ms)) AS latency, toFloatOrNull(toString(properties.cost_usd)) AS cost,
            ${str('properties.panel_id')} AS panel, toFloatOrNull('') AS taps, toFloatOrNull('') AS firstTry, toFloatOrNull('') AS used, '' AS extra,
            ${OVERLAY_EXTRA}
     FROM events WHERE event = 'overlay_used' AND ${base}
     UNION ALL
     SELECT 's', distinct_id, timestamp, ${str('properties.traffic_class')}, '', '', ${str('properties.app')},
            toFloatOrNull(''), toFloatOrNull(''), ${str('properties.panel_id')},
            toFloatOrNull(toString(properties.taps)), ${FIRST_TRY}, ${USED}, '', ${none}
     FROM events WHERE event = 'overlay_session' AND ${base}
     UNION ALL
     SELECT 'a', distinct_id, timestamp, ${str('properties.traffic_class')}, '', '', '',
            toFloatOrNull(''), toFloatOrNull(''), '', toFloatOrNull(''), toFloatOrNull(''), toFloatOrNull(''), ${str('properties.app_version')}, ${none}
     FROM events WHERE event IN (${APP_EVENTS.map((e) => `'${e}'`).join(',')}) AND ${base}
     UNION ALL
     SELECT 'b', distinct_id, timestamp, ${str('properties.traffic_class')}, '', '', '',
            toFloatOrNull(''), toFloatOrNull(''), toString(person_id), toFloatOrNull(''), toFloatOrNull(''), toFloatOrNull(''), ${STEP}, ${none}
     FROM events WHERE ${STEP_EVENTS} AND ${stepFilter(cfg, at)}
     LIMIT 200000`,
  );
  const raw: Raw = { overlay: [], activity: [], sessions: [], steps: [] };
  for (const r of rows) {
    if (r.k === 'o')
      raw.overlay.push({ id: r.id, ts: r.ts, tc: r.tc, action: r.action, status: r.status, app: r.app, latency: r.latency, cost: r.cost, panel: r.panel, outcome: r.outcome, mood: r.mood, rel: r.rel });
    else if (r.k === 's') raw.sessions.push({ id: r.id, ts: r.ts, tc: r.tc, panel: r.panel, taps: r.taps, firstTry: r.firstTry, used: r.used, app: r.app });
    else if (r.k === 'a') raw.activity.push({ id: r.id, hour: hourOf(r.ts), tc: r.tc, n: 1, version: r.extra });
    else if (r.k === 'b') raw.steps.push({ pid: r.panel, uid: UUID.test(r.id) ? r.id : '', did: r.id, screen: r.extra, ts: r.ts });
  }
  return raw;
}

function merge(history: { since: number; raw: Raw }, recent: Raw | null): Raw {
  if (!recent) return history.raw;
  const before = (ts: string) => Date.parse(ts) < history.since;
  return {
    overlay: [...history.raw.overlay.filter((r) => before(r.ts)), ...recent.overlay],
    sessions: [...history.raw.sessions.filter((r) => before(r.ts)), ...recent.sessions],
    // Hour buckets may overlap at the seam; activity is used for presence, so a repeat is harmless.
    activity: [...history.raw.activity, ...recent.activity],
    // Steps are reduced to the earliest row per person and screen in assemble(), so repeats are harmless.
    steps: [...history.raw.steps, ...recent.steps],
  };
}

/** Returns the freshest dataset this instance can give without exceeding PostHog's budget. */
export async function getDataset(cfg: Config): Promise<Dataset> {
  if (!inflight) inflight = refresh(cfg).finally(() => (inflight = null));
  return inflight;
}

let lastBuilt: { at: number; data: Dataset } | null = null;

async function refresh(cfg: Config): Promise<Dataset> {
  const now = Date.now();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(cfg.dataStart) ? cfg.dataStart : '2026-09-11';
  const posthogAllowed = now >= state.backoffUntil;
  let changed = false;

  if (!state.backend || now - state.backend.at >= BACKEND_MS) {
    try {
      state.backend = { at: now, data: await fetchBackend(cfg) };
      changed = true;
    } catch (error) {
      if (!state.backend) throw error;
      console.error('backend refresh failed', error);
    }
  }

  if (posthogAllowed) {
    try {
      if (!state.history || now - state.history.at >= HISTORY_MS) {
        const raw = await queryHistory(cfg, start);
        state.history = { at: Date.now(), since: now - OVERLAP_MS, raw };
        state.recent = { at: Date.now(), raw: { overlay: [], activity: [], sessions: [], steps: [] } };
        changed = true;
      } else if (!state.recent || now - state.recent.at >= RECENT_MS) {
        state.recent = { at: Date.now(), raw: await queryRecent(cfg, state.history.since) };
        changed = true;
      }
      state.lastError = null;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.backoffUntil = now + BACKOFF_MS;
      console.error('posthog refresh failed; backing off', error);
    }
  }
  // PostHog unavailable and never read: still serve backend numbers; PostHog-only cards show as unavailable.
  if (!state.backend) throw new Error(state.lastError ?? 'No data yet');
  if (!changed && lastBuilt) return lastBuilt.data;

  const empty: Raw = { overlay: [], activity: [], sessions: [], steps: [] };
  const raw = state.history ? merge(state.history, state.recent?.raw ?? null) : empty;
  const posthogAt = state.history ? Math.max(state.history.at, state.recent?.at ?? 0) : null;
  const built = assemble(cfg, start, state.backend.data, raw, {
    posthogAt: posthogAt === null ? null : new Date(posthogAt).toISOString(),
    backendAt: new Date(state.backend.at).toISOString(),
    error: state.lastError,
  });
  const data = applyCountFrom(built, cfg.countFrom);
  lastBuilt = { at: now, data };
  return data;
}

function assemble(
  cfg: Config,
  start: string,
  backend: Awaited<ReturnType<typeof fetchBackend>>,
  raw: Raw,
  fresh: { posthogAt: string | null; backendAt: string; error: string | null },
): Dataset {
  const { overlay, activity, sessions } = raw;
  const steps = reduceSteps(raw.steps);
  const members = backend.members;

  const flaggedTest = new Set<string>();
  const flaggedInternal = new Set<string>();
  for (const r of [...activity, ...overlay, ...sessions]) {
    if (r.tc === 'test') flaggedTest.add(r.id.toLowerCase());
    if (r.tc === 'internal') flaggedInternal.add(r.id.toLowerCase());
  }

  const people = members
    .map((m) => ({ id: m.id.toLowerCase(), name: m.name, signupAt: new Date(m.firstOpen).toISOString() }))
    .filter((m) => !cfg.excludedIds.has(m.id) && !flaggedTest.has(m.id))
    .map((m) => ({ ...m, team: cfg.teamIds.has(m.id) || flaggedInternal.has(m.id) }));

  const classes = new Map<string, AccountClass>();
  for (const m of members) {
    const id = m.id.toLowerCase();
    classes.set(id, cfg.excludedIds.has(id) || flaggedTest.has(id) ? 'excluded' : cfg.teamIds.has(id) || flaggedInternal.has(id) ? 'team' : 'real');
  }
  syncAccountClasses(cfg, classes);

  const known = new Set(people.map((p) => p.id));
  const keep = <T extends { id: string }>(rows: T[]) =>
    rows.map((r) => ({ ...r, id: r.id.toLowerCase() })).filter((r) => known.has(r.id));
  const iso = (value: string) => new Date(value.includes('T') || value.includes('Z') ? value : `${value.replace(' ', 'T')}Z`).toISOString();

  return {
    generatedAt: fresh.posthogAt && fresh.posthogAt < fresh.backendAt ? fresh.posthogAt : fresh.backendAt,
    sourceError: fresh.error,
    dataStart: start,
    people,
    activity: [
      ...keep(activity).map((r) => ({ id: r.id, hour: iso(r.hour), surface: 'app' as const, n: Number(r.n) })),
      // Backend activity keeps DAU/WAU/MAU right even without PostHog: chat messages (app) and overlay calls (overlay).
      ...appHours(keep(backend.facts.filter((f) => f.kind === 'message' || f.kind === 'wingman').map((f) => ({ id: f.user, ts: f.at })))),
      ...overlayHours(keep((backend.overlay ?? []).map((c) => ({ id: c.user, ts: c.at })))),
      ...overlayHours(keep(overlay).map((r) => ({ id: r.id, ts: iso(r.ts) }))),
      ...overlayHours(keep(sessions).map((r) => ({ id: r.id, ts: iso(r.ts) }))),
    ],
    overlay: keep(overlay).map((r) => ({
      id: r.id,
      ts: iso(r.ts),
      action: r.action,
      status: r.status,
      app: r.app,
      latency: r.latency === null ? null : Number(r.latency),
      cost: r.cost === null || r.cost === undefined ? null : Number(r.cost),
      panel: r.panel,
      ...(r.outcome ? { sentOutcome: r.outcome } : {}),
      ...(r.mood ? { mood: r.mood } : {}),
      ...(r.rel ? { relationship: r.rel } : {}),
    })),
    sessions: keep(sessions).map((r) => ({
      id: r.id,
      ts: iso(r.ts),
      panel: r.panel,
      taps: r.taps === null ? null : Number(r.taps),
      firstTry: r.firstTry === null ? null : Number(r.firstTry) === 1,
      used: r.used === null ? null : Number(r.used) === 1,
      app: r.app,
    })),
    aiCost: keep(backend.facts.filter((f) => f.kind === 'usage' && typeof f.cost === 'number').map((f) => ({ id: f.user, at: f.at, cost: f.cost as number }))),
    versions: latestVersions(keep(activity).map((r) => ({ id: r.id, hour: iso(r.hour), version: r.version }))),
    onboarding: lastScreens(steps.filter((r) => r.account && known.has(r.id))),
    // Accounts in this dataset, plus installs that never signed in (top of the funnel only).
    steps: steps.filter((r) => (r.account ? known.has(r.id) : true)),
    chatReplies: keep(backend.facts.filter((f) => f.kind === 'complete').map((f) => ({ id: f.user, at: f.at }))),
    overlayCalls: keep((backend.overlay ?? []).map((c) => ({ id: c.user, at: c.at, request: c.request, ok: c.ok, latency: c.latency, cost: c.cost }))),
    sources: {
      posthogAt: fresh.posthogAt,
      backendAt: fresh.backendAt,
      overlayCallsFrom: backend.overlay?.length
        ? backend.overlay.reduce((min, c) => (c.at < min ? c.at : min), backend.overlay[0].at)
        : null,
    },
  };
}

const HOUR_MS = 3_600_000;

function appHours(rows: { id: string; ts: string }[]): Dataset['activity'] {
  return overlayHours(rows).map((r) => ({ ...r, surface: 'app' as const }));
}

function overlayHours(rows: { id: string; ts: string }[]): Dataset['activity'] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.id}|${new Date(Math.floor(Date.parse(r.ts) / HOUR_MS) * HOUR_MS).toISOString()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, n]) => {
    const [id, hour] = key.split('|');
    return { id, hour, surface: 'overlay' as const, n };
  });
}

function latestVersions(rows: { id: string; hour: string; version: string }[]): Dataset['versions'] {
  const best = new Map<string, { hour: string; version: string }>();
  for (const r of rows) {
    if (!r.version) continue;
    const cur = best.get(r.id);
    if (!cur || r.hour > cur.hour) best.set(r.id, { hour: r.hour, version: r.version });
  }
  return [...best.entries()].map(([id, v]) => ({ id, version: v.version }));
}

/**
 * Earliest row per person and screen. A person is identified by their account when any of their
 * rows (or history) names one, so screens seen before sign-in count for the account that signs in.
 */
function reduceSteps(rows: StepRow[]): NonNullable<Dataset['steps']> {
  const uidOf = new Map<string, string>();
  for (const r of rows) if (r.uid && UUID.test(r.uid)) uidOf.set(r.pid, r.uid.toLowerCase());
  const best = new Map<string, { id: string; screen: string; ts: string; account: boolean }>();
  for (const r of rows) {
    if (!r.screen || r.screen === 'perm:' || !r.pid) continue;
    const uid = uidOf.get(r.pid);
    const id = uid ?? `anon:${r.pid}`;
    const ts = new Date(r.ts.includes('T') || r.ts.includes('Z') ? r.ts : `${r.ts.replace(' ', 'T')}Z`).toISOString();
    const key = `${id}|${r.screen}`;
    const cur = best.get(key);
    if (!cur || ts < cur.ts) best.set(key, { id, screen: r.screen, ts, account: Boolean(uid) });
  }
  return [...best.values()];
}

/** The newest screen (not permission) each account reached. */
function lastScreens(steps: NonNullable<Dataset['steps']>): Dataset['onboarding'] {
  const last = new Map<string, { screen: string; ts: string }>();
  for (const s of steps) {
    if (s.screen.startsWith('perm:')) continue;
    const cur = last.get(s.id);
    if (!cur || s.ts > cur.ts) last.set(s.id, { screen: s.screen, ts: s.ts });
  }
  return [...last.entries()].map(([id, v]) => ({ id, screen: v.screen }));
}
