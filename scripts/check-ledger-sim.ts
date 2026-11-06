/**
 * 6 Nov: cross-repo check. Takes the backend load simulation's dump (real /events pages from
 * 1,000 simulated users plus the simulation's ground truth) and rebuilds the dashboard's numbers
 * with this repo's real code (applyPage -> withLedger -> assemble -> computeSnapshot).
 * Usage: npx tsx scripts/check-ledger-sim.ts <dump.json>
 */
import { readFileSync } from 'node:fs';
import { assemble, withLedger } from '../server/dataset';
import { applyPage, ledgerView, resetLedger } from '../server/ledger';
import { computeSnapshot } from '../server/metrics';

const dump = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  userIds: string[]; pages: Parameters<typeof applyPage>[0][];
  truth: { sessions: number; used: number; firstTry: number; onboardingCompleted: number; accessibilityGranted: number; moods: Record<string, number> };
};
const cfg = {
  posthogHost: '', posthogProjectId: '', posthogApiKey: '', posthogProjectApiKey: '', posthogIngestHost: '',
  backendUrl: '', backendAdminKey: '', teamIds: new Set<string>(), excludedIds: new Set<string>(),
  infraMonthlyUsd: 0, revenueMonthlyUsd: 0, costTargetPerMau: 0.4, onboardingBenchmark: 45, latencySlaMs: 3000, failureSlaPct: 3,
  dataStart: '2026-09-11', countFrom: null,
};
const t0 = performance.now();
resetLedger();
for (const page of dump.pages) applyPage(page);
const v = ledgerView();
const raw = withLedger({ overlay: [], sessions: [], activity: [], steps: [] }, v);
const now = Date.now();
const backend = { members: dump.userIds.map((id) => ({ id, firstOpen: new Date(now - 3_600_000).toISOString(), name: null })), facts: [], overlay: [] };
const data = assemble(cfg, '2026-09-11', backend, raw, { posthogAt: null, backendAt: new Date(now).toISOString(), error: null, ledgerFrom: v.funnelFrom });
const snap = computeSnapshot(data, { range: '7d', surface: 'combined', audience: 'external', version: 'all' }, cfg, now);
const ms = Math.round(performance.now() - t0);

const done = (data.onboarding ?? []).filter((s) => s.screen === 'done').length;
const granted = (data.steps ?? []).filter((s) => s.account && s.screen === 'perm:accessibility').length;
const usedRows = data.overlay.filter((e) => e.action === 'copied' || e.action === 'inserted');
const moods: Record<string, number> = {};
for (const e of usedRows) moods[e.mood ?? ''] = (moods[e.mood ?? ''] ?? 0) + 1;
const sortObj = (o: Record<string, number>) => JSON.stringify(Object.entries(o).sort());

const checks: [string, unknown, unknown][] = [
  ['sessions shown a draft (Overlay page)', snap.overlay.firstReply.total, dump.truth.sessions],
  ['first-try use (Overlay page)', snap.overlay.firstReply.used, dump.truth.firstTry],
  ['sessions that used a reply (Overview)', snap.overview.replyUse.used, dump.truth.used],
  ['onboarding reached the last screen (Onboarding)', done, dump.truth.onboardingCompleted],
  ['accessibility granted, joined to the account', granted, dump.truth.accessibilityGranted],
  ['used replies by mood', sortObj(moods), sortObj(dump.truth.moods)],
];
console.log(`dashboard rebuilt ${data.overlay.length} overlay rows, ${data.sessions.length} sessions, ${(data.steps ?? []).length} onboarding steps in ${ms} ms`);
let ok = true;
for (const [name, got, want] of checks) {
  const pass = got === want;
  ok &&= pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${String(got)}${pass ? '' : ` (expected ${String(want)})`}`);
}
if (!ok) process.exit(1);
