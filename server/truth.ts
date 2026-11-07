/**
 * 7 Nov (Rahul: "connect the real production database so we can validate it"): a check of
 * this dashboard against the production database itself.
 *
 * The backend's /api/admin/analytics/v2/truth runs plain SQL on prod Postgres (no PostHog, no
 * ledger copy, no cache) and returns every account with its overlay/chat counts, every install
 * (an id that sent first_open) and the feedback log. Here we line that up with the Users roster
 * this dashboard computed, person by person:
 *  - everyone the database has is on the dashboard, and nobody is on it the database lacks;
 *  - the same people are new signups (vs. returning);
 *  - drafts, copies, inserts, sends (as-is/edited/own) and in-app messages match per person.
 *
 * A difference has to be seen in two checks at least SETTLE_MS apart before it shows as a
 * mismatch: a row written between the two reads (they run a second apart) is not a bug.
 *
 * It also turns the database rows into the numbers the roster can't show: installs that never
 * became an account (with the screen they stopped on), guests, and founder-logged feedback.
 */
import type { Config } from './config';
import { computeSnapshot } from './metrics';
import type { Dataset, RosterUser } from './types';

export interface TruthAccount {
  id: string;
  name: string | null;
  signupAt: string;
  newSinceFrom: boolean;
  lastSeenAt: string | null;
  overlay: {
    drafts: number; delivered: number; failed: number; notADraft: number; copied: number; inserted: number;
    sent: { asIs: number; edited: number; own: number }; sessions: number;
  };
  app: { turns: number; userMessages: number };
  lastStep: string | null;
  reachedHome: boolean;
  feedback: number;
  internalTraffic: boolean;
  testTraffic: boolean;
}
export interface TruthInstall { device: string; firstSeen: string; lastSeen: string; lastStep: string | null; reachedHome: boolean; account: string | null; internal: boolean }
export interface TruthFeedback { id: string; at: string; user: string | null; contact: string | null; source: string; quote: string | null; summary: string | null; recordedBy: string | null }
export interface TruthRaw { generatedAt: string; from: string; accounts: TruthAccount[]; installs: TruthInstall[]; feedback: TruthFeedback[] }

export interface TruthDiff {
  user: string;
  name: string | null;
  field: string;
  dashboard: number | string;
  database: number | string;
}

export interface TruthReport {
  /** ok = every check matches; settling = a difference seen once (re-checking); mismatch = it stayed; down = DB read failed. */
  status: 'ok' | 'settling' | 'mismatch' | 'down';
  checkedAt: string | null;
  databaseAt: string | null;
  from: string | null;
  error: string | null;
  diffs: TruthDiff[];
  /** Real people outside the team, from the database alone. */
  database: {
    installs: number;
    signups: number;
    activeAccounts: number;
    returning: number;
    guests: number;
    installedNoAccount: number;
    stoppedAt: { step: string; n: number }[];
    usedOverlay: number;
    usedChat: number;
    signedUpNotUsed: { id: string; name: string | null; lastStep: string | null; reachedHome: boolean; signupAt: string }[];
    drafts: number;
    sends: number;
  } | null;
  /** What this dashboard shows for the same people and window. */
  dashboard: { signups: number; activeAccounts: number; drafts: number; sends: number } | null;
  feedback: (TruthFeedback & { name: string | null })[];
}

/** A difference must last this long (two reads) before it is called a mismatch. */
export const SETTLE_MS = 90_000;
const READ_MS = 20_000;

const state: { at: number; raw: TruthRaw | null; error: string | null; firstSeen: Map<string, number> } = {
  at: 0,
  raw: null,
  error: null,
  firstSeen: new Map(),
};
let inflight: Promise<void> | null = null;

async function read(cfg: Config): Promise<void> {
  if (!cfg.backendUrl || !cfg.backendAdminKey) throw new Error('Backend URL/admin key not set');
  const from = cfg.countFrom ?? `${cfg.dataStart}T00:00:00Z`;
  const response = await fetch(`${cfg.backendUrl}/api/admin/analytics/v2/truth?from=${encodeURIComponent(from)}`, {
    headers: { 'x-admin-api-key': cfg.backendAdminKey },
    signal: AbortSignal.timeout(20_000),
  });
  // A backend without the endpoint yet: say so plainly instead of pretending all is well.
  if (response.status === 404) throw new Error('Database check not deployed on the backend yet');
  if (!response.ok) throw new Error(`Database check ${response.status}`);
  const body = (await response.json()) as { data?: TruthRaw };
  if (!body.data || !Array.isArray(body.data.accounts)) throw new Error('Database check: unexpected response');
  state.raw = body.data;
  state.error = null;
}

/** The latest database read, at most READ_MS old. Never throws; `error` says why it is missing. */
export async function getTruth(cfg: Config, force = false): Promise<{ raw: TruthRaw | null; error: string | null }> {
  if (force || !state.raw || Date.now() - state.at >= READ_MS) {
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
  return { raw: state.raw, error: state.error };
}

const sends = (s: { asIs: number; edited: number; own: number }) => s.asIs + s.edited + s.own;

/** The roster for everyone (team + real), all time since COUNT_FROM: what every page is built from. */
function fullRoster(data: Dataset, cfg: Config, now: number): RosterUser[] {
  const base = { range: 'all', surface: 'combined', version: 'all' } as const;
  return [
    ...computeSnapshot(data, { ...base, audience: 'external' }, cfg, now).roster,
    ...computeSnapshot(data, { ...base, audience: 'internal' }, cfg, now).roster,
  ];
}

/** Pure comparison (exported for tests). `firstSeen` carries differences between calls. */
export function compareTruth(
  roster: RosterUser[],
  raw: TruthRaw,
  cfg: Pick<Config, 'teamIds' | 'excludedIds'>,
  firstSeen: Map<string, number>,
  now: number,
): Omit<TruthReport, 'checkedAt' | 'error'> {
  const lc = (s: string) => s.toLowerCase();
  const accounts = raw.accounts
    .map((a) => ({ ...a, id: lc(a.id) }))
    // Never people anywhere: excluded ids and accounts with test traffic.
    .filter((a) => !cfg.excludedIds.has(a.id) && !a.testTraffic);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const shown = new Map(roster.map((u) => [lc(u.id), u]));
  const diffs: TruthDiff[] = [];
  const push = (user: string, name: string | null, field: string, dashboard: number | string, database: number | string) => diffs.push({ user, name, field, dashboard, database });

  for (const a of accounts) {
    const u = shown.get(a.id);
    if (!u) {
      push(a.id, a.name, 'on the dashboard', 'missing', a.newSinceFrom ? 'signed up' : 'active');
      continue;
    }
    if (u.returning === a.newSinceFrom) push(a.id, a.name, 'new signup', u.returning ? 'returning' : 'new', a.newSinceFrom ? 'new' : 'returning');
    const pairs: [string, number, number][] = [
      ['overlay drafts', u.overlay.drafts, a.overlay.drafts],
      ['copied', u.overlay.copied, a.overlay.copied],
      ['inserted', u.overlay.inserted, a.overlay.inserted],
      ['sent as-is', u.overlay.sent.asIs, a.overlay.sent.asIs],
      ['sent edited', u.overlay.sent.edited, a.overlay.sent.edited],
      ['sent own words', u.overlay.sent.own, a.overlay.sent.own],
    ];
    if (u.app.messages !== null && u.app.messages !== undefined) pairs.push(['in-app messages', u.app.messages, a.app.turns]);
    for (const [field, d, db] of pairs) if (d !== db) push(a.id, u.name ?? a.name, field, d, db);
  }
  for (const [id, u] of shown) if (!byId.has(id)) push(id, u.name, 'in the database', 'shown', 'not found');

  // Settle: keep a difference only once it has been seen for SETTLE_MS.
  const keys = new Set(diffs.map((d) => `${d.user}|${d.field}|${d.dashboard}|${d.database}`));
  for (const k of [...firstSeen.keys()]) if (!keys.has(k)) firstSeen.delete(k);
  for (const k of keys) if (!firstSeen.has(k)) firstSeen.set(k, now);
  const lasting = diffs.filter((d) => now - (firstSeen.get(`${d.user}|${d.field}|${d.dashboard}|${d.database}`) ?? now) >= SETTLE_MS);
  const status: TruthReport['status'] = diffs.length === 0 ? 'ok' : lasting.length ? 'mismatch' : 'settling';

  // Real people outside the team, database only.
  const team = (id: string) => cfg.teamIds.has(id) || byId.get(id)?.internalTraffic === true || shown.get(id)?.team === true;
  const real = accounts.filter((a) => !team(a.id));
  const realIds = new Set(real.map((a) => a.id));
  const hiddenAccount = (id: string | null) => id !== null && !realIds.has(lc(id)); // team / excluded / test
  const installs = raw.installs.filter((i) => !i.internal && !hiddenAccount(i.account));
  const noAccount = installs.filter((i) => i.account === null);
  const stopped = new Map<string, number>();
  for (const i of noAccount) if (!i.reachedHome) stopped.set(i.lastStep ?? 'unknown', (stopped.get(i.lastStep ?? 'unknown') ?? 0) + 1);
  const used = (a: TruthAccount) => a.overlay.drafts + a.overlay.notADraft > 0 || a.app.turns + a.app.userMessages > 0;
  const realShown = roster.filter((u) => !u.team);
  const names = new Map(accounts.map((a) => [a.id, a.name]));

  return {
    status,
    databaseAt: raw.generatedAt,
    from: raw.from,
    diffs: lasting.length ? lasting : diffs,
    database: {
      installs: installs.length,
      signups: real.filter((a) => a.newSinceFrom).length,
      activeAccounts: real.length,
      returning: real.filter((a) => !a.newSinceFrom).length,
      guests: noAccount.filter((i) => i.reachedHome).length,
      installedNoAccount: noAccount.length,
      stoppedAt: [...stopped.entries()].sort((a, b) => b[1] - a[1]).map(([step, n]) => ({ step, n })),
      usedOverlay: real.filter((a) => a.overlay.drafts + a.overlay.notADraft > 0).length,
      usedChat: real.filter((a) => a.app.turns + a.app.userMessages > 0).length,
      signedUpNotUsed: real
        .filter((a) => a.newSinceFrom && !used(a))
        .map((a) => ({ id: a.id, name: a.name, lastStep: a.lastStep, reachedHome: a.reachedHome, signupAt: a.signupAt })),
      drafts: real.reduce((s, a) => s + a.overlay.drafts, 0),
      sends: real.reduce((s, a) => s + sends(a.overlay.sent), 0),
    },
    dashboard: {
      signups: realShown.filter((u) => !u.returning).length,
      activeAccounts: realShown.length,
      drafts: realShown.reduce((s, u) => s + u.overlay.drafts, 0),
      sends: realShown.reduce((s, u) => s + sends(u.overlay.sent), 0),
    },
    feedback: raw.feedback.map((f) => ({ ...f, name: f.user ? names.get(lc(f.user)) ?? null : null })),
  };
}

export async function getTruthReport(cfg: Config, data: Dataset, force = false, now = Date.now()): Promise<TruthReport> {
  const { raw, error } = await getTruth(cfg, force);
  if (!raw) return { status: 'down', checkedAt: null, databaseAt: null, from: null, error, diffs: [], database: null, dashboard: null, feedback: [] };
  const report = compareTruth(fullRoster(data, cfg, now), raw, cfg, state.firstSeen, now);
  // A failed latest read with an older good one: show the older one, flagged.
  return { ...report, status: error ? 'down' : report.status, checkedAt: new Date(state.at).toISOString(), error };
}

// ---------------------------------------------------------------------------
// Founder feedback log: proxied to the backend, with the signed-in email as recorder.
// ---------------------------------------------------------------------------

export async function logFeedback(cfg: Config, recordedBy: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  if (!cfg.backendUrl || !cfg.backendAdminKey) return { status: 503, body: { error: 'Backend not configured' } };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const response = await fetch(`${cfg.backendUrl}/api/admin/feedback/log`, {
    method: 'POST',
    headers: { 'x-admin-api-key': cfg.backendAdminKey, 'content-type': 'application/json' },
    body: JSON.stringify({ user: str(body.user), contact: str(body.contact), source: str(body.source), quote: str(body.quote), summary: str(body.summary), at: str(body.at), recordedBy }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) await getTruth(cfg, true); // show it straight away
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: { error: text.slice(0, 200) } };
  }
}

export async function removeFeedback(cfg: Config, id: string): Promise<{ status: number }> {
  if (!cfg.backendUrl || !cfg.backendAdminKey) return { status: 503 };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 };
  const response = await fetch(`${cfg.backendUrl}/api/admin/feedback/log/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-api-key': cfg.backendAdminKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) await getTruth(cfg, true);
  return { status: response.status };
}

/** Test hook. */
export function resetTruth(): void {
  state.at = 0;
  state.raw = null;
  state.error = null;
  state.firstSeen.clear();
}
