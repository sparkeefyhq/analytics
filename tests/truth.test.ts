import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SETTLE_MS, compareTruth, type TruthAccount, type TruthRaw } from '../server/truth';
import type { RosterUser } from '../server/types';

// 7 Nov (Rahul): the dashboard checked against the production database, person by person.

const NOW = Date.parse('2026-11-07T13:00:00Z');
const FROM = '2026-11-05T20:48:16.000Z';
const A = '7b1ea2e0-0000-4000-8000-000000000001';
const B = '6b7578b9-0000-4000-8000-000000000002';
const TEAM = 'ce0647db-0000-4000-8000-000000000003';
const GONE = '0da1c07f-0000-4000-8000-000000000004';
const cfg = { teamIds: new Set([TEAM]), excludedIds: new Set<string>() };

function account(id: string, p: Partial<TruthAccount> = {}): TruthAccount {
  return {
    id, name: id.slice(0, 4), signupAt: '2026-11-06T16:40:00Z', newSinceFrom: true, lastSeenAt: null,
    overlay: { drafts: 0, delivered: 0, failed: 0, notADraft: 0, copied: 0, inserted: 0, sent: { asIs: 0, edited: 0, own: 0 }, sessions: 0 },
    app: { turns: 0, userMessages: 0 }, lastStep: 'home_first_viewed', reachedHome: true, feedback: 0, internalTraffic: false, testTraffic: false,
    ...p,
  };
}

function user(id: string, p: { drafts?: number; asIs?: number; own?: number; messages?: number | null; returning?: boolean; team?: boolean } = {}): RosterUser {
  return {
    id, name: id.slice(0, 4), team: p.team ?? false, returning: p.returning ?? false, signupAt: '2026-11-06T16:40:00Z', version: null, lastActive: null, activeDays: 0, days: [],
    journey: { firstOpen: '', setupAt: null, firstDraftAt: null, firstActAt: null, repeatAt: null, repeat: 'na', lastScreen: null, screens: 0, permissions: [] },
    overlay: {
      sessions: 0, drafts: p.drafts ?? 0, delivered: 0, failed: 0, copied: 0, inserted: 0, sent: { asIs: p.asIs ?? 0, edited: 0, own: p.own ?? 0 },
      firstTryPct: null, usedPct: null, medianLatency: null, cost: 0, apps: [], moods: [], relationships: [],
    },
    app: { replies: 0, cost: 0, messages: p.messages === undefined ? 0 : p.messages, answered: null, safety: null, failed: null },
    quota: { month: '2026-11', drafts: 0, draftCap: 100, answers: 0, answerCap: 40 },
    flags: [],
  } as RosterUser;
}

const raw = (accounts: TruthAccount[], installs: TruthRaw['installs'] = []): TruthRaw => ({ generatedAt: new Date(NOW).toISOString(), from: FROM, accounts, installs, feedback: [] });

test('matching dashboard and database is ok, with real-user totals from the database', () => {
  const db = raw(
    [
      account(A, { overlay: { drafts: 20, delivered: 19, failed: 1, notADraft: 2, copied: 0, inserted: 0, sent: { asIs: 1, edited: 0, own: 2 }, sessions: 18 }, app: { turns: 2, userMessages: 2 } }),
      account(B),
      account(TEAM, { overlay: { drafts: 90, delivered: 90, failed: 0, notADraft: 0, copied: 0, inserted: 0, sent: { asIs: 0, edited: 0, own: 0 }, sessions: 1 } }),
    ],
    [
      { device: 'd1', firstSeen: FROM, lastSeen: FROM, lastStep: 'intro_video', reachedHome: false, account: null, internal: false },
      { device: 'd2', firstSeen: FROM, lastSeen: FROM, lastStep: 'meet_keefie', reachedHome: false, account: null, internal: false },
      { device: 'd3', firstSeen: FROM, lastSeen: FROM, lastStep: 'home_first_viewed', reachedHome: true, account: null, internal: false },
      { device: 'd4', firstSeen: FROM, lastSeen: FROM, lastStep: 'home_first_viewed', reachedHome: true, account: A, internal: false },
      { device: 'd5', firstSeen: FROM, lastSeen: FROM, lastStep: 'home_first_viewed', reachedHome: true, account: TEAM, internal: false },
    ],
  );
  const roster = [user(A, { drafts: 20, asIs: 1, own: 2, messages: 2 }), user(B), user(TEAM, { team: true, drafts: 90 })];
  const r = compareTruth(roster, db, cfg, new Map(), NOW);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.diffs, []);
  assert.equal(r.database?.signups, 2); // team account not counted
  assert.equal(r.database?.installs, 4); // the team phone is not an install
  assert.equal(r.database?.installedNoAccount, 3);
  assert.equal(r.database?.guests, 1);
  assert.deepEqual(r.database?.stoppedAt.map((s) => s.step).sort(), ['intro_video', 'meet_keefie']);
  assert.equal(r.database?.usedOverlay, 1);
  assert.deepEqual(r.database?.signedUpNotUsed.map((u) => u.id), [B]);
  assert.equal(r.database?.drafts, 20);
  assert.equal(r.dashboard?.drafts, 20);
});

test('a missing person or a wrong count is named, and only called a mismatch once it stays', () => {
  const db = raw([account(A, { overlay: { drafts: 8, delivered: 8, failed: 0, notADraft: 0, copied: 0, inserted: 0, sent: { asIs: 0, edited: 0, own: 1 }, sessions: 1 } }), account(GONE)]);
  const roster = [user(A, { drafts: 7, own: 1 })];
  const seen = new Map<string, number>();
  const first = compareTruth(roster, db, cfg, seen, NOW);
  assert.equal(first.status, 'settling');
  const later = compareTruth(roster, db, cfg, seen, NOW + SETTLE_MS);
  assert.equal(later.status, 'mismatch');
  assert.deepEqual(
    later.diffs.map((d) => [d.user, d.field, d.dashboard, d.database]).sort(),
    [[A, 'overlay drafts', 7, 8], [GONE, 'on the dashboard', 'missing', 'signed up']].sort(),
  );
  // Fixed on the next read: back to ok and forgotten.
  const fixed = compareTruth([user(A, { drafts: 8, own: 1 }), user(GONE)], db, cfg, seen, NOW + 2 * SETTLE_MS);
  assert.equal(fixed.status, 'ok');
  assert.equal(seen.size, 0);
});

test('someone on the dashboard the database lacks, and new vs returning disagreements, are differences', () => {
  const db = raw([account(A, { newSinceFrom: false })]);
  const r = compareTruth([user(A), user(B)], db, cfg, new Map(), NOW);
  assert.deepEqual(
    r.diffs.map((d) => [d.user, d.field]).sort(),
    [[A, 'new signup'], [B, 'in the database']].sort(),
  );
});

test('excluded and test-traffic accounts are never people; in-app messages compare only when the dashboard has them', () => {
  const db = raw([account(A, { testTraffic: true }), account(B, { app: { turns: 3, userMessages: 3 } })]);
  const r = compareTruth([user(B, { messages: null })], db, { ...cfg, excludedIds: new Set() }, new Map(), NOW);
  assert.equal(r.status, 'ok');
  assert.equal(r.database?.signups, 1);
});
