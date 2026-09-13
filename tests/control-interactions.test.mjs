import test from 'node:test';
import assert from 'node:assert/strict';
import { countdown, createTrackerQueue } from '../vercel-static/src/control-state.ts';

const initial = () => ({ phases: [{ checks: [{ id: 'a', completed: false }, { id: 'b', completed: false }] }] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('check moves immediately; a slow response preserves a newer click', async () => {
  let shown; const queue = createTrackerQueue(value => { shown = value; }, () => {});
  queue.hydrate(initial());
  const first = deferred(), second = deferred(); let secondStarted = false;
  const one = queue.enqueue('check', { completed: true }, 'a', () => first.promise);
  assert.equal(shown.phases[0].checks[0].completed, true);
  const two = queue.enqueue('check', { completed: true }, 'b', () => { secondStarted = true; return second.promise; });
  assert.equal(secondStarted, false);
  first.resolve({ phases: [{ checks: [{ id: 'a', completed: true }, { id: 'b', completed: false }] }] });
  await one;
  assert.deepEqual(shown.phases[0].checks.map(c => c.completed), [true, true]);
  second.resolve(shown); await two;
});

test('immediate undo survives the original completion response', async () => {
  let shown; const queue = createTrackerQueue(value => { shown = value; }, () => {}); queue.hydrate(initial());
  const first = deferred();
  const one = queue.enqueue('check', { completed: true }, 'a', () => first.promise);
  const undo = queue.enqueue('check', { completed: false }, 'a', async () => initial());
  assert.equal(shown.phases[0].checks[0].completed, false);
  first.resolve({ phases: [{ checks: [{ id: 'a', completed: true }, { id: 'b', completed: false }] }] });
  await one; assert.equal(shown.phases[0].checks[0].completed, false); await undo;
});

test('failed save rolls back and does not poison later saves', async () => {
  let shown; const queue = createTrackerQueue(value => { shown = value; }, () => {}); queue.hydrate(initial());
  await assert.rejects(queue.enqueue('check', { completed: true }, 'a', async () => { throw Error('offline'); }));
  assert.equal(shown.phases[0].checks[0].completed, false);
  const saved = initial(); saved.phases[0].checks[1].completed = true;
  await queue.enqueue('check', { completed: true }, 'b', async () => saved);
  assert.equal(shown.phases[0].checks[1].completed, true);
});

test('countdown uses persisted timestamp and handles deadline, overdue, long format', () => {
  const start = '2026-09-13T00:00:00.000Z', now = Date.parse(start), duration = 3 * 86400000;
  assert.equal(countdown(null, duration, now).display, '72:00:00');
  assert.equal(countdown(start, duration, now + 1000).display, '71:59:59');
  assert.equal(countdown(start, duration, now + 61000).display, '71:58:59');
  assert.equal(countdown(start, duration, now + duration).display, '00:00:00');
  assert.equal(countdown(start, duration, now + duration + 1000).display, '+00:00:01');
  assert.equal(countdown(start, duration, now + 4 * 86400000 + 60000).display, '+1d 00h 01m');
  assert.equal(countdown(start, duration, now + 3600000).display, countdown(start, duration, now + 3600000).display);
});
