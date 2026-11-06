import assert from 'node:assert/strict';
import { test } from 'node:test';

// Every PostHog query the loader sends must pin its times to UTC. A bare toDateTime() is read in the
// project's time zone (IST), which once made the recent query re-count the last 5.5 hours (6 Nov).
test('every PostHog time filter is explicit UTC, history and recent', async () => {
  const sent: string[] = [];
  const real = globalThis.fetch;
  const realNow = Date.now;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/admin/')) return new Response(JSON.stringify({ data: { members: [], facts: [], overlay: [] } }));
    sent.push(JSON.parse(String(init?.body)).query.query as string);
    return new Response(JSON.stringify({ columns: [], results: [] }));
  }) as typeof fetch;
  Object.assign(process.env, { POSTHOG_PERSONAL_API_KEY: 'x', V2_SPARKEEFY_BACKEND_URL: 'http://stub', V2_SPARKEEFY_BACKEND_ADMIN_KEY: 'x', POSTHOG_PROJECT_API_KEY: '' });
  try {
    const { config } = await import('../server/config');
    const { getDataset } = await import('../server/dataset');
    await getDataset(config());
    Date.now = () => realNow() + 61_000;
    await getDataset(config());
  } finally {
    globalThis.fetch = real;
    Date.now = realNow;
  }
  assert.ok(sent.length >= 5, `history + recent queries sent (${sent.length})`);
  for (const q of sent) {
    const calls = q.match(/toDateTime\([^)]*\)/g) ?? [];
    assert.ok(calls.length > 0, 'has a time filter');
    for (const c of calls) assert.match(c, /'UTC'\)$/, `not UTC: ${c}`);
  }
});
