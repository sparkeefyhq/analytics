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
  totalMessagesSent,
  topUsersByMessages,
  daysActiveWithinWindow,
  personReused,
  responsesRetried,
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
    totalMessagesSent(),
    daysActiveWithinWindow(2),
    daysActiveWithinWindow(3),
    personReused(),
    responsesRetried(),
  ])) {
    assert.equal(observation.status, 'error');
    assert.equal(observation.count, null);
  }
});

test('daysActiveWithinWindow reports live progress against everyone with a first_open', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    host: process.env.POSTHOG_HOST,
    project: process.env.POSTHOG_PROJECT_ID,
    key: process.env.POSTHOG_API_KEY,
  };
  process.env.POSTHOG_HOST = 'https://posthog.example.test';
  process.env.POSTHOG_PROJECT_ID = '1';
  process.env.POSTHOG_API_KEY = 'test-key';
  global.fetch = async () => new Response(JSON.stringify({ results: [[8, 3]] }), { status: 200 });
  try {
    const result = await daysActiveWithinWindow(2);
    assert.equal(result.count, 3);
    assert.equal(result.denominator, 8);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ POSTHOG_HOST: originalEnv.host, POSTHOG_PROJECT_ID: originalEnv.project, POSTHOG_API_KEY: originalEnv.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('personReused only counts reuse in a later response, scoped by who has ever saved a person', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    host: process.env.POSTHOG_HOST,
    project: process.env.POSTHOG_PROJECT_ID,
    key: process.env.POSTHOG_API_KEY,
  };
  process.env.POSTHOG_HOST = 'https://posthog.example.test';
  process.env.POSTHOG_PROJECT_ID = '1';
  process.env.POSTHOG_API_KEY = 'test-key';
  global.fetch = async () => new Response(JSON.stringify({ results: [[4, 3]] }), { status: 200 });
  try {
    const result = await personReused();
    assert.equal(result.count, 3);
    assert.equal(result.denominator, 4);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ POSTHOG_HOST: originalEnv.host, POSTHOG_PROJECT_ID: originalEnv.project, POSTHOG_API_KEY: originalEnv.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('responsesRetried is a request count, not a user count', async () => {
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
    return new Response(JSON.stringify({ results: [[7]] }), { status: 200 });
  };
  try {
    const result = await responsesRetried();
    assert.equal(result.count, 7);
    assert.match(query, /recovery_triggered = true/);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ POSTHOG_HOST: originalEnv.host, POSTHOG_PROJECT_ID: originalEnv.project, POSTHOG_API_KEY: originalEnv.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('topUsersByMessages degrades to an empty error result without credentials, never fabricated rows', async () => {
  const result = await topUsersByMessages(10);
  assert.equal(result.status, 'error');
  assert.deepEqual(result.users, []);
});

test('topUsersByMessages ranks by message volume and passes through a null email honestly', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    host: process.env.POSTHOG_HOST,
    project: process.env.POSTHOG_PROJECT_ID,
    key: process.env.POSTHOG_API_KEY,
  };
  process.env.POSTHOG_HOST = 'https://posthog.example.test';
  process.env.POSTHOG_PROJECT_ID = '1';
  process.env.POSTHOG_API_KEY = 'test-key';
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          ['user-a', 33, 'sarthakverma0802@gmail.com'],
          ['user-b', 3, null],
        ],
      }),
      { status: 200 },
    );
  try {
    const result = await topUsersByMessages(10);
    assert.equal(result.status, 'available');
    assert.deepEqual(result.users, [
      { distinctId: 'user-a', messageCount: 33, email: 'sarthakverma0802@gmail.com', name: null },
      { distinctId: 'user-b', messageCount: 3, email: null, name: null },
    ]);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ POSTHOG_HOST: originalEnv.host, POSTHOG_PROJECT_ID: originalEnv.project, POSTHOG_API_KEY: originalEnv.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('topUsersByMessages resolves a real profile name from the backend for a phone-auth user with no PostHog email', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    host: process.env.POSTHOG_HOST,
    project: process.env.POSTHOG_PROJECT_ID,
    key: process.env.POSTHOG_API_KEY,
    backendUrl: process.env.SPARKEEFY_BACKEND_URL,
    backendKey: process.env.SPARKEEFY_BACKEND_ADMIN_KEY,
  };
  process.env.POSTHOG_HOST = 'https://posthog.example.test';
  process.env.POSTHOG_PROJECT_ID = '1';
  process.env.POSTHOG_API_KEY = 'test-key';
  process.env.SPARKEEFY_BACKEND_URL = 'https://backend.example.test';
  process.env.SPARKEEFY_BACKEND_ADMIN_KEY = 'test-admin-key';
  global.fetch = async (url, init) => {
    if (String(url).includes('posthog.example.test')) {
      return new Response(JSON.stringify({ results: [['user-a', 33, null]] }), { status: 200 });
    }
    assert.equal(init?.headers?.['x-admin-api-key'], 'test-admin-key');
    return new Response(
      JSON.stringify({ data: { users: [{ userId: 'user-a', name: 'Rahul' }, { userId: 'user-c', name: 'Someone else' }] } }),
      { status: 200 },
    );
  };
  try {
    const result = await topUsersByMessages(10);
    assert.equal(result.status, 'available');
    assert.deepEqual(result.users, [
      { distinctId: 'user-a', messageCount: 33, email: null, name: 'Rahul' },
    ]);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      POSTHOG_HOST: originalEnv.host,
      POSTHOG_PROJECT_ID: originalEnv.project,
      POSTHOG_API_KEY: originalEnv.key,
      SPARKEEFY_BACKEND_URL: originalEnv.backendUrl,
      SPARKEEFY_BACKEND_ADMIN_KEY: originalEnv.backendKey,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
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
    // [total_first_opens, eligible, returned]
    return new Response(JSON.stringify({ results: [[1, 1, 1]] }), { status: 200 });
  };
  try {
    const result = await dayWindowReturn('response_started', 1, 5);
    assert.match(query, /HAVING count\(\) >= 5/);
    assert.equal(result.count, 1);
    assert.equal(result.denominator, 1);
    assert.equal(result.pending, 0);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ POSTHOG_HOST: originalEnv.host, POSTHOG_PROJECT_ID: originalEnv.project, POSTHOG_API_KEY: originalEnv.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('dayWindowReturn counts progress live instead of waiting for the whole window to close', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    host: process.env.POSTHOG_HOST,
    project: process.env.POSTHOG_PROJECT_ID,
    key: process.env.POSTHOG_API_KEY,
  };
  process.env.POSTHOG_HOST = 'https://posthog.example.test';
  process.env.POSTHOG_PROJECT_ID = '1';
  process.env.POSTHOG_API_KEY = 'test-key';
  global.fetch = async () =>
    // 5 people ever opened the app, but only 2 have reached this window at
    // all (e.g. Day 1 = everyone immediately; here simulating a later day
    // where most people's window hasn't started yet), and 1 of those 2
    // already fired the event today — well before the window would close.
    new Response(JSON.stringify({ results: [[5, 2, 1]] }), { status: 200 });
  try {
    const result = await dayWindowReturn('wingman_opened', 1);
    assert.equal(result.count, 1, 'numerator must reflect what already happened, not wait for window close');
    assert.equal(result.denominator, 2, 'denominator is who is eligible so far, not who is done');
    assert.equal(result.pending, 3, 'the other 3 have not reached this window yet');
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
