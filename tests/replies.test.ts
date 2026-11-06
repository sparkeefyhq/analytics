import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oneReplyPerTurn } from '../server/replies';

test('a repaired Wingman turn counts as one answer (recovery call shares the request id)', () => {
  const out = oneReplyPerTurn([
    { user: 'u1', at: '2026-11-06T17:00:00.000Z', kind: 'complete', request: 't1' },
    { user: 'u1', at: '2026-11-06T17:00:03.000Z', kind: 'complete', request: 't1' },
    { user: 'u1', at: '2026-11-06T17:05:00.000Z', kind: 'complete', request: 't2' },
    { user: 'u1', at: '2026-11-06T17:06:00.000Z', kind: 'failed', request: 't3' },
    { user: 'u1', at: '2026-11-06T17:07:00.000Z', kind: 'usage', request: 't2' },
  ]);
  assert.deepEqual(out, [
    { id: 'u1', at: '2026-11-06T17:00:00.000Z' },
    { id: 'u1', at: '2026-11-06T17:05:00.000Z' },
  ]);
});

test('older backends without request ids keep every completed row', () => {
  const out = oneReplyPerTurn([
    { user: 'u1', at: '2026-11-06T17:00:00.000Z', kind: 'complete' },
    { user: 'u1', at: '2026-11-06T17:00:03.000Z', kind: 'complete' },
  ]);
  assert.equal(out.length, 2);
});

test('same request id for two users stays two answers', () => {
  const out = oneReplyPerTurn([
    { user: 'u1', at: '2026-11-06T17:00:00.000Z', kind: 'complete', request: 'x' },
    { user: 'u2', at: '2026-11-06T17:00:01.000Z', kind: 'complete', request: 'x' },
  ]);
  assert.equal(out.length, 2);
});
