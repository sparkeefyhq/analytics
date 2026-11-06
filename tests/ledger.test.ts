import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCountFrom } from '../server/count-from';
import { assemble, withLedger } from '../server/dataset';
import { applyPage, ledgerView, resetLedger } from '../server/ledger';
import { computeSnapshot } from '../server/metrics';

// 6 Nov: our own ledger replaces PostHog from its first row on; the dashboard's numbers built from it
// must say exactly what happened (session by session), with no double counting at the seam.

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const COUNT_FROM = '2026-11-05T20:48:16Z';
const NOW = Date.parse('2026-11-06T12:00:00Z');
const t = (min: number) => new Date(Date.parse('2026-11-06T10:00:00Z') + min * 60_000).toISOString();
const cfgFull = {
  posthogHost: '', posthogProjectId: '', posthogApiKey: '', posthogProjectApiKey: '', posthogIngestHost: '',
  backendUrl: '', backendAdminKey: '', teamIds: new Set<string>(), excludedIds: new Set<string>(),
  infraMonthlyUsd: 0, revenueMonthlyUsd: 0, costTargetPerMau: 0.4, onboardingBenchmark: 45, latencySlaMs: 3000, failureSlaPct: 3,
  dataStart: '2026-09-11', countFrom: COUNT_FROM,
};

const OCOLS = ['id', 'user', 'at', 'recorded', 'action', 'app', 'tc', 'status', 'latency', 'cost', 'panel', 'outcome', 'mood', 'moodApplied', 'refinement', 'relationship', 'option', 'taps', 'firstTry', 'used', 'drafts', 'durationMs', 'route', 'reason'];
const FCOLS = ['id', 'distinct', 'user', 'event', 'at', 'recorded', 'tc', 'screen', 'permission', 'granted', 'appVersion'];
let n = 0;
const o = (user: string, min: number, action: string, x: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = { id: `o${++n}`, user, at: t(min), recorded: t(min), action, app: 'com.whatsapp', tc: 'external', status: action === 'draft' || action === 'refine' ? 'ok' : null, latency: action === 'draft' ? 1400 : null, cost: null, panel: null, outcome: null, mood: null, moodApplied: null, refinement: null, relationship: null, option: null, taps: null, firstTry: null, used: null, drafts: null, durationMs: null, route: null, reason: null, ...x };
  return OCOLS.map((c) => row[c] ?? null);
};
const f = (distinct: string, user: string | null, min: number, event: string, x: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = { id: `f${++n}`, distinct, user, event, at: t(min), recorded: t(min), tc: 'external', screen: null, permission: null, granted: null, appVersion: '1.2.3', ...x };
  return FCOLS.map((c) => row[c] ?? null);
};

function loadLedger() {
  resetLedger();
  applyPage({
    until: t(60), more: false,
    columns: { overlay: OCOLS, funnel: FCOLS, links: ['distinct', 'user', 'recorded'] },
    overlay: [
      // A, session 1: chill draft used straight away, sent as-is.
      o(A, 1, 'draft', { panel: 'p1', moodApplied: 'chill', relationship: 'friend' }),
      o(A, 2, 'copied', { panel: 'p1', mood: 'chill', option: 1 }),
      o(A, 3, 'sent', { panel: 'p1', outcome: 'as_is' }),
      o(A, 3, 'session', { panel: 'p1', drafts: 1, taps: 2, used: true, firstTry: true, durationMs: 20_000 }),
      // A, session 2: switched to playful, then used it.
      o(A, 10, 'draft', { panel: 'p2', moodApplied: 'chill' }),
      o(A, 11, 'refine', { panel: 'p2', moodApplied: 'playful', latency: 900 }),
      o(A, 12, 'copied', { panel: 'p2', mood: 'playful', option: 1 }),
      o(A, 12, 'session', { panel: 'p2', drafts: 2, taps: 3, used: true, firstTry: false, durationMs: 31_000 }),
      // B: looked, closed, used nothing.
      o(B, 20, 'draft', { panel: 'p3', moodApplied: 'flirty' }),
      o(B, 21, 'closed', { panel: 'p3' }),
      o(B, 21, 'session', { panel: 'p3', drafts: 1, taps: 1, used: false, firstTry: false, durationMs: 9_000 }),
    ],
    funnel: [
      // B onboarded before signing in (anonymous id), then signed in.
      f('anon_b', null, 0, 'onboarding_step', { screen: 'welcome' }),
      f('anon_b', null, 0.5, 'onboarding_permission', { permission: 'accessibility', granted: true }),
      f(B, B, 1, 'onboarding_step', { screen: 'done' }),
      f(B, B, 1, 'app_open'),
    ],
    links: [['anon_b', B, t(1)]],
  });
  return ledgerView();
}

test('ledger page: a re-read row is kept once (ids de-duplicate the overlap)', () => {
  const v = loadLedger();
  applyPage({ until: t(60), more: false, columns: { overlay: OCOLS, funnel: FCOLS, links: [] }, overlay: [], funnel: [], links: [] });
  assert.equal(v.overlay.length, 11);
  assert.equal(ledgerView().overlay.length, 11);
  assert.equal(v.overlayFrom, t(1));
  assert.equal(v.funnelFrom, t(0));
});

test('PostHog is used only before the ledger starts: no double counting at the seam', () => {
  const v = loadLedger();
  const before = { id: A, ts: '2026-11-06 09:00:00', tc: '', action: 'draft', status: 'ok', app: 'com.whatsapp', latency: 1000, cost: null, panel: 'old', outcome: '', mood: '', rel: '' };
  const dup = { ...before, ts: '2026-11-06 10:01:00', panel: 'p1-raw' }; // same draft PostHog also has
  const raw = withLedger({ overlay: [before, dup], sessions: [], activity: [], steps: [{ pid: 'ph-b', uid: '', did: 'anon_b', screen: 'welcome', ts: '2026-11-06 10:00:00' }] }, v);
  assert.equal(raw.overlay.filter((r) => r.panel === 'old').length, 1);
  assert.equal(raw.overlay.filter((r) => r.panel === 'p1-raw').length, 0);
  assert.equal(raw.overlay.length, 1 + 8); // 8 ledger rows that aren't session rows
  assert.equal(raw.sessions.length, 3);
  // The anonymous onboarding steps carry B's account (identity link), and PostHog's copy is gone.
  assert.deepEqual(raw.steps.map((s) => [s.uid, s.screen]).sort(), [[B, 'done'], [B, 'perm:accessibility'], [B, 'welcome']]);
});

test('dashboard numbers from the ledger say exactly what happened', () => {
  const v = loadLedger();
  const raw = withLedger({ overlay: [], sessions: [], activity: [], steps: [] }, v);
  const backend = {
    members: [{ id: A, firstOpen: t(-5), name: 'Asha' }, { id: B, firstOpen: t(-1), name: 'Bo' }],
    facts: [], overlay: [],
  };
  const data = applyCountFrom(
    assemble(cfgFull, '2026-09-11', backend, raw, { posthogAt: null, backendAt: new Date(NOW).toISOString(), error: null, ledgerFrom: v.funnelFrom }),
    COUNT_FROM,
  );
  const snap = computeSnapshot(data, { range: '7d', surface: 'combined', audience: 'external', version: 'all' }, cfgFull, NOW);
  // 3 sessions shown a draft; 1 used on the first try (A's chill draft).
  assert.equal(snap.overlay.firstReply.total, 3);
  assert.equal(snap.overlay.firstReply.used, 1);
  // 2 of 3 sessions used a reply.
  assert.equal(snap.overview.replyUse.used, 2);
  assert.equal(snap.overview.replyUse.total, 3);
  // Per person: A used 2 replies, B none; B's onboarding reached "done" and is joined to the account.
  const a = snap.roster.find((r) => r.id === A);
  const b = snap.roster.find((r) => r.id === B);
  assert.ok(a && b);
  assert.equal(snap.overlay.users.find((u) => u.id === A)?.used, 2);
  assert.equal(snap.overlay.users.find((u) => u.id === B)?.used ?? 0, 0);
  assert.equal(data.onboarding.find((s) => s.id === B)?.screen, 'done');
  assert.ok(data.steps?.some((s) => s.id === B && s.screen === 'perm:accessibility'));
  assert.equal(snap.sources.ledgerFrom, t(0));
});

test("6 Nov (john's case): every in-app message counts, including the ones Safety answered", () => {
  resetLedger();
  const cols = [...FCOLS, 'outcome'];
  const turn = (min: number, outcome: string) => {
    const row: Record<string, unknown> = { id: `c${++n}`, distinct: A, user: A, event: 'chat_turn', at: t(min), recorded: t(min), tc: 'external', outcome };
    return cols.map((c) => row[c] ?? null);
  };
  applyPage({
    until: t(60), more: false,
    columns: { overlay: OCOLS, funnel: cols, links: [] },
    overlay: [],
    funnel: [turn(1, 'answered'), turn(2, 'answered'), ...[3, 4, 5, 6, 7, 8].map((m) => turn(m, 'safety'))],
    links: [],
  });
  const v = ledgerView();
  const raw = withLedger({ overlay: [], sessions: [], activity: [], steps: [] }, v);
  const backend = { members: [{ id: A, firstOpen: t(-5), name: 'john' }], facts: [], overlay: [] };
  const data = applyCountFrom(
    assemble(cfgFull, '2026-09-11', backend, raw, { posthogAt: null, backendAt: new Date(NOW).toISOString(), error: null, ledgerFrom: v.funnelFrom }),
    COUNT_FROM,
  );
  const snap = computeSnapshot(data, { range: '7d', surface: 'combined', audience: 'external', version: 'all' }, cfgFull, NOW);
  const john = snap.roster.find((r) => r.id === A);
  assert.deepEqual(
    { messages: john?.app.messages, answered: john?.app.answered, safety: john?.app.safety, failed: john?.app.failed },
    { messages: 8, answered: 2, safety: 6, failed: 0 },
  );
});
