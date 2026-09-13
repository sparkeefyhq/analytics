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
  milestone,
  ordinalMilestone,
  dayWindowReturn,
  hogqlString,
  organicSecondSituation,
  reminderReturn,
  activeUsersForPeriod,
  requestCount,
} = await import(pathToFileURL(outfile));

test('unavailable() never fabricates a count', () => {
  assert.deepEqual(unavailable(), { count: null, status: 'unavailable', source: 'posthog' });
  assert.deepEqual(unavailable('manual'), { count: null, status: 'unavailable', source: 'manual' });
});

test('every project-wide metric degrades to error without credentials, never a fabricated count', async () => {
  for (const observation of await Promise.all([
    milestone('first_open'),
    ordinalMilestone('person_context_created', 'person_count_after', 2),
    dayWindowReturn('wingman_opened', 1),
    organicSecondSituation(),
    reminderReturn(),
    activeUsersForPeriod('today'),
    requestCount('response_completed'),
  ])) {
    assert.equal(observation.status, 'error');
    assert.equal(observation.count, null);
  }
});

test('five-message Day 1 measurement requires five events, not merely one', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    host: process.env.POSTHOG_HOST,
    project: process.env.POSTHOG_PROJECT_ID,
    key: process.env.POSTHOG_API_KEY,
  };
  process.env.POSTHOG_HOST = 'https://posthog.example.test';
  process.env.POSTHOG_PROJECT_ID = '1';
  process.env.POSTHOG_API_KEY = 'test-key';
  let query = '';
  global.fetch = async (_url, init) => {
    query = JSON.parse(init.body).query.query;
    return new Response(JSON.stringify({ results: [[1, 1]] }), { status: 200 });
  };
  try {
    const result = await dayWindowReturn('response_started', 1, 5);
    assert.match(query, /HAVING count\(\) >= 5/);
    assert.equal(result.count, 1);
    assert.equal(result.denominator, 1);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ POSTHOG_HOST: originalEnv.host, POSTHOG_PROJECT_ID: originalEnv.project, POSTHOG_API_KEY: originalEnv.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('PostHog string literals are safely quoted before forming HogQL', () => {
  assert.equal(hogqlString("person' OR 1=1"), "'person'' OR 1=1'");
});
