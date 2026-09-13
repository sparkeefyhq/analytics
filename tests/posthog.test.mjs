import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// lib/posthog.ts uses the "@/..." alias, which only resolves through the
// project's esbuild pipeline (see scripts/build-vercel-api.mjs) — not plain
// node ESM resolution. Bundle it the same way for this unit test. The output
// must live under the project so node can still resolve external deps
// (@libsql/client etc.) by walking up to node_modules.
const outfile = resolve(mkdtempSync('tests/.tmp-posthog-'), 'posthog.mjs');
await build({ entryPoints: ['lib/posthog.ts'], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', alias: { '@': './' } });
const {
  unavailable,
  cohortMilestone,
  cohortOrdinalMilestone,
  cohortDayWindowReturn,
  organicSecondSituation,
  reminderReturn,
  activeUsersForPeriod,
  requestCount,
} = await import(pathToFileURL(outfile));

test('unavailable() never fabricates a count', () => {
  assert.deepEqual(unavailable(), { count: null, status: 'unavailable', source: 'posthog' });
  assert.deepEqual(unavailable('manual'), { count: null, status: 'unavailable', source: 'manual' });
});

test('an entirely unmapped cohort is pending, never zero, and never queries PostHog', async () => {
  const cohort = [{ participantId: 'p1', distinctId: null }, { participantId: 'p2', distinctId: null }];
  for (const observation of await Promise.all([
    cohortMilestone(cohort, 'first_open'),
    cohortOrdinalMilestone(cohort, 'person_context_created', 'person_count_after', 2),
    cohortDayWindowReturn(cohort, 'wingman_opened', 1),
    organicSecondSituation(cohort),
    reminderReturn(cohort),
    activeUsersForPeriod(cohort, 'today'),
  ])) {
    assert.equal(observation.status, 'pending');
    assert.equal(observation.count, null);
  }
});

test('an empty cohort is pending rather than an available zero', async () => {
  const observation = await cohortMilestone([], 'first_open');
  assert.equal(observation.status, 'pending');
  assert.equal(observation.count, null);
  assert.equal(observation.denominator, null);
});

test('a mapped cohort with no PostHog credentials degrades to error, not a fabricated count', async () => {
  const cohort = [{ participantId: 'p1', distinctId: 'abc123' }];
  const observation = await cohortMilestone(cohort, 'first_open');
  assert.equal(observation.status, 'error');
  assert.equal(observation.count, null);
});

test('requestCount (no cohort scoping) also degrades to error without credentials, never a fabricated count', async () => {
  const observation = await requestCount('response_completed');
  assert.equal(observation.status, 'error');
  assert.equal(observation.count, null);
});
