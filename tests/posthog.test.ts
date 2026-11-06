import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hogql, isRateLimit } from '../server/posthog';

// 6 Nov: one slow PostHog query must not blank the dashboard for 5 minutes.
const cfg = { posthogApiKey: 'k', posthogHost: 'https://ph', posthogProjectId: '1' } as never;
const ok = () => new Response(JSON.stringify({ columns: ['n'], results: [[1]] }));

test('a slow or failed query is tried once more', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    return ok();
  }) as typeof fetch;
  assert.deepEqual(await hogql(cfg, 'SELECT 1'), [{ n: 1 }]);
  assert.equal(calls, 2);
});

test('a rate limit is not retried, and is told apart from a timeout', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('throttled', { status: 429 });
  }) as typeof fetch;
  await assert.rejects(hogql(cfg, 'SELECT 1'), (e: Error) => isRateLimit(e));
  assert.equal(calls, 1);
  assert.equal(isRateLimit(new Error('The operation was aborted due to timeout')), false);
});
