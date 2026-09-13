// Destructive progression is permitted ONLY in the dedicated synthetic preview.
// Credentials arrive on stdin and are never written to disk or printed.
import assert from 'node:assert/strict';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
const origin = new URL(config.origin);
assert.equal(origin.hostname, 'sparkeefy-control-preview-backend.samarthvm-0302.chatgpt.site');
let cookie = '';
async function request(path, body, expected = 200) {
  const response = await fetch(new URL(path, origin), {
    method: body ? (path.endsWith('/login') ? 'POST' : 'PATCH') : 'GET',
    headers: { 'content-type': 'application/json', 'OAI-Sites-Authorization': `Bearer ${config.accessToken}`, ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual', signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`);
  const appCookie = response.headers.getSetCookie().find(value => value.startsWith('sparkeefy_launch_session='));
  if (appCookie) cookie = appCookie.split(';')[0];
  return response.json();
}
const patch = (action, options = {}, expected = 200) => request('/api/tracker', { action, ...options }, expected);
const get = () => request('/api/tracker');
const phase = (state, id) => state.phases.find(p => p.id === id);
await request('/api/auth/login', { email: 'sarthakverma0802@gmail.com', password: config.password });
let state = await get();
assert.equal(state.canEdit, true);
assert.ok(state.analytics);
assert.equal(state.analytics.source.status, 'available');
assert.equal(state.analytics.users.registered, 1);
assert.equal(state.analytics.users.active, null);
assert.equal(state.analytics.retention.organicSituation, null);
assert.equal(state.analytics.activation.meaningful.numerator, 1);
assert.equal(state.analytics.quality.usefulness.yes, 1);
assert.equal(state.analytics.aiCost, null);
assert.equal(phase(state, 'phase-1').metrics.find(m => m.id === 'phase-1-metric-0').actual, 42);
assert.equal(phase(state, 'phase-1').checks.find(c => c.id === 'phase-1-check-0').completed, true);
console.log('PASS GET, analytics aggregates/source-unavailable, historical metric/check preservation');
await patch('advance', { phaseId: 'phase-1', patch: { confirmed: true } }, 409);
await patch('start', { phaseId: 'phase-1' }, 409);
state = await patch('start', { phaseId: 'phase-0' });
const startedAt = phase(state, 'phase-0').startedAt;
assert.ok(Number.isFinite(Date.parse(startedAt)));
state = await patch('start', { phaseId: 'phase-0' });
assert.equal(phase(state, 'phase-0').startedAt, startedAt);
assert.equal(phase(await get(), 'phase-0').startedAt, startedAt);
await patch('advance', { phaseId: 'phase-0', patch: { confirmed: true } }, 409);
console.log('PASS locked start/advance rejected, active start, timestamp persistence/idempotency, blocked advancement');
const check = phase(state, 'phase-0').checks[0];
await patch('check', { id: check.id, patch: { completed: true } });
assert.equal(phase(await get(), 'phase-0').checks.find(c => c.id === check.id).completed, true);
await patch('check', { id: check.id, patch: { completed: false } });
assert.equal(phase(await get(), 'phase-0').checks.find(c => c.id === check.id).completed, false);
const metric = phase(state, 'phase-0').metrics[0];
await patch('metric', { id: metric.id, patch: { target: metric.target, actual: 82, actualDenominator: 100 } });
assert.equal(phase(await get(), 'phase-0').metrics.find(m => m.id === metric.id).actual, 82);
const gate = state.releaseGates[0];
await patch('release_gate', { id: gate.id, patch: { actual: 1 } });
assert.equal((await get()).releaseGates.find(g => g.id === gate.id).actual, 1);
await patch('release_gate', { id: gate.id, patch: { actual: 'invalid' } }, 400);
assert.equal((await get()).releaseGates.find(g => g.id === gate.id).actual, 1);
console.log('PASS checklist persistence/undo, metric evidence, hard-zero persistence and invalid evidence rejected');
for (const metric of phase(state, 'phase-0').metrics)
  await patch('metric', { id: metric.id, patch: { target: metric.target, actual: 100, actualDenominator: 100 } });
for (const check of phase(state, 'phase-0').checks)
  await patch('check', { id: check.id, patch: { completed: true } });
const blocked = await patch('advance', { phaseId: 'phase-0', patch: { confirmed: true } }, 409);
assert.ok(blocked.unmet.includes(`${gate.name} must be zero`));
assert.equal(blocked.unmet.length, 1);
await patch('release_gate', { id: gate.id, patch: { actual: 0 } });
state = await patch('advance', { phaseId: 'phase-0', patch: { confirmed: true } });
assert.equal(phase(state, 'phase-0').status, 'complete');
assert.equal(phase(state, 'phase-0').startedAt, startedAt);
assert.equal(phase(state, 'phase-1').status, 'ready');
assert.equal(phase(state, 'phase-1').startedAt, null);
await patch('advance', { phaseId: 'phase-1', patch: { confirmed: true } }, 409);
await patch('advance', { phaseId: 'phase-0', patch: { confirmed: true } }, 409);
assert.equal(phase(await get(), 'phase-1').status, 'ready');
console.log('PASS release gate independently blocks, valid advancement, next phase Ready/not Active, refresh persistence, replay rejected');
