import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { canSeeConversations, canSeeOverlayChats } from '../server/auth';
import { hiddenUserIds, isHiddenUser } from '../server/overlay-chats';
import { assemble } from '../server/dataset';
import { ledgerError, refreshLedger, resetLedger } from '../server/ledger';
import { computeSnapshot } from '../server/metrics';
import { csvCell } from '../src/format';

// 7 Nov: fixes from Sarthak's pilot analytics audit (CSV formulas, conversation access,
// ledger paging that never finishes, failed refreshes shown as live).

const cfg = {
  posthogHost: '', posthogProjectId: '', posthogApiKey: '', posthogProjectApiKey: '', posthogIngestHost: '',
  backendUrl: 'https://backend.test', backendAdminKey: 'k', overlayChatsDbUrl: '', teamIds: new Set<string>(), excludedIds: new Set<string>(),
  infraMonthlyUsd: 0, revenueMonthlyUsd: 0, costTargetPerMau: 0.4, onboardingBenchmark: 45, latencySlaMs: 3000, failureSlaPct: 3,
  dataStart: '2026-09-11', countFrom: '',
};
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.CONTROL_CONVERSATION_EMAILS;
  resetLedger();
});

test('CSV cells that would run as a formula are neutralised; numbers stay numbers', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+91 98'), "'+91 98");
  assert.equal(csvCell('-cmd'), "'-cmd");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell('Asha'), 'Asha');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell(null), '');
});

test('conversation access: unset = every member, set = only the named emails', () => {
  assert.equal(canSeeConversations('anyone@x.com'), true);
  process.env.CONTROL_CONVERSATION_EMAILS = 'Founder@x.com, lead@x.com';
  assert.equal(canSeeConversations('founder@x.com'), true);
  assert.equal(canSeeConversations(' LEAD@x.com '), true);
  assert.equal(canSeeConversations('team@x.com'), false);
});

test('overlay chat reader is founder-only: unset = founder default, never the team', () => {
  delete process.env.CONTROL_FOUNDER_EMAILS;
  // Unset still locks it to the founder default — NOT every signed-in member.
  assert.equal(canSeeOverlayChats('sarthakverma0802@gmail.com'), true);
  assert.equal(canSeeOverlayChats('rahulpandey.creates@gmail.com'), false);
  assert.equal(canSeeOverlayChats('anyone@x.com'), false);
  // Explicit override replaces the default set.
  process.env.CONTROL_FOUNDER_EMAILS = 'Boss@x.com';
  assert.equal(canSeeOverlayChats(' boss@x.com '), true);
  assert.equal(canSeeOverlayChats('sarthakverma0802@gmail.com'), false);
  delete process.env.CONTROL_FOUNDER_EMAILS;
});

test('overlay chat reader never lists or opens Rahul\'s accounts', () => {
  assert.equal(isHiddenUser('ce0647db-f294-4d17-b7b0-70063e168fcf'), true);
  assert.equal(isHiddenUser('6101E2C4-B20C-42A0-8D80-C1B0CC81860C'), true);
  assert.equal(isHiddenUser('ab6e72de-be98-4f45-8d57-7b8c92ce3af4'), false);
  assert.deepEqual(hiddenUserIds('x1, X2').slice(2), ['x1', 'x2']);
});

const page = (until: string, more: boolean) => ({
  data: { until, more, columns: { overlay: ['id'], funnel: ['id'], links: [] }, overlay: [], funnel: [], links: [] },
});

test('ledger: a page that does not move the cursor stops with an error instead of repeating', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json(page('1970-01-01T00:00:00.000Z', true));
  }) as typeof fetch;
  const result = await refreshLedger(cfg);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /did not advance/);
  assert.equal(calls, 1);
  assert.match(ledgerError() ?? '', /did not advance/);
});

test('ledger: still more pages after the cap is reported as partial, not up to date', async () => {
  let n = 0;
  globalThis.fetch = (async () => {
    n += 1;
    return Response.json(page(new Date(Date.parse('2026-11-06T00:00:00Z') + n * 1000).toISOString(), true));
  }) as typeof fetch;
  const result = await refreshLedger(cfg);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /partially read/);
});

test('ledger: a complete read clears the earlier error', async () => {
  globalThis.fetch = (async () => Response.json(page('1970-01-01T00:00:00.000Z', true))) as typeof fetch;
  await refreshLedger(cfg);
  globalThis.fetch = (async () => Response.json(page('2026-11-06T00:00:00.000Z', false))) as typeof fetch;
  const result = await refreshLedger(cfg);
  assert.equal(result.ok, true);
  assert.equal(ledgerError(), null);
});

test('a failed backend or ledger refresh marks the snapshot stale (never "live")', () => {
  const NOW = Date.parse('2026-11-07T12:00:00Z');
  const backend = { members: [], facts: [], overlay: [] };
  const raw = { overlay: [], sessions: [], activity: [], steps: [] };
  const base = { posthogAt: new Date(NOW).toISOString(), backendAt: new Date(NOW).toISOString(), error: null, ledgerFrom: null };
  const filters = { range: '7d', surface: 'combined', audience: 'external', version: 'all' } as const;
  const ok = computeSnapshot(assemble(cfg, '2026-09-11', backend, raw, base), filters, cfg, NOW);
  assert.equal(ok.stale, false);
  assert.equal(ok.sources.backend, 'live');
  const down = computeSnapshot(assemble(cfg, '2026-09-11', backend, raw, { ...base, backendError: 'summary 503' }), filters, cfg, NOW);
  assert.equal(down.stale, true);
  assert.equal(down.sources.backend, 'stale');
  const partial = computeSnapshot(assemble(cfg, '2026-09-11', backend, raw, { ...base, ledgerError: 'ledger partially read' }), filters, cfg, NOW);
  assert.equal(partial.stale, true);
  assert.equal(partial.sources.backend, 'stale');
});
