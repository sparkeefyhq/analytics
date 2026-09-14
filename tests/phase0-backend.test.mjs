import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(`${tmpdir()}/phase0-backend-`);
await build({
  entryPoints: ['lib/analytics-v2/phase0-backend.ts', 'lib/analytics-v2/fixture.ts'],
  outdir: dir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  alias: { '@': './' },
  outExtension: { '.js': '.mjs' },
});
const { phase0SnapshotFromDataset, istDayStart, istWeekStart } = await import(`${dir}/phase0-backend.mjs`);
const { fixture } = await import(`${dir}/fixture.mjs`);
const now = Date.parse('2026-09-18T13:45:00Z');
const DAY = 86400000;
const iso = (n) => new Date(n).toISOString();

function dataset(members, facts, capabilities = ['activity', 'onboarding', 'people', 'memory', 'wingman', 'responses', 'retries']) {
  return {
    mode: 'live', source: 'Backend', state: 'available', detail: 'test', asOf: iso(now), coverageFrom: iso(now - 30 * DAY),
    members, facts, capabilities,
  };
}
const member = (id, firstOpen, internal = false) => ({ id, cohort: 'phase-0', from: iso(firstOpen), firstOpen: iso(firstOpen), internal, test: false, acquisition: 'unknown' });
const fact = (user, at, kind, extra = {}) => ({ id: `${user}-${kind}-${at}`, user, at: iso(at), kind, ...extra });

test('every Phase 0 observation is stamped backend and internal accounts never count', () => {
  const t0 = now - 2 * DAY;
  const d = dataset(
    [member('u1', t0), member('team', t0, true)],
    [
      fact('u1', t0, 'first_open'), fact('u1', t0, 'onboarding'),
      fact('u1', t0 + 3600e3, 'message', { request: 'r1' }), fact('u1', t0 + 3600e3, 'complete', { request: 'r1' }),
      fact('u1', t0 + 3600e3, 'wingman', { session: 's1' }),
      fact('u1', t0 + 2 * 3600e3, 'person', { people: 1 }), fact('u1', t0 + 3 * 3600e3, 'person', { people: 2 }),
      fact('team', t0, 'first_open'), fact('team', t0, 'message', { request: 'tr' }),
    ],
  );
  const s = phase0SnapshotFromDataset(d, new Map([['u1', 'Real Name']]), now);
  assert.equal(s.version, 1);
  for (const [key, o] of Object.entries(s.metrics)) if (key !== 'downloads') assert.equal(o.source, 'backend', key);
  assert.equal(s.metrics.first_open.count, 1);
  assert.equal(s.metrics.onboarding.count, 1);
  assert.equal(s.metrics.first_answer.count, 1);
  assert.equal(s.metrics.person_2.count, 1);
  assert.equal(s.metrics.person_3.count, 0);
  assert.equal(s.metrics.total_messages_sent.count, 1);
  assert.equal(s.metrics.responses_complete.count, 1);
  // Calendar events come from the events table; none in this fixture is a real zero.
  assert.deepEqual([s.metrics.calendar_created.count, s.metrics.calendar_created.status], [0, 'available']);
  // Conversations are gated on the situations capability, absent from this fixture's capability list.
  assert.equal(s.metrics.organic_second.status, 'unavailable');
  const withSituations = phase0SnapshotFromDataset(
    dataset(
      [member('u1', t0)],
      [
        fact('u1', t0, 'first_open'), fact('u1', t0, 'person', { people: 1 }),
        fact('u1', t0 + 1, 'situation', { situation: 's1', attribution: 'organic' }),
        fact('u1', t0 + 2, 'situation', { situation: 's2', attribution: 'organic' }),
        fact('u1', t0 + 1, 'message', { request: 'a', session: 's1', person: 'p1' }),
        fact('u1', t0 + 2, 'message', { request: 'b', session: 's2', person: 'p1' }),
      ],
      ['activity', 'people', 'wingman', 'situations', 'people-use', 'attribution'],
    ),
    new Map(), now,
  );
  assert.deepEqual([withSituations.metrics.organic_second.count, withSituations.metrics.organic_second.denominator], [1, 1]);
  assert.deepEqual([withSituations.metrics.person_reused.count, withSituations.metrics.person_reused.denominator], [1, 1]);
  assert.deepEqual([withSituations.metrics.reminder_return.count, withSituations.metrics.reminder_return.denominator], [0, 1]);
  assert.deepEqual(s.topUsers, [{ distinctId: 'u1', email: null, name: 'Real Name', messageCount: 1 }]);
  assert.ok(!JSON.stringify(s).includes('team'));
});

test('day windows report elapsed progress with pending users, and retries never inflate messages', () => {
  const recent = now - 6 * 3600e3; // window 1 open, window 2 not started
  const old = now - 3 * DAY; // all four windows started
  const d = dataset(
    [member('a', recent), member('b', old)],
    [
      fact('a', recent, 'first_open'), fact('a', recent + 3600e3, 'wingman', { session: 'sa' }),
      ...[1, 2, 3, 4, 5].map((i) => fact('a', recent + i * 60e3, 'message', { request: `a${i}` })),
      fact('a', recent + 60e3, 'retry', { request: 'a1' }), fact('a', recent + 60e3, 'failed', { request: 'a1' }), fact('a', recent + 120e3, 'complete', { request: 'a1' }),
      fact('b', old, 'first_open'), fact('b', old + DAY + 3600e3, 'message', { request: 'b1' }), fact('b', old + 2 * DAY + 3600e3, 'message', { request: 'b2' }),
    ],
  );
  const s = phase0SnapshotFromDataset(d, new Map(), now);
  assert.deepEqual([s.metrics.wingman_open_day1.count, s.metrics.wingman_open_day1.denominator, s.metrics.wingman_open_day1.pending], [1, 2, 0]);
  assert.equal(s.metrics.five_messages_day1.count, 1);
  assert.deepEqual([s.metrics.return_request_day2.count, s.metrics.return_request_day2.denominator, s.metrics.return_request_day2.pending], [1, 1, 1]);
  assert.equal(s.metrics.return_request_day3.count, 1);
  // b messaged on day-index 1 and 2 (not 0): two distinct days, not three.
  assert.equal(s.metrics.request_days_2.count, 1);
  assert.equal(s.metrics.request_days_3.count, 0);
  assert.equal(s.metrics.total_messages_sent.count, 7);
  assert.equal(s.metrics.responses_failed.count, 0, 'a completion supersedes the failed attempt');
  assert.equal(s.metrics.responses_retried.count, 1);
});

test('a disconnected or errored source never yields a count', () => {
  const off = phase0SnapshotFromDataset({ ...dataset([], []), state: 'not-connected' }, new Map(), now);
  assert.ok(Object.values(off.metrics).every((o) => o.count === null && o.status === 'unavailable'));
  const err = phase0SnapshotFromDataset({ ...dataset([], []), state: 'query-error' }, new Map(), now);
  assert.ok(Object.values(err.metrics).every((o) => o.status === 'error'));
  const gated = phase0SnapshotFromDataset(dataset([member('u', now - DAY)], [fact('u', now - DAY, 'first_open')], ['activity']), new Map(), now);
  assert.equal(gated.metrics.first_open.count, 1);
  assert.equal(gated.metrics.person_1.status, 'unavailable');
});

test('active-user periods use Asia/Kolkata boundaries', () => {
  assert.equal(iso(istDayStart(now)), '2026-09-17T18:30:00.000Z');
  // 2026-09-18 is a Friday; Monday 00:00 IST was 2026-09-13T18:30Z.
  assert.equal(iso(istWeekStart(now)), '2026-09-13T18:30:00.000Z');
  const s = phase0SnapshotFromDataset(
    dataset([member('u', now - 10 * DAY)], [fact('u', now - 10 * DAY, 'first_open'), fact('u', now - 3600e3, 'message', { request: 'r' })]),
    new Map(), now,
  );
  assert.equal(s.activeUsers.today.count, 1);
  assert.equal(s.activeUsers.week.count, 1);
  assert.equal(s.activeUsers.all.count, 1);
});

test('the synthetic fixture still renders a full Phase 0 snapshot', () => {
  const s = phase0SnapshotFromDataset({ ...fixture(now), source: 'Backend' }, new Map(), now);
  assert.ok(s.metrics.first_open.count > 0);
  assert.ok(s.topUsers.length > 0);
});
