/**
 * 7 Nov (Rahul: "make it authentic"): this dashboard checked against the production
 * database itself, in the background. Nothing on the pages changes because of it.
 *
 * The backend's /api/admin/analytics/v2/truth runs plain SQL on prod Postgres (no PostHog,
 * no ledger copy, no cache) for every account active since launch. Here we line that up
 * with the roster this dashboard computed, person by person:
 *  - everyone the database has is on the dashboard, and nobody is on it the database lacks;
 *  - the same people are new signups (vs. returning);
 *  - drafts, copies, inserts, sends (as-is/edited/own) and in-app messages match.
 *
 * Only launch-onwards data is compared (COUNT_FROM, never earlier than the official launch),
 * the same window every page uses. A difference must be seen in reads at least SETTLE_MS
 * apart before it counts: a row written between the two reads is not a bug. A lasting
 * difference is written to the server log with the person id and both numbers, and the
 * sidebar status says "Database: N differences" instead of "Database ✓".
 */
import type { Config } from './config';
import { computeSnapshot } from './metrics';
import type { Dataset, RosterUser } from './types';

/** Official launch (6 Nov 2026 02:18:16 IST): the check never looks earlier. */
export const LAUNCH_AT = '2026-11-05T20:48:16.000Z';

export interface TruthAccount {
  id: string;
  name: string | null;
  signupAt: string;
  newSinceFrom: boolean;
  overlay: { drafts: number; copied: number; inserted: number; sent: { asIs: number; edited: number; own: number } };
  app: { turns: number };
  internalTraffic: boolean;
  testTraffic: boolean;
}
export interface TruthRaw { generatedAt: string; from: string; accounts: TruthAccount[] }

export interface TruthDiff {
  user: string;
  field: string;
  dashboard: number | string;
  database: number | string;
}

export interface TruthStatus {
  /** ok = every check matches; settling = a difference seen once (re-checking); mismatch = it stayed; down = DB read failed. */
  status: 'ok' | 'settling' | 'mismatch' | 'down';
  checkedAt: string | null;
  from: string | null;
  error: string | null;
  diffs: TruthDiff[];
}

/** A difference must last this long (two reads) before it is called a mismatch. */
export const SETTLE_MS = 90_000;
const READ_MS = 30_000;

const state: { at: number; raw: TruthRaw | null; error: string | null; firstSeen: Map<string, number>; logged: Set<string>; last: TruthStatus | null } = {
  at: 0,
  raw: null,
  error: null,
  firstSeen: new Map(),
  logged: new Set(),
  last: null,
};
let inflight: Promise<void> | null = null;

/** The comparison window: COUNT_FROM, but never before the official launch. */
export function truthFrom(cfg: Pick<Config, 'countFrom'>): string {
  const cf = cfg.countFrom ? Date.parse(cfg.countFrom) : Number.NaN;
  return Number.isFinite(cf) && cf > Date.parse(LAUNCH_AT) ? new Date(cf).toISOString() : LAUNCH_AT;
}

async function read(cfg: Config): Promise<void> {
  if (!cfg.backendUrl || !cfg.backendAdminKey) throw new Error('backend not configured');
  const response = await fetch(`${cfg.backendUrl}/api/admin/analytics/v2/truth?from=${encodeURIComponent(truthFrom(cfg))}`, {
    headers: { 'x-admin-api-key': cfg.backendAdminKey },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) throw new Error('database check not deployed on the backend yet');
  if (!response.ok) throw new Error(`database check ${response.status}`);
  const body = (await response.json()) as { data?: TruthRaw };
  if (!body.data || !Array.isArray(body.data.accounts)) throw new Error('database check: unexpected response');
  state.raw = body.data;
  state.error = null;
}

async function refresh(cfg: Config, force: boolean): Promise<void> {
  if (!force && state.raw && Date.now() - state.at < READ_MS) return;
  if (!inflight)
    inflight = read(cfg)
      .catch((e) => {
        state.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        state.at = Date.now();
        inflight = null;
      });
  await inflight;
}

/** Everyone (team + real), launch onwards: what every page is built from. */
function fullRoster(data: Dataset, cfg: Config, now: number): RosterUser[] {
  const base = { range: 'all', surface: 'combined', version: 'all' } as const;
  return [
    ...computeSnapshot(data, { ...base, audience: 'external' }, cfg, now).roster,
    ...computeSnapshot(data, { ...base, audience: 'internal' }, cfg, now).roster,
  ];
}

const key = (d: TruthDiff) => `${d.user}|${d.field}|${d.dashboard}|${d.database}`;

/** Pure comparison (exported for tests). `firstSeen` carries differences between calls. */
export function compareTruth(
  roster: RosterUser[],
  raw: TruthRaw,
  cfg: Pick<Config, 'excludedIds'>,
  firstSeen: Map<string, number>,
  now: number,
): { status: 'ok' | 'settling' | 'mismatch'; diffs: TruthDiff[] } {
  const lc = (s: string) => s.toLowerCase();
  // Never people anywhere: excluded ids and accounts with test traffic (the dashboard drops both).
  const accounts = raw.accounts.map((a) => ({ ...a, id: lc(a.id) })).filter((a) => !cfg.excludedIds.has(a.id) && !a.testTraffic);
  const inDb = new Set(accounts.map((a) => a.id));
  const shown = new Map(roster.map((u) => [lc(u.id), u]));
  const diffs: TruthDiff[] = [];
  const push = (user: string, field: string, dashboard: number | string, database: number | string) => diffs.push({ user, field, dashboard, database });

  for (const a of accounts) {
    const u = shown.get(a.id);
    if (!u) {
      push(a.id, 'on the dashboard', 'missing', a.newSinceFrom ? 'signed up' : 'active');
      continue;
    }
    if (u.returning === a.newSinceFrom) push(a.id, 'new signup', u.returning ? 'returning' : 'new', a.newSinceFrom ? 'new' : 'returning');
    const pairs: [string, number, number][] = [
      ['overlay drafts', u.overlay.drafts, a.overlay.drafts],
      ['copied', u.overlay.copied, a.overlay.copied],
      ['inserted', u.overlay.inserted, a.overlay.inserted],
      ['sent as-is', u.overlay.sent.asIs, a.overlay.sent.asIs],
      ['sent edited', u.overlay.sent.edited, a.overlay.sent.edited],
      ['sent own words', u.overlay.sent.own, a.overlay.sent.own],
    ];
    if (u.app.messages !== null && u.app.messages !== undefined) pairs.push(['in-app messages', u.app.messages, a.app.turns]);
    for (const [field, d, db] of pairs) if (d !== db) push(a.id, field, d, db);
  }
  for (const id of shown.keys()) if (!inDb.has(id)) push(id, 'in the database', 'shown', 'not found');

  const keys = new Set(diffs.map(key));
  for (const k of [...firstSeen.keys()]) if (!keys.has(k)) firstSeen.delete(k);
  for (const k of keys) if (!firstSeen.has(k)) firstSeen.set(k, now);
  const lasting = diffs.filter((d) => now - (firstSeen.get(key(d)) ?? now) >= SETTLE_MS);
  return { status: diffs.length === 0 ? 'ok' : lasting.length ? 'mismatch' : 'settling', diffs: lasting.length ? lasting : diffs };
}

/** Re-reads the database at most every READ_MS and compares. Never throws. */
export async function checkTruth(cfg: Config, data: Dataset, force = false, now = Date.now()): Promise<TruthStatus> {
  await refresh(cfg, force);
  if (!state.raw) return (state.last = { status: 'down', checkedAt: null, from: null, error: state.error, diffs: [] });
  let result: { status: 'ok' | 'settling' | 'mismatch'; diffs: TruthDiff[] };
  try {
    result = compareTruth(fullRoster(data, cfg, now), state.raw, cfg, state.firstSeen, now);
  } catch (e) {
    return (state.last = { status: 'down', checkedAt: null, from: state.raw.from, error: e instanceof Error ? e.message : String(e), diffs: [] });
  }
  if (result.status === 'mismatch') {
    const fresh = result.diffs.filter((d) => !state.logged.has(key(d)));
    // Ids and numbers only, never names: Vercel logs are wider-access than the dashboard.
    if (fresh.length) console.error('analytics differs from the production database', JSON.stringify(fresh.slice(0, 20)));
    for (const d of fresh) state.logged.add(key(d));
  } else state.logged.clear();
  return (state.last = {
    status: state.error ? 'down' : result.status,
    checkedAt: new Date(state.at).toISOString(),
    from: state.raw.from,
    error: state.error,
    diffs: result.diffs,
  });
}

/** The last result, without waiting (for the dashboard response). */
export function lastTruth(): TruthStatus | null {
  return state.last;
}

/** Test hook. */
export function resetTruth(): void {
  state.at = 0;
  state.raw = null;
  state.error = null;
  state.firstSeen.clear();
  state.logged.clear();
  state.last = null;
}
