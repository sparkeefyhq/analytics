import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeLive, filterLive, summarizeLive, type LiveRow } from '../server/live';

const REAL = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEAM = 'aaaaaaaa-0000-4000-8000-000000000002';
const GONE = 'aaaaaaaa-0000-4000-8000-000000000003';
const cfg = { teamIds: new Set([TEAM]), excludedIds: new Set([GONE]), countFrom: '2026-11-05T20:48:16Z' };
const row = (id: string, user: string, at: string, extra: Partial<LiveRow> = {}): LiveRow => ({ id, kind: 'chat_message', user, at, ...extra });

test('live feed: same people rules as the dashboard', () => {
  const rows = [
    row('1', REAL, '2026-11-06T09:00:00Z'),
    row('2', TEAM, '2026-11-06T09:00:01Z'),
    row('3', GONE, '2026-11-06T09:00:02Z'),
    row('4', REAL, '2026-11-05T20:00:00Z'), // before COUNT_FROM
    row('5', REAL.toUpperCase(), '2026-11-06T09:00:03Z'),
  ];
  assert.deepEqual(filterLive(rows, cfg, 'external').map((r) => r.id), ['1', '5']);
  assert.deepEqual(filterLive(rows, cfg, 'internal').map((r) => r.id), ['2']);
});

test('live feed: plain words, no duplicate for a successful overlay call', () => {
  const at = '2026-11-06T09:00:00Z';
  assert.equal(describeLive(row('a', REAL, at, { kind: 'overlay_call' })), null);
  assert.equal(describeLive(row('b', REAL, at, { kind: 'overlay_sent', outcome: 'as_is', app: 'com.whatsapp' }))?.text, "sent Keefie's reply as-is in WhatsApp");
  assert.equal(describeLive(row('c', REAL, at, { kind: 'overlay_draft', status: 'needs_target', app: 'com.instagram.android' }))?.tone, 'bad');
  assert.equal(describeLive(row('d', REAL, at, { kind: 'overlay_draft', status: 'ok', latency: 1420, app: 'com.whatsapp' }))?.text, 'got an overlay draft in WhatsApp · 1.4 s');
  assert.equal(describeLive(row('e', REAL, at, { kind: 'overlay_copied', option: 2 }))?.text, 'copied option 2');
  assert.equal(describeLive(row('f', REAL, at, { kind: 'chat_reply', latency: 1600 }))?.text, 'got a Wingman reply · 1.6 s');
});

test('live feed for one person: only their rows, team or not, still never excluded or pre-launch', () => {
  const rows = [
    row('1', REAL, '2026-11-06T09:00:00Z'),
    row('2', TEAM, '2026-11-06T09:00:01Z'),
    row('3', GONE, '2026-11-06T09:00:02Z'),
    row('4', REAL, '2026-11-05T20:00:00Z'),
  ];
  assert.deepEqual(filterLive(rows, cfg, 'external', REAL).map((r) => r.id), ['1']);
  assert.deepEqual(filterLive(rows, cfg, 'external', TEAM).map((r) => r.id), ['2']);
  assert.deepEqual(filterLive(rows, cfg, 'external', GONE).map((r) => r.id), []);
});

test("one person's summary says what they did", () => {
  const at = '2026-11-06T09:00:00Z';
  const s = summarizeLive([
    row('a', REAL, at, { kind: 'overlay_draft', status: 'ok', mood: 'playful' }),
    row('b', REAL, at, { kind: 'overlay_draft', status: 'needs_target' }),
    row('c', REAL, at, { kind: 'overlay_refine', mood: 'playful' }),
    row('d', REAL, at, { kind: 'overlay_inserted' }),
    row('e', REAL, at, { kind: 'overlay_sent', outcome: 'as_is' }),
    row('f', REAL, at, { kind: 'overlay_session', firstTry: false, used: true }),
    row('g', REAL, at, { kind: 'app_event', event: 'chat_turn', outcome: 'safety' }),
    row('h', REAL, at, { kind: 'app_event', event: 'chat_turn', outcome: 'answered' }),
    row('i', REAL, at, { kind: 'chat_message' }),
  ]);
  assert.deepEqual(s, { drafts: 1, noReply: 1, changes: 1, used: 1, sentAsIs: 1, sessions: 1, firstTry: 0, messages: 2, safety: 1, topMood: 'playful' });
});
