import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const dir = mkdtempSync(`${tmpdir()}/v2-api-`);
await build({
  entryPoints: ['app/api/analytics/v2/route.ts'],
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
  assert.equal(users.users.length, 7);
  assert.ok(
    users.users.every(
      (u) => !('email' in u) && !('phone' in u) && !('name' in u),
    ),
  );
  // Synthetic data is never served outside preview/local test — including production.
  process.env.VERCEL_ENV = 'production';
  assert.equal((await req('dataset=test')).status, 403);
  delete process.env.VERCEL_ENV;
  delete process.env.CONTROL_V2_LOCAL_TEST;
  assert.equal((await req('dataset=test')).status, 403);
  if (original) process.env.VERCEL_ENV = original;
});
test('live v2 without a backend connection is not-connected, never a fabricated zero', async () => {
  delete process.env.V2_SPARKEEFY_BACKEND_URL;
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

async function importFreshBackendAdapter() {
  const out = `tests/.tmp-v2-source-backend-${randomUUID()}.mjs`;
  await build({
    entryPoints: ['lib/analytics-v2/source-backend.ts'],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    alias: { '@': './' },
  });
  return import(`../${out}`);
}

test('backend adapter is not-connected without V2_SPARKEEFY_BACKEND_URL/KEY, never falls back to another source', async () => {
  const { liveDatasetFromBackend } = await importFreshBackendAdapter();
  const disconnected = await liveDatasetFromBackend();
  assert.equal(disconnected.state, 'not-connected');
  assert.equal(disconnected.facts.length, 0);
});

test('backend adapter keeps display names out of the dataset, exposes them separately, and gates tokens/cost on complete usage coverage', async () => {
  const { liveDatasetFromBackend, backendDisplayNames } = await importFreshBackendAdapter();
  process.env.V2_SPARKEEFY_BACKEND_URL = 'https://backend.test';
  process.env.V2_SPARKEEFY_BACKEND_ADMIN_KEY = 'super-secret-admin-key';
  process.env.SPARKEEFY_SESSION_SECRET = randomUUID();
  const fetchOriginal = globalThis.fetch;
  let payload;
  globalThis.fetch = async () => Response.json({ data: payload });
  const member = (id, name) => ({ id, firstOpen: '2026-01-01T00:00:00Z', name });
  const usage = (extra) => ({ user: 'u-1', at: '2026-01-02T00:00:00Z', kind: 'usage', request: 'req-1', input: 10, output: 5, ...extra });
  try {
    payload = {
      generatedAt: '2026-03-03T00:00:00Z',
      capabilities: ['activity', 'onboarding', 'tokens', 'cost'],
      members: [member('u-1', 'Real Person Name'), member('u-2', '   '), member('u-3', null)],
      facts: [usage({ cost: 0.00001 })],
    };
    const data = await liveDatasetFromBackend();
    assert.equal(data.state, 'available');
    assert.ok(!JSON.stringify(data).includes('Real Person Name'));
    assert.ok(!JSON.stringify(data).includes('u-1'));
    const names = backendDisplayNames();
    assert.equal(names.size, 1);
    assert.equal(names.get(data.members[0].id), 'Real Person Name');
    assert.ok(data.capabilities.includes('tokens'));
    assert.ok(data.capabilities.includes('cost'));
    assert.equal(data.facts[0].cost, 0.00001);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  // Fresh module instance so the 30-second cache does not mask the second payload.
  const second = await importFreshBackendAdapter();
  globalThis.fetch = async () => Response.json({ data: payload });
  try {
    payload = {
      generatedAt: '2026-03-03T00:00:00Z',
      capabilities: ['activity', 'tokens', 'cost'],
      members: [member('u-1', 'Real Person Name')],
      facts: [usage({ cost: 0.00001 }), usage({ request: 'req-2' })],
    };
    const data = await second.liveDatasetFromBackend();
    assert.ok(data.capabilities.includes('tokens'));
    assert.ok(!data.capabilities.includes('cost'), 'one unpriced usage record must disable cost');
    payload = { ...payload, facts: [usage({ output: undefined })] };
    const third = await importFreshBackendAdapter();
    const partial = await third.liveDatasetFromBackend();
    assert.ok(!partial.capabilities.includes('tokens'));
    assert.ok(!partial.capabilities.includes('cost'));
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const key of ['V2_SPARKEEFY_BACKEND_URL', 'V2_SPARKEEFY_BACKEND_ADMIN_KEY', 'SPARKEEFY_SESSION_SECRET'])
      delete process.env[key];
  }
});

test('backend adapter auto-includes every real signup, assigns cohort by date, and never leaks the raw backend URL/key', async () => {
  const { liveDatasetFromBackend } = await importFreshBackendAdapter();
  process.env.V2_SPARKEEFY_BACKEND_URL = 'https://backend.test';
  process.env.V2_SPARKEEFY_BACKEND_ADMIN_KEY = 'super-secret-admin-key';
  process.env.CONTROL_V2_INTERNAL_USER_IDS = 'internal-user-id';
  process.env.CONTROL_V2_PHASE1_FROM = '2026-02-01T00:00:00Z';
  process.env.SPARKEEFY_SESSION_SECRET = randomUUID();
  const fetchOriginal = globalThis.fetch;
  let sawHeaderKey = null;
  globalThis.fetch = async (url, options) => {
    sawHeaderKey = options.headers['x-admin-api-key'];
    assert.equal(url, 'https://backend.test/api/admin/analytics/v2');
    return Response.json({
      data: {
        generatedAt: '2026-03-03T00:00:00Z',
        capabilities: ['activity', 'onboarding', 'people', 'memory', 'wingman', 'responses'],
        // No manifest supplied - every real signup is included automatically.
        members: [
          { id: 'real-backend-user-id', firstOpen: '2026-01-01T00:00:00Z' },
          { id: 'internal-user-id', firstOpen: '2026-01-01T00:00:00Z' },
          { id: 'later-signup-id', firstOpen: '2026-02-15T00:00:00Z' },
        ],
        facts: [
          { user: 'real-backend-user-id', at: '2026-01-03T00:00:00Z', kind: 'message', request: 'req-1', session: 'sess-1' },
          { user: 'real-backend-user-id', at: '2026-01-03T00:00:01Z', kind: 'complete', request: 'req-1', latency: 500, input: 10, output: 5 },
          { user: 'internal-user-id', at: '2026-01-03T00:00:00Z', kind: 'message', request: 'req-internal' },
        ],
      },
    });
  };
  try {
    const data = await liveDatasetFromBackend();
    assert.equal(data.state, 'available');
    assert.equal(sawHeaderKey, 'super-secret-admin-key');
    // All 3 real signups appear as members - none dropped, none invented.
    assert.equal(data.members.length, 3);
    // Cohort is purely date-derived: before CONTROL_V2_PHASE1_FROM -> phase-0, after -> phase-1a.
    const earlySignup = data.members.find((m) => m.firstOpen === '2026-01-01T00:00:00.000Z');
    const laterSignup = data.members.find((m) => m.firstOpen === '2026-02-15T00:00:00.000Z');
    assert.equal(earlySignup.cohort, 'phase-0');
    assert.equal(laterSignup.cohort, 'phase-1a');
    // Coverage boundary is computed live from the earliest real signup, not a manually-set env var.
    assert.equal(data.coverageFrom, '2026-01-01T00:00:00.000Z');
    // Internal user is marked internal and excluded from facts, but still counted as a real member.
    const internalMember = data.members.find((m) => m.internal);
    assert.ok(internalMember);
    assert.equal(data.facts.length, 2);
    assert.ok(data.facts.every((f) => /^participant-[a-f0-9]{16}$/.test(f.user)));
    assert.match(data.members[0].id, /^participant-[a-f0-9]{16}$/);
    // Raw request/session ids must never appear verbatim - only their per-user HMAC digests.
    assert.ok(!JSON.stringify(data).includes('req-1'));
    assert.ok(!JSON.stringify(data).includes('sess-1'));
    assert.ok(!JSON.stringify(data).includes('req-internal'));
    assert.ok(!JSON.stringify(data).includes('super-secret-admin-key'));
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const key of [
      'V2_SPARKEEFY_BACKEND_URL',
      'V2_SPARKEEFY_BACKEND_ADMIN_KEY',
      'CONTROL_V2_INTERNAL_USER_IDS',
      'CONTROL_V2_PHASE1_FROM',
      'CONTROL_V2_COVERAGE_FROM',
      'SPARKEEFY_SESSION_SECRET',
    ])
      delete process.env[key];
  }
});
