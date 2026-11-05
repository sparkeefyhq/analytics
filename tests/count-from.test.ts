import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCountFrom } from '../server/count-from';
import { computeSnapshot } from '../server/metrics';
import type { Dataset } from '../server/types';

const cfg = { infraMonthlyUsd: 0, revenueMonthlyUsd: 0, costTargetPerMau: 0.4, onboardingBenchmark: 45, latencySlaMs: 3000, failureSlaPct: 3 };
const CUT = '2026-11-06T00:00:00+05:30'; // 2026-11-05T18:30Z
const NOW = Date.parse('2026-11-06T06:30:00.000Z'); // 12:00 IST on 6 Nov
const before = '2026-11-05T10:00:00.000Z';
const afterTs = '2026-11-06T02:00:00.000Z';

function dataset(): Dataset {
  return {
    generatedAt: new Date(NOW).toISOString(),
    sourceError: null,
    dataStart: '2026-09-11',
    people: [
      { id: 'old-quiet', name: 'A', signupAt: '2026-10-01T00:00:00.000Z', team: false },
      { id: 'old-back', name: 'B', signupAt: '2026-10-02T00:00:00.000Z', team: false },
      { id: 'new', name: 'C', signupAt: afterTs, team: false },
    ],
    activity: [
      { id: 'old-quiet', hour: '2026-11-05T10:00:00.000Z', surface: 'app', n: 3 },
      { id: 'old-back', hour: '2026-11-05T10:00:00.000Z', surface: 'app', n: 1 },
      { id: 'old-back', hour: '2026-11-06T02:00:00.000Z', surface: 'overlay', n: 2 },
      { id: 'new', hour: '2026-11-06T02:00:00.000Z', surface: 'app', n: 1 },
    ],
    overlay: [
      { id: 'old-quiet', ts: before, action: 'draft', status: 'ok', app: 'com.whatsapp', latency: 900, cost: 0.001, panel: '' },
      { id: 'old-back', ts: afterTs, action: 'draft', status: 'ok', app: 'com.whatsapp', latency: 900, cost: 0.001, panel: '' },
    ],
    sessions: [],
    aiCost: [
      { id: 'old-quiet', at: before, cost: 0.5 },
      { id: 'new', at: afterTs, cost: 0.01 },
    ],
    versions: [
      { id: 'old-quiet', version: '1.2.2' },
      { id: 'new', version: '1.2.3' },
    ],
    onboarding: [
      { id: 'old-back', screen: 'name' },
      { id: 'new', screen: 'name' },
    ],
    chatReplies: [
      { id: 'old-quiet', at: before },
      { id: 'new', at: afterTs },
    ],
    overlayCalls: [{ id: 'old-quiet', at: before, request: 'r1', ok: true, latency: 900, cost: 0.001 }],
    sources: { posthogAt: new Date(NOW).toISOString(), backendAt: new Date(NOW).toISOString(), overlayCallsFrom: before },
  };
}

test('unset COUNT_FROM changes nothing', () => {
  const d = dataset();
  assert.equal(applyCountFrom(d, null), d);
  assert.equal(applyCountFrom(d, 'not a date'), d);
});

test('every row before the cutoff is dropped, from every source', () => {
  const d = applyCountFrom(dataset(), CUT);
  assert.ok(d.activity.every((r) => Date.parse(r.hour) >= Date.parse(CUT)));
  assert.deepEqual(d.overlay.map((r) => r.id), ['old-back']);
  assert.deepEqual(d.aiCost.map((r) => r.id), ['new']);
  assert.deepEqual(d.chatReplies.map((r) => r.id), ['new']);
  assert.deepEqual(d.overlayCalls, []);
  assert.equal(d.sources.overlayCallsFrom, null);
  assert.equal(d.dataStart, '2026-11-06');
  assert.equal(d.countFrom, '2026-11-05T18:30:00.000Z');
});

test('quiet old accounts disappear; returning ones count as active but never as signups', () => {
  const d = applyCountFrom(dataset(), CUT);
  assert.deepEqual(d.people.map((p) => [p.id, p.returning === true]), [['old-back', true], ['new', false]]);
  assert.deepEqual(d.onboarding.map((r) => r.id), ['new']);
  assert.deepEqual(d.versions.map((r) => r.id), ['new']);

  const s = computeSnapshot(d, { range: 'all', surface: 'combined', audience: 'external', version: 'all' }, cfg, NOW);
  assert.equal(s.people, 2);
  assert.equal(s.overview.dau.value, 2); // the returning user and the new one
  assert.equal(s.overview.mau.value, 2);
  assert.equal(s.overview.onboarding.total, 1); // only the account created after the reset
  assert.equal(s.overview.retention.rows.reduce((a, r) => a + r.users, 0), 1);
  assert.equal(s.countFrom, '2026-11-05T18:30:00.000Z');
});

test('totals and filtered views agree after the reset', () => {
  const d = applyCountFrom(dataset(), CUT);
  const all = computeSnapshot(d, { range: 'all', surface: 'combined', audience: 'external', version: 'all' }, cfg, NOW);
  const week = computeSnapshot(d, { range: '7d', surface: 'combined', audience: 'external', version: 'all' }, cfg, NOW);
  const app = computeSnapshot(d, { range: 'all', surface: 'app', audience: 'external', version: 'all' }, cfg, NOW);
  const overlay = computeSnapshot(d, { range: 'all', surface: 'overlay', audience: 'external', version: 'all' }, cfg, NOW);
  assert.equal(all.overview.onboarding.total, week.overview.onboarding.total);
  assert.equal(all.overview.dau.value, week.overview.dau.value);
  assert.equal(app.overview.dau.value + overlay.overview.dau.value, all.overview.dau.value);
});

test('the hour that contains the cutoff never makes someone active on pre-cutoff activity alone', () => {
  const cut = '2026-11-05T20:14:09Z';
  const d = dataset();
  d.people.push({ id: 'early-only', name: 'D', signupAt: '2026-10-03T00:00:00.000Z', team: false }, { id: 'stays', name: 'E', signupAt: '2026-10-04T00:00:00.000Z', team: false });
  d.activity.push(
    { id: 'early-only', hour: '2026-11-05T20:00:00.000Z', surface: 'app', n: 1 }, // only the mixed hour: dropped
    { id: 'stays', hour: '2026-11-05T20:00:00.000Z', surface: 'app', n: 1 },
    { id: 'stays', hour: '2026-11-05T22:00:00.000Z', surface: 'app', n: 1 }, // later hour: kept, and the mixed one too
  );
  const out = applyCountFrom(d, cut);
  assert.equal(out.activity.some((r) => r.id === 'early-only'), false);
  assert.equal(out.people.some((p) => p.id === 'early-only'), false);
  assert.equal(out.activity.filter((r) => r.id === 'stays').length, 2);
});
