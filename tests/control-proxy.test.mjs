import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../api/proxy.js', import.meta.url), 'utf8');
const { default: proxy } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

test('preview proxy isolation and header forwarding', async () => {
  const originalFetch = globalThis.fetch;
  const previous = { ...process.env };
  let calls = 0;
  let forwarded;
  globalThis.fetch = async (url, options) => {
    calls++;
    forwarded = { url, options };
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'content-length': '999', 'set-cookie': 'session=test; HttpOnly; Secure' } });
  };
  const run = async (path = 'api/tracker') => {
    const req = { method: 'GET', url: `/api/proxy?path=${encodeURIComponent(path)}&period=7d`, headers: { host: 'preview.example', cookie: 'session=test', 'oai-sites-authorization': 'untrusted' } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = String(body); } };
    await proxy(req, res);
    return res;
  };
  try {
    process.env.VERCEL_ENV = 'preview';
    delete process.env.SPARKEEFY_BACKEND_ORIGIN;
    assert.equal((await run()).statusCode, 502);
    process.env.SPARKEEFY_BACKEND_ORIGIN = 'https://sparkeefy-launch-control.samarthvm-0302.chatgpt.site';
    assert.equal((await run()).statusCode, 502);
    assert.equal(calls, 0);
    process.env.SPARKEEFY_BACKEND_ORIGIN = 'https://isolated.example';
    process.env.SPARKEEFY_BACKEND_ACCESS_TOKEN = 'server-only-test-token';
    assert.equal((await run('../outside')).statusCode, 400);
    const res = await run();
    assert.equal(res.statusCode, 200);
    assert.equal(String(forwarded.url), 'https://isolated.example/api/tracker?period=7d');
    assert.equal(forwarded.options.headers.get('oai-sites-authorization'), 'Bearer server-only-test-token');
    assert.equal(forwarded.options.headers.get('cookie'), 'session=test');
    assert.equal(res.headers['content-length'], undefined);
    assert.match(String(res.headers['set-cookie']), /HttpOnly/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['VERCEL_ENV', 'SPARKEEFY_BACKEND_ORIGIN', 'SPARKEEFY_BACKEND_ACCESS_TOKEN']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
