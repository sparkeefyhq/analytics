import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const dir = mkdtempSync(`${tmpdir()}/v2-api-`);
await build({
  entryPoints: ['lib/analytics-v2/source.ts', 'app/api/analytics/v2/route.ts'],
  outdir: dir,
  outbase: '.',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  alias: { '@': './' },
  outExtension: { '.js': '.mjs' },
});
// Bundled external database dependency resolves from the repository, not a temporary root.
const { GET } = await import('../api/native.js').then((m) => ({
  GET: m.handle,
}));
test('v2 API validates filters, protects real users, and never serves test data in production', async () => {
  const original = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'preview';
  const req = (query) =>
    GET(new Request(`https://preview.test/api/analytics/v2?${query}`));
  assert.equal((await req('cohort=wrong')).status, 400);
  assert.equal((await req('period=week')).status, 400);
  assert.equal((await req('view=users')).status, 403);
  const aggregate = await (
    await req('dataset=test&cohort=phase-0&period=7d')
  ).json();
  assert.equal(aggregate.mode, 'test');
  assert.equal(aggregate.cohort, 'phase-0');
  assert.deepEqual(aggregate.users, []);
  const users = await (await req('dataset=test&view=users')).json();
  assert.equal(users.users.length, 10);
  assert.ok(
    users.users.every(
      (u) => !('email' in u) && !('phone' in u) && !('name' in u),
    ),
  );
  process.env.VERCEL_ENV = 'production';
  assert.equal((await req('dataset=test')).status, 503);
  delete process.env.VERCEL_ENV;
  delete process.env.CONTROL_V2_LOCAL_TEST;
  assert.equal((await req('dataset=test')).status, 403);
  if (original) process.env.VERCEL_ENV = original;
});
test('missing cohort manifest never falls back to project-wide Phase0 values', async () => {
  delete process.env.CONTROL_V2_COHORTS_JSON;
  const response = await GET(
    new Request('https://preview.test/api/analytics/v2'),
  );
  const data = await response.json();
  assert.equal(data.state, 'not-connected');
  assert.equal(data.metrics.active.value, null);
  assert.equal(data.metrics.active.state, 'not-connected');
});
test('preview storage cannot fall back to production URL', async () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.TURSO_DATABASE_URL = 'file:never-open-production.db';
  process.env.V2_TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
  process.env.SPARKEEFY_PUBLIC_READONLY = 'true';
  process.env.SPARKEEFY_DATABASE_IMPORTED = 'true';
  const result = await GET(new Request('https://preview.test/api/tracker'));
  assert.equal(result.status, 503);
  delete process.env.VERCEL_ENV;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.V2_TURSO_DATABASE_URL;
});

// Use an in-repository temp bundle so @libsql/client is resolvable without production credentials.
test('live adapter query is allowlisted, identities are pseudonymized and schema errors fail closed', async () => {
  const out = `tests/.tmp-v2-source-${randomUUID()}.mjs`;
  await build({
    entryPoints: ['lib/analytics-v2/source.ts'],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    alias: { '@': './' },
  });
  const { liveDataset, readMembership } = await import(`../${out}`);
  const member = {
    id: 'secret-email@example.test',
    distinctIds: ['raw-id'],
    cohort: 'phase-0',
    from: '2026-01-01T00:00:00Z',
    firstOpen: '2026-01-01T00:00:00Z',
    internal: false,
    test: false,
    acquisition: 'organic',
  };
  assert.throws(() => readMembership(JSON.stringify([member, member])));
  assert.throws(() =>
    readMembership(JSON.stringify([{ ...member, internal: undefined }])),
  );
  const closed = { ...member, to: '2026-02-01T00:00:00Z' };
  assert.equal(
    readMembership(
      JSON.stringify([
        closed,
        { ...member, cohort: 'phase-1a', from: closed.to },
      ]),
    ).length,
    2,
  );
  process.env.CONTROL_V2_COHORTS_JSON = JSON.stringify([member]);
  process.env.CONTROL_V2_COVERAGE_FROM = member.from;
  process.env.POSTHOG_HOST = 'https://us.posthog.com';
  process.env.POSTHOG_PROJECT_ID = 'test';
  process.env.POSTHOG_API_KEY = 'test-only';
  process.env.SPARKEEFY_SESSION_SECRET = randomUUID();
  const fetchOriginal = globalThis.fetch;
  let query = '';
  globalThis.fetch = async (_url, options) => {
    query = JSON.parse(options.body).query.query;
    return Response.json({
      results: [
        [
          'event-id',
          'raw-id',
          'response_started',
          '2026-01-03T00:00:00Z',
          'request-id',
          null,
          null,
          null,
          null,
          false,
          false,
          'production',
        ],
        [
          'excluded',
          'raw-id',
          'response_started',
          '2026-01-03T01:00:00Z',
          'test-id',
          null,
          null,
          null,
          null,
          false,
          true,
          'production',
        ],
      ],
    });
  };
  try {
    const data = await liveDataset();
    assert.equal(data.state, 'available');
    assert.equal(data.facts.length, 1);
    assert.match(data.members[0].id, /^participant-[a-f0-9]{16}$/);
    assert.ok(!JSON.stringify(data).includes('secret-email'));
    assert.ok(!/SELECT \*|person\.properties|properties\.email/i.test(query));
    assert.match(query, /request_id/);
    assert.match(query, /LIMIT 50001/);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const key of [
      'POSTHOG_HOST',
      'POSTHOG_PROJECT_ID',
      'POSTHOG_API_KEY',
      'CONTROL_V2_COHORTS_JSON',
      'CONTROL_V2_COVERAGE_FROM',
      'SPARKEEFY_SESSION_SECRET',
    ])
      delete process.env[key];
  }
});
