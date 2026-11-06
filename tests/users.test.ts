import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCountFrom } from '../server/count-from';
import { computeSnapshot } from '../server/metrics';
import type { Dataset } from '../server/types';

const cfg = { infraMonthlyUsd: 0, revenueMonthlyUsd: 0, costTargetPerMau: 0.4, onboardingBenchmark: 45, latencySlaMs: 3000, failureSlaPct: 3 };
const NOW = Date.parse('2026-11-20T06:30:00.000Z'); // 12:00 IST
const H = 3_600_000;
const D = 24 * H;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const TEAM = '33333333-3333-4333-8333-333333333333';
const filters = { range: '30d', surface: 'combined', audience: 'external', version: 'all' } as const;

type Ev = Dataset['overlay'][number];
const ev = (id: string, msAgo: number, action: string, extra: Partial<Ev> = {}): Ev => ({
  id, ts: at(msAgo), action, status: action === 'draft' ? 'ok' : '', app: 'com.whatsapp', latency: action === 'draft' ? 1200 : null, cost: null, panel: '', ...extra,
});
const step = (id: string, screen: string, msAgo: number, account = true) => ({ id, screen, ts: at(msAgo), account });

function dataset(partial: Partial<Dataset>): Dataset {
  return {
    generatedAt: new Date(NOW).toISOString(),
    sourceError: null,
    dataStart: '2026-09-11',
    people: [],
    activity: [],
    overlay: [],
    sessions: [],
    aiCost: [],
    versions: [],
    onboarding: [],
    chatReplies: [],
    overlayCalls: [],
    steps: [],
    sources: { posthogAt: new Date(NOW).toISOString(), backendAt: new Date(NOW).toISOString(), overlayCallsFrom: null },
    ...partial,
  };
}

test('funnel counts everyone who reached each screen, in app order, including installs that never signed in', () => {
  const snap = computeSnapshot(
    dataset({
      people: [{ id: A, name: 'A', signupAt: at(3 * D), team: false }, { id: TEAM, name: 'T', signupAt: at(3 * D), team: true }],
      steps: [
        step(A, 'Welcome', 3 * D), step(A, 'IntroVideo', 3 * D + 60_000), step(A, 'Permissions', 3 * D - 60_000),
        step(A, 'perm:accessibility', 3 * D - 90_000), step(A, 'Home', 3 * D - 120_000),
        step('anon:x', 'IntroVideo', 2 * D, false), step('anon:x', 'Welcome', 2 * D - 1000, false),
        step(TEAM, 'IntroVideo', D), step(TEAM, 'Home', D - 1000),
      ],
    }),
    filters,
    cfg,
    NOW,
  );
  assert.deepEqual(snap.funnel.map((f) => [f.screen, f.reached]), [
    ['IntroVideo', 2], ['Welcome', 2], ['Permissions', 1], ['perm:accessibility', 1], ['Home', 1],
  ]);
  assert.equal(snap.funnel[0].pctOfStart, 100);
  assert.equal(snap.funnel.find((f) => f.screen === 'Welcome')?.stoppedHere, 1); // the anonymous install
  assert.equal(snap.funnel.find((f) => f.screen === 'perm:accessibility')?.pctOfPrev, 100); // vs Permissions screen
  const internal = computeSnapshot(dataset({ people: [{ id: TEAM, name: 'T', signupAt: at(D), team: true }], steps: [step(TEAM, 'IntroVideo', D), step('anon:x', 'IntroVideo', D, false)] }), { ...filters, audience: 'internal' }, cfg, NOW);
  assert.deepEqual(internal.funnel.map((f) => f.reached), [1]);
});

test('journey, repeat and sent outcomes per user follow the benchmark definitions', () => {
  const signup = 9 * D;
  const snap = computeSnapshot(
    dataset({
      people: [{ id: A, name: 'A', signupAt: at(signup), team: false }, { id: B, name: 'B', signupAt: at(2 * D), team: false }],
      steps: [step(A, 'IntroVideo', signup), step(A, 'Home', signup - H), step(B, 'IntroVideo', 2 * D), step(B, 'PhoneLogin', 2 * D - 1000)],
      overlay: [
        ev(A, signup - 2 * H, 'draft', { relationship: 'romantic', mood: 'playful' }),
        ev(A, signup - 2 * H + 1000, 'inserted'),
        ev(A, signup - 2 * H + 2000, 'sent', { sentOutcome: 'edited' }),
        ev(A, signup - 3 * D, 'draft', { relationship: 'romantic', mood: 'bold' }),
        ev(A, signup - 3 * D + 1000, 'copied'),
        ev(A, signup - 3 * D + 2000, 'sent', { sentOutcome: 'as_is' }),
        ev(A, signup - 3 * D + 3000, 'sent', { sentOutcome: 'own' }),
      ],
    }),
    filters,
    cfg,
    NOW,
  );
  const a = snap.roster.find((u) => u.id === A)!;
  assert.ok(a.journey.setupAt);
  assert.equal(a.journey.repeat, 'yes');
  assert.deepEqual(a.overlay.sent, { asIs: 1, edited: 1, own: 1 });
  assert.equal(a.overlay.copied, 1);
  assert.equal(a.overlay.inserted, 1);
  assert.deepEqual(a.overlay.relationships, [{ label: 'romantic', n: 2 }]);
  const b = snap.roster.find((u) => u.id === B)!;
  assert.equal(b.journey.setupAt, null);
  assert.equal(b.journey.lastScreen, 'PhoneLogin');
  assert.ok(b.flags.some((f) => f.key === 'stuck'));

  const g = Object.fromEntries(snap.scorecard.gates.map((x) => [x.key, x]));
  assert.equal(snap.scorecard.cohort, 2);
  assert.deepEqual([g.setup.n, g.setup.d], [1, 2]);
  assert.deepEqual([g.useful.n, g.acted.n], [1, 1]);
  assert.deepEqual([g.repeat.n, g.repeat.d, g.repeat.pending], [1, 1, 0]); // A is 9 days past first use
  assert.equal(g.repeat.pass, null); // 1 of 2 eligible: too few to read repeat yet (needs 75% of the cohort)
});

test('repeat stays pending inside the 7-day window and an own-words send is not adoption', () => {
  const snap = computeSnapshot(
    dataset({
      people: [{ id: A, name: 'A', signupAt: at(3 * D), team: false }, { id: B, name: 'B', signupAt: at(3 * D), team: false }],
      overlay: [ev(A, 2 * D, 'draft'), ev(A, 2 * D - 1000, 'copied'), ev(B, 2 * D, 'draft'), ev(B, 2 * D - 1000, 'sent', { sentOutcome: 'own' })],
    }),
    filters,
    cfg,
    NOW,
  );
  assert.equal(snap.roster.find((u) => u.id === A)!.journey.repeat, 'pending');
  assert.equal(snap.roster.find((u) => u.id === B)!.journey.firstActAt, null);
  const repeat = snap.scorecard.gates.find((x) => x.key === 'repeat')!;
  assert.deepEqual([repeat.d, repeat.pending, repeat.pass], [0, 1, null]);
});

test('quota counts delivered drafts this IST month against the free pilot allowance', () => {
  const drafts = Array.from({ length: 85 }, (_, i) => ev(A, H + i * 60_000, 'draft'));
  const snap = computeSnapshot(dataset({ people: [{ id: A, name: 'A', signupAt: at(D), team: false }], overlay: [...drafts, ev(A, H, 'draft', { status: 'failed' })] }), filters, cfg, NOW);
  const a = snap.roster[0];
  assert.deepEqual([a.quota.drafts, a.quota.draftCap], [85, 100]);
  assert.ok(a.flags.some((f) => f.key === 'cap'));
  assert.equal(snap.scorecard.nearCap, 1);
});

test('count-from keeps funnel rows only for people who started after the cutoff and new accounts', () => {
  const cut = new Date(NOW - 2 * D).toISOString();
  const out = applyCountFrom(
    dataset({
      people: [{ id: A, name: 'A', signupAt: at(D), team: false }, { id: B, name: 'B', signupAt: at(10 * D), team: false }],
      steps: [step(A, 'IntroVideo', D), step(B, 'Home', D), step('anon:old', 'IntroVideo', 3 * D, false), step('anon:old', 'Welcome', D, false), step('anon:new', 'IntroVideo', D, false)],
    }),
    cut,
  );
  assert.deepEqual(out.steps!.map((s) => s.id).sort(), [A, 'anon:new']);
});

test('roster drafts count only taps that reached the model (7 Nov: Karan 6 shown vs 5 real)', () => {
  const overlay = [
    ev(A, H, 'draft'),
    ev(A, 2 * H, 'draft', { status: 'failed' }),
    ev(A, 3 * H, 'draft', { status: 'needs_target' }),
    ev(A, 4 * H, 'draft', { status: 'no_reply' }),
    ev(A, 5 * H, 'draft', { status: 'unsupported' }),
  ];
  const snap = computeSnapshot(dataset({ people: [{ id: A, name: 'A', signupAt: at(D), team: false }], overlay }), filters, cfg, NOW);
  const a = snap.roster.find((u) => u.id === A)!;
  assert.deepEqual([a.overlay.drafts, a.overlay.delivered, a.overlay.failed], [2, 1, 1]);
});
