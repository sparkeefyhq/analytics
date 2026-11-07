import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAUNCH_AT, SETTLE_MS, compareFrom, compareTruth, truthFrom, type TruthAccount, type TruthRaw } from '../server/truth';
import type { RosterUser } from '../server/types';

// 7 Nov (Rahul): the dashboard checked against the production database, person by person, launch onwards.

const NOW = Date.parse('2026-11-07T13:00:00Z');
const A = '7b1ea2e0-0000-4000-8000-000000000001';
const B = '6b7578b9-0000-4000-8000-000000000002';
const TEAM = 'ce0647db-0000-4000-8000-000000000003';
const GONE = '0da1c07f-0000-4000-8000-000000000004';
const cfg = { excludedIds: new Set<string>() };

function account(id: string, p: Partial<TruthAccount> = {}): TruthAccount {
  return {
    id, name: null, signupAt: '2026-11-06T16:40:00Z', newSinceFrom: true,
    overlay: { drafts: 0, copied: 0, inserted: 0, sent: { asIs: 0, edited: 0, own: 0 } },
    app: { turns: 0 }, internalTraffic: false, testTraffic: false,
    ...p,
  };
}

function user(id: string, p: { drafts?: number; asIs?: number; own?: number; inserted?: number; messages?: number | null; returning?: boolean; team?: boolean } = {}): RosterUser {
  return {
    id, name: null, team: p.team ?? false, returning: p.returning ?? false, signupAt: '2026-11-06T16:40:00Z', version: null, lastActive: null, activeDays: 0, days: [],
    journey: { firstOpen: '', setupAt: null, firstDraftAt: null, firstActAt: null, repeatAt: null, repeat: 'na', lastScreen: null, screens: 0, permissions: [] },
    overlay: {
      sessions: 0, drafts: p.drafts ?? 0, delivered: 0, failed: 0, copied: 0, inserted: p.inserted ?? 0, sent: { asIs: p.asIs ?? 0, edited: 0, own: p.own ?? 0 },
      firstTryPct: null, usedPct: null, medianLatency: null, cost: 0, apps: [], moods: [], relationships: [],
    },
    app: { replies: 0, cost: 0, messages: p.messages === undefined ? 0 : p.messages, answered: null, safety: null, failed: null },
    quota: { month: '2026-11', drafts: 0, draftCap: 100, answers: 0, answerCap: 40 },
    flags: [],
  } as RosterUser;
}

const raw = (accounts: TruthAccount[]): TruthRaw => ({ generatedAt: new Date(NOW).toISOString(), from: LAUNCH_AT, accounts });
const drafts = (n: number, own = 0, inserted = 0) => ({ drafts: n, copied: 0, inserted, sent: { asIs: 0, edited: 0, own } });

test('the check never looks before the official launch', () => {
  assert.equal(truthFrom({ countFrom: null }), LAUNCH_AT);
  assert.equal(truthFrom({ countFrom: '2026-09-11T00:00:00Z' }), LAUNCH_AT);
  assert.equal(truthFrom({ countFrom: '2026-11-07T00:00:00Z' }), '2026-11-07T00:00:00.000Z');
});

test('the compared window starts at the Postgres ledger when that is later than launch', () => {
  // 7 Nov: overlay rows before 6 Nov 16:26 IST exist only in PostHog; the database cannot check them.
  assert.equal(compareFrom({ countFrom: null }, '2026-11-06T10:56:07.580Z'), '2026-11-06T10:56:07.580Z');
  assert.equal(compareFrom({ countFrom: null }, '2026-11-01T00:00:00Z'), LAUNCH_AT);
  assert.equal(compareFrom({ countFrom: null }, null), LAUNCH_AT);
});

test('matching dashboard and database is ok (team accounts included on both sides)', () => {
  const db = raw([account(A, { overlay: drafts(20, 2, 2), app: { turns: 2 } }), account(B), account(TEAM, { overlay: drafts(90), internalTraffic: true })]);
  const roster = [user(A, { drafts: 20, own: 2, inserted: 2, messages: 2 }), user(B), user(TEAM, { team: true, drafts: 90 })];
  assert.deepEqual(compareTruth(roster, db, cfg, new Map(), NOW), { status: 'ok', diffs: [] });
});

test('a missing person or a wrong count is named, and only called a mismatch once it stays', () => {
  const db = raw([account(A, { overlay: drafts(8, 1) }), account(GONE)]);
  const roster = [user(A, { drafts: 7, own: 1 })];
  const seen = new Map<string, number>();
  assert.equal(compareTruth(roster, db, cfg, seen, NOW).status, 'settling');
  const later = compareTruth(roster, db, cfg, seen, NOW + SETTLE_MS);
  assert.equal(later.status, 'mismatch');
  assert.deepEqual(
    later.diffs.map((d) => [d.user, d.field, d.dashboard, d.database]).sort(),
    [[A, 'overlay drafts', 7, 8], [GONE, 'on the dashboard', 'missing', 'signed up']].sort(),
  );
  // Fixed on the next read: back to ok and forgotten.
  assert.equal(compareTruth([user(A, { drafts: 8, own: 1 }), user(GONE)], db, cfg, seen, NOW + 2 * SETTLE_MS).status, 'ok');
  assert.equal(seen.size, 0);
});

test('someone shown that the database lacks, and new vs returning disagreements, are differences', () => {
  const r = compareTruth([user(A), user(B)], raw([account(A, { newSinceFrom: false })]), cfg, new Map(), NOW);
  assert.deepEqual(r.diffs.map((d) => [d.user, d.field]).sort(), [[A, 'new signup'], [B, 'in the database']].sort());
});

test('excluded and test-traffic accounts are never people; in-app messages compare only when the dashboard has them', () => {
  const db = raw([account(A, { testTraffic: true }), account(GONE), account(B, { app: { turns: 3 } })]);
  const r = compareTruth([user(B, { messages: null })], db, { excludedIds: new Set([GONE]) }, new Map(), NOW);
  assert.equal(r.status, 'ok');
});
