// 16 Nov: the founder overlay chat reader showed raw chat lines from prod. It was removed for
// security. These routes must stay gone: no session, no founder email, nothing reaches chat text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { handle } from '../server/handler';

for (const path of ['/api/overlay-chats/users', '/api/overlay-chats?user=00000000-0000-0000-0000-000000000000']) {
  test(`chat reader route is gone: ${path}`, async () => {
    const res = await handle(new Request(`https://control.test${path}`));
    assert.equal(res.status, 404);
  });
}

test('no code reads prod chats directly', () => {
  assert.equal(existsSync(new URL('../server/overlay-chats.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/pages/FounderChats.tsx', import.meta.url)), false);
  assert.doesNotMatch(readFileSync(new URL('../server/handler.ts', import.meta.url), 'utf8'), /overlay-chats'/);
});
