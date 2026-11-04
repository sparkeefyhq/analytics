import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSessions, computeSnapshot, quantile } from '../server/metrics';
import type { Dataset } from '../server/types';

const cfg = { infraMonthlyUsd: 0, revenueMonthlyUsd: 0, costTargetPerMau: 0.4, onboardingBenchmark: 45, latencySlaMs: 3000, failureSlaPct: 3 };
const NOW = Date.parse('2026-11-05T06:30:00.000Z'); // 12:00 IST
const H = 3_600_000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const hourAgo = (h: number) => new Date(Math.floor((NOW - h * H) / H) * H).toISOString();

function draft(id: string, msAgo: number, extra: Partial<Dataset['overlay'][number]> = {}): Dataset['overlay'][number] {
  return { id, ts: at(msAgo), action: 'draft', status: 'ok', app: 'com.whatsapp', latency: 1000, cost: 0.0005, panel: '', ...extra };
}

function dataset(partial: Partial<Dataset>): Dataset {
  return {
    generatedAt: new Date(NOW).toISOString(),
    dataStart: '2026-09-11',
    people: [],
    activity: [],
    overlay: [],
    sessions: [],
    aiCost: [],
    versions: [],
    onboarding: [],
    chatReplies: [],
    ...partial,
  };
}

test('quantile interpolates', () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([10], 0.95), 10);
});

test('sessions split on 5 minute idle gap and on a new panel id', () => {
  const s = buildSessions(
    [
      draft('u1', 60 * 60_000),
      { ...draft('u1', 59 * 60_000), action: 'inserted', status: '' },
      draft('u1', 40 * 60_000), // 19 min later: new session
      draft('u1', 39 * 60_000, { panel: 'p1' }),
      draft('u1', 38 * 60_000, { panel: 'p2' }), // new panel: new session
    ],
    [],
  );
  assert.equal(s.length, 3);
  assert.equal(s[0].used, true);
  assert.equal(s[0].firstUsed, true);
  assert.equal(s[1].requests, 2);
  assert.equal(s[1].used, false);
});

test('regenerating before inserting is not a first-reply use', () => {
  const [s] = buildSessions(
    [draft('u1', 10 * 60_000), draft('u1', 9 * 60_000), { ...draft('u1', 8 * 60_000), action: 'copied', status: '' }],
    [],
  );
  assert.equal(s.used, true);
  assert.equal(s.firstUsed, false);
});

test('team accounts never mix with external numbers', () => {
  const data = dataset({
    people: [
      { id: 'real', name: 'Real', signupAt: at(40 * 24 * H), team: false },
      { id: 'team', name: 'Team', signupAt: at(40 * 24 * H), team: true },
    ],
    activity: [
      { id: 'real', hour: hourAgo(2), surface: 'app', n: 1 },
      { id: 'team', hour: hourAgo(2), surface: 'overlay', n: 5 },
    ],
  });
  const ext = computeSnapshot(data, { range: '30d', surface: 'combined', audience: 'external', version: 'all' }, cfg, NOW);
  const int = computeSnapshot(data, { range: '30d', surface: 'combined', audience: 'internal', version: 'all' }, cfg, NOW);
  assert.equal(ext.overview.dau.value, 1);
  assert.equal(ext.overview.dau.app, 1);
  assert.equal(ext.overview.dau.overlay, 0);
  assert.equal(int.overview.dau.value, 1);
  assert.equal(int.overview.dau.overlay, 1);
});

test('surface filter limits activity to that surface', () => {
  const data = dataset({
    people: [{ id: 'a', name: null, signupAt: at(40 * 24 * H), team: false }],
    activity: [{ id: 'a', hour: hourAgo(3), surface: 'app', n: 2 }],
  });
  const overlayOnly = computeSnapshot(data, { range: '30d', surface: 'overlay', audience: 'external', version: 'all' }, cfg, NOW);
  assert.equal(overlayOnly.overview.dau.value, 0);
  assert.equal(overlayOnly.overview.mau.value, 0);
});

test('onboarding completion counts signups in range that reached a first reply', () => {
  const data = dataset({
    people: [
      { id: 'a', name: null, signupAt: at(3 * 24 * H), team: false },
      { id: 'b', name: null, signupAt: at(3 * 24 * H), team: false },
      { id: 'c', name: null, signupAt: at(60 * 24 * H), team: false }, // outside 30d
    ],
    chatReplies: [{ id: 'a', at: at(2 * 24 * H) }],
    onboarding: [{ id: 'b', screen: 'AccessibilityPermission' }],
  });
  const s = computeSnapshot(data, { range: '30d', surface: 'combined', audience: 'external', version: 'all' }, cfg, NOW);
  assert.deepEqual(
    { total: s.overview.onboarding.total, completed: s.overview.onboarding.completed, step: s.overview.onboarding.topDropStep },
    { total: 2, completed: 1, step: 'AccessibilityPermission' },
  );
});

test('reply-use, failures, latency and cost come from drafts in range', () => {
  const data = dataset({
    people: [{ id: 'a', name: 'A', signupAt: at(40 * 24 * H), team: false }],
    overlay: [
      draft('a', 50 * H, { cost: null }), // before cost tracking: estimated at tracked average
      { ...draft('a', 50 * H - 60_000), action: 'inserted', status: '', cost: null },
      draft('a', 2 * H, { latency: 2000, cost: 0.001 }),
      draft('a', 2 * H - 30_000, { status: 'failed', latency: null, cost: null }),
    ],
  });
  const s = computeSnapshot(data, { range: '30d', surface: 'combined', audience: 'external', version: 'all' }, cfg, NOW);
  assert.equal(s.overlay.failures.failed, 1);
  assert.equal(s.overlay.failures.requests, 3);
  assert.equal(s.overview.replyUse.total, 2);
  assert.equal(s.overview.replyUse.used, 1);
  assert.equal(s.overlay.cost.perRequest, 0.001);
  assert.equal(s.overlay.cost.estimated, true);
  assert.ok(Math.abs(s.overlay.cost.total - 0.002) < 1e-9);
  assert.equal(s.overlay.latency.p50, 1500);
  assert.equal(s.overlay.platforms[0].label, 'WhatsApp');
  assert.equal(s.overlay.users[0].name, 'A');
});

test('retention: D1 counts activity on the day after signup; open windows stay pending', () => {
  const signup = '2026-10-20T05:00:00.000Z'; // 20 Oct IST
  const data = dataset({
    people: [
      { id: 'a', name: null, signupAt: signup, team: false },
      { id: 'b', name: null, signupAt: signup, team: false },
    ],
    activity: [{ id: 'a', hour: '2026-10-21T06:00:00.000Z', surface: 'app', n: 1 }],
  });
  const s = computeSnapshot(data, { range: 'all', surface: 'combined', audience: 'external', version: 'all' }, cfg, NOW);
  const row = s.overview.retention.rows[0];
  assert.equal(row.users, 2);
  assert.deepEqual(row.d1, { kind: 'value', n: 1, d: 2, pct: 50 });
  assert.equal(row.d14.kind, 'pending'); // days 14-20 end 9 Nov
  assert.equal(row.state, 'Measuring');
});
