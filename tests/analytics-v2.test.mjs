import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(`${tmpdir()}/v2-tests-`);
await build({
  entryPoints: ['lib/analytics-v2/model.ts', 'lib/analytics-v2/fixture.ts'],
  outdir: dir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
});
const { calculate, DAY, periodStart } = await import(`${dir}/model.mjs`);
const { fixture } = await import(`${dir}/fixture.mjs`);
const now = Date.parse('2026-11-15T12:00:00Z');
const iso = (n) => new Date(n).toISOString();
function base() {
  return {
    mode: 'test',
    state: 'available',
    detail: 'Test only',
    asOf: iso(now),
    coverageFrom: iso(now - 90 * DAY),
    members: [],
    facts: [],
    capabilities: [
      'activity',
      'onboarding',
      'people',
      'memory',
      'wingman',
      'responses',
      'sessions',
      'foreground',
      'situations',
      'attribution',
    ],
  };
}
const member = (id, age, extra = {}) => ({
  id,
  cohort: 'phase-0',
  from: iso(now - age * DAY),
  firstOpen: iso(now - age * DAY),
  internal: false,
  test: false,
  acquisition: 'organic',
  ...extra,
});
const fact = (id, user, kind, at, extra = {}) => ({
  id,
  user,
  kind,
  at: iso(at),
  ...extra,
});
test('retention reports live progress: started windows count, returns so far count, unstarted windows are pending', () => {
  const d = base();
  // mature: D1 window closed (returned). open: D1 window started 12h ago and
  // already returned. new: D1 window has not started yet.
  d.members = [member('mature', 2), member('open', 1.5), member('new', 0.5)];
  d.facts = [
    fact('a', 'mature', 'message', now - DAY, { request: 'a' }),
    fact('b', 'open', 'message', now - 0.2 * DAY, { request: 'b' }),
  ];
  const r = calculate(d, 'all', 'all').retention.wingman.d1;
  assert.deepEqual(
    [r.value, r.numerator, r.denominator, r.pending],
    [100, 2, 2, 1],
  );
  assert.match(r.detail, /1 of 2 windows are still open/);
  // A member whose window has started but who has not returned yet counts in the denominator, not as pending.
  d.facts.pop();
  const partial = calculate(d, 'all', 'all').retention.wingman.d1;
  assert.deepEqual([partial.numerator, partial.denominator, partial.pending], [1, 2, 1]);
  // Nobody has reached the window: still pending, never a fabricated rate.
  d.members = [member('new', 0.5)];
  d.facts = [];
  const p = calculate(d, 'all', 'all').retention.wingman.d1;
  assert.equal(p.state, 'not-eligible');
  assert.equal(p.value, null);
  assert.equal(p.pending, 1);
});
test('retention windows are half-open and D3/D7/D15/D30 use new v2 semantics', () => {
  for (const day of [1, 3, 7, 15, 30]) {
    const d = base();
    d.members = [member('a', day + 2)];
    const first = now - (day + 2) * DAY;
    d.facts = [fact('outside', 'a', 'message', first + (day + 1) * DAY)];
    assert.equal(
      calculate(d, 'all', 'all').retention.wingman[`d${day}`].numerator,
      0,
    );
    d.facts.push(fact('inside', 'a', 'message', first + day * DAY));
    assert.equal(
      calculate(d, 'all', 'all').retention.wingman[`d${day}`].numerator,
      1,
    );
  }
});
test('cohort/time are independent, closed P0 excludes Phase1-era activity, internal and test excluded', () => {
  const d = base();
  d.members = [
    member('p0', 10, { to: iso(now - 5 * DAY) }),
    member('p1', 4, { cohort: 'phase-1a' }),
    member('internal', 4, { internal: true }),
    member('test', 4, { test: true }),
  ];
  d.facts = d.members.map((m) => fact(m.id, m.id, 'message', now - DAY));
  assert.equal(calculate(d, 'phase-0', 'all').metrics.active.value, 0);
  assert.equal(calculate(d, 'phase-1a', 'all').metrics.active.value, 1);
  assert.equal(calculate(d, 'all', 'all').metrics.active.value, 1);
  assert.equal(calculate(d, 'all', 'today').metrics.active.value, 0);
  assert.equal(calculate(d, 'all', 'all').excluded, 2);
});
test('people and memory milestones count distinct users, not event volume', () => {
  const d = base();
  d.members = [member('a', 40), member('b', 40)];
  d.facts = [
    fact('p1', 'a', 'person', now - DAY, { people: 5 }),
    fact('p2', 'a', 'person', now - DAY, { people: 3 }),
    fact('m1', 'a', 'memory', now - DAY, { memories: 20 }),
    fact('m2', 'b', 'memory', now - DAY, { memories: 3 }),
  ];
  const m = calculate(d, 'all', 'all').metrics;
  assert.equal(m.people_5.value, 1);
  assert.equal(m.people_2.value, 1);
  assert.equal(m.memory_3.value, 2);
  assert.equal(m.memory_5.value, 1);
  assert.equal(m.memory_20.value, 1);
  assert.equal(m.memory_median.value, 11.5);
});
test('frequencies deduplicate requests, use distinct sessions, and distinguish today/7D/30D', () => {
  const d = base();
  d.members = [member('a', 40)];
  d.facts = [
    fact('a', 'a', 'message', now - 1000, { request: 'r1', session: 's1' }),
    fact('dup', 'a', 'message', now - 1000, { request: 'r1', session: 's1' }),
    fact('b', 'a', 'message', now - 2 * DAY, { request: 'r2', session: 's2' }),
    fact('c', 'a', 'message', now - 10 * DAY, { request: 'r3', session: 's3' }),
  ];
  const r = calculate(d, 'all', 'all');
  assert.equal(r.metrics.messages_day.value, 1);
  assert.equal(r.metrics.messages_7d.value, 2);
  assert.equal(r.metrics.messages_30d.value, 3);
  assert.equal(r.metrics.sessions.value, 3);
  assert.equal(r.users[0].metrics.messages_7d.value, 2);
  // Averages carry their arithmetic so the UI never shows a bare "2.5".
  assert.equal(r.metrics.messages_7d.basis, '2 messages ÷ 1 active users');
  assert.equal(r.metrics.sessions.basis, '3 chats ÷ 1 active users');
});
test('actual zero, no cohort, disconnected, pending, and query error remain distinct', () => {
  const d = base();
  assert.equal(calculate(d, 'all', 'all').metrics.active.state, 'no-data');
  d.members = [member('a', 1)];
  assert.equal(calculate(d, 'all', 'all').metrics.active.value, 0);
  d.capabilities = [];
  assert.equal(
    calculate(d, 'all', 'all').metrics.active.state,
    'not-connected',
  );
  assert.equal(calculate(d, 'all', 'all').metrics.memory_median.value, null);
  d.state = 'query-error';
  assert.equal(calculate(d, 'all', 'all').metrics.active.state, 'query-error');
  assert.equal(calculate(d, 'all', 'all').metrics.active.value, null);
});
test('second genuine situation needs distinct situations; organic needs positive attribution', () => {
  const d = base();
  d.members = [member('a', 10)];
  d.facts = [
    fact('s1', 'a', 'situation', now - 5 * DAY, { situation: 'same' }),
    fact('duplicate', 'a', 'situation', now - 4 * DAY, { situation: 'same' }),
    fact('message', 'a', 'message', now - DAY),
  ];
  assert.equal(calculate(d, 'all', 'all').metrics.second_situation.value, 0);
  d.facts.push(
    fact('s2', 'a', 'situation', now - 1000, {
      situation: 'second',
      attribution: 'unknown',
    }),
  );
  const r = calculate(d, 'all', 'all');
  assert.equal(r.metrics.second_situation.value, 1);
  assert.equal(r.metrics.organic_second.value, 0);
  d.facts.at(-1).attribution = 'organic';
  d.facts.at(-1).assisted = false;
  assert.equal(calculate(d, 'all', 'all').metrics.organic_second.value, 1);
});
test('response success deduplicates retries, completion supersedes failed attempt', () => {
  const d = base();
  d.members = [member('a', 10)];
  d.facts = [
    fact('f', 'a', 'failed', now - 3000, { request: 'r' }),
    fact('c', 'a', 'complete', now - 1000, { request: 'r' }),
    fact('c2', 'a', 'complete', now - 500, { request: 'r' }),
  ];
  const m = calculate(d, 'all', 'all').metrics;
  assert.equal(m.complete.value, 1);
  assert.equal(m.failed.value, 0);
  assert.equal(m.success.denominator, 1);
  assert.equal(m.success.numerator, 1);
});
test('output allowlist drops private content even if upstream facts contain it', () => {
  const d = fixture(now);
  d.facts[0].email = 'private@example.test';
  d.facts[0].prompt = 'private content';
  d.members[0].name = 'Private Name';
  const output = JSON.stringify(calculate(d, 'all', 'all'));
  assert.ok(!/private@example|private content|Private Name/.test(output));
  for (const user of calculate(d, 'all', 'all').users)
    assert.deepEqual(Object.keys(user).sort(), [
      'acquisition',
      'cohort',
      'cohorts',
      'firstOpen',
      'id',
      'lastActive',
      'metrics',
      'retention',
    ]);
});
test('today starts at midnight Asia/Kolkata', () => {
  assert.equal(
    new Date(periodStart('today', now)).toISOString(),
    '2026-11-14T18:30:00.000Z',
  );
});
test('All deduplicates returning people across cohorts while excluding membership gaps', () => {
  const d = base();
  d.members = [
    member('same', 10, { to: iso(now - 5 * DAY) }),
    member('same', 3, { cohort: 'phase-1a', firstOpen: iso(now - 10 * DAY) }),
  ];
  d.facts = [
    fact('old', 'same', 'message', now - 7 * DAY, { request: 'old' }),
    fact('gap', 'same', 'message', now - 4 * DAY, { request: 'gap' }),
    fact('new', 'same', 'message', now - DAY, { request: 'new' }),
  ];
  const all = calculate(d, 'all', 'all');
  assert.equal(all.metrics.active.value, 1);
  assert.equal(all.metrics.requests.value, 2);
  assert.equal(all.users.length, 1);
  assert.deepEqual(all.users[0].cohorts, ['phase-0', 'phase-1a']);
  assert.equal(calculate(d, 'phase-0', 'all').metrics.requests.value, 1);
  assert.equal(calculate(d, 'phase-1a', 'all').metrics.requests.value, 1);
});
test('every measured metric is stamped with the dataset source, never a source that was not queried', () => {
  const d = { ...fixture(now), source: 'Backend' };
  const out = calculate(d, 'all', 'all');
  const all = [
    ...Object.values(out.metrics),
    ...Object.values(out.retention.wingman),
    ...out.users.flatMap((u) => [...Object.values(u.metrics), ...Object.values(u.retention.wingman)]),
  ];
  assert.ok(all.length > 50);
  assert.ok(all.every((m) => m.source !== 'PostHog'));
  assert.ok(all.some((m) => m.source === 'Backend'));
  // Without a declared source the original labels stay untouched.
  assert.ok(Object.values(calculate(fixture(now), 'all', 'all').metrics).some((m) => m.source === 'PostHog'));
});
