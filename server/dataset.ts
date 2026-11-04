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

interface BackendFact {
  user: string;
  at: string;
  kind: string;
  cost?: number;
}

async function fetchBackend(cfg: Config): Promise<{ members: BackendMember[]; facts: BackendFact[] }> {
  if (!cfg.backendUrl || !cfg.backendAdminKey) throw new Error('Backend URL/admin key not set');
  const response = await fetch(`${cfg.backendUrl}/api/admin/analytics/v2`, {
    headers: { 'x-admin-api-key': cfg.backendAdminKey },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Backend accounts ${response.status}`);
  const body = (await response.json()) as { data?: { members?: BackendMember[]; facts?: BackendFact[] } };
  const members = body.data?.members;
  if (!Array.isArray(members)) throw new Error('Unexpected backend accounts response');
  return {
    members: members.filter((m) => typeof m.id === 'string' && UUID.test(m.id) && Number.isFinite(Date.parse(m.firstOpen))),
    facts: Array.isArray(body.data?.facts) ? body.data.facts : [],
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
type OverlayRow = { id: string; ts: string; tc: string; action: string; status: string; app: string; latency: number | null; cost: number | null; panel: string };
type SessionRow = { id: string; ts: string; tc: string; panel: string; taps: number | null; firstTry: number | null; used: number | null; app: string };
type ScreenRow = { id: string; screen: string };

export async function loadDataset(cfg: Config): Promise<Dataset> {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(cfg.dataStart) ? cfg.dataStart : '2026-09-11';
  const excluded = [...cfg.excludedIds].filter((id) => UUID.test(id));
  // Test traffic is kept in the rows (tc column) so its ids can be dropped everywhere, then removed below.
  const base = [
    `timestamp >= toDateTime('${start} 00:00:00')`,
    'length(distinct_id) = 36',
    `ifNull(toString(properties.traffic_class), '') != 'system'`,
    excluded.length ? `distinct_id NOT IN (${excluded.map((id) => `'${id}'`).join(',')})` : 'true',
  ].join(' AND ');
  const str = (expr: string) => `ifNull(toString(${expr}), '')`;

  const backendPromise = fetchBackend(cfg);
  const [overlay, activity, sessions, screens] = (await pool<unknown[]>(
    [
      () =>
        hogql<OverlayRow>(
          cfg,
          `SELECT distinct_id AS id, timestamp AS ts, ${str('properties.traffic_class')} AS tc,
                  ${str('properties.action')} AS action, ${str('properties.status')} AS status, ${str('properties.app')} AS app,
                  toFloatOrNull(toString(properties.latency_ms)) AS latency,
                  toFloatOrNull(toString(properties.cost_usd)) AS cost,
                  ${str('properties.panel_id')} AS panel
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
                  toFloatOrNull(toString(properties.taps)) AS taps,
                  multiIf(toString(properties.first_try) IN ('true', '1'), 1, toString(properties.first_try) IN ('false', '0'), 0, NULL) AS firstTry,
                  multiIf(toString(properties.used) IN ('true', '1'), 1, toString(properties.used) IN ('false', '0'), 0, NULL) AS used,
                  ${str('properties.app')} AS app
           FROM events
           WHERE event = 'overlay_session' AND ${base}
           LIMIT 500000`,
        ),
      () =>
        hogql<ScreenRow>(
          cfg,
          `SELECT distinct_id AS id,
                  argMax(coalesce(toString(properties.screen), toString(properties.permission), event), timestamp) AS screen
           FROM events
           WHERE event IN ('onboarding_step', 'onboarding_permission') AND ${base}
           GROUP BY id LIMIT 100000`,
        ),
    ],
    3,
  )) as [OverlayRow[], ActivityRow[], SessionRow[], ScreenRow[]];
  const backend = await backendPromise;
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
    generatedAt: new Date().toISOString(),
    dataStart: start,
    people,
    activity: [
      ...keep(activity).map((r) => ({ id: r.id, hour: iso(r.hour), surface: 'app' as const, n: Number(r.n) })),
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
    onboarding: keep(screens).filter((r) => r.screen).map((r) => ({ id: r.id, screen: r.screen })),
    chatReplies: keep(backend.facts.filter((f) => f.kind === 'complete').map((f) => ({ id: f.user, at: f.at }))),
  };
}

const HOUR_MS = 3_600_000;

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
