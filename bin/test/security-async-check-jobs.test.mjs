import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_STATES, admitJob, transitionJob } from '../../lib/security-async-check-jobs.mjs';

const T = '2026-01-01T00:00:00Z';
const state = (over = {}) => ({ id: 'job-1', state: 'queued', reason: null, evidence: null, updatedAt: null, ...over });
const event = (type, over = {}) => ({ type, at: T, ...over });
const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
};

test('JOB_STATES is frozen and names every state the functions can return', () => {
  assert.ok(Object.isFrozen(JOB_STATES));
  assert.deepEqual([...JOB_STATES], ['queued', 'running', 'succeeded', 'failed', 'cancelled']);
  const reached = new Set([
    admitJob({ jobs: [], limit: 1, id: 'q' }).state,
    transitionJob(state(), event('start')).state,
    transitionJob(state({ state: 'running' }), event('succeed', { evidence: { ok: true } })).state,
    transitionJob(state({ state: 'running' }), event('timeout', { reason: 'deadline' })).state,
    transitionJob(state(), event('cancel')).state,
  ]);
  assert.deepEqual([...reached].sort(), [...JOB_STATES].sort());
});

test('admission returns a new queued job with no measured reason or evidence', () => {
  assert.deepEqual(admitJob({ jobs: [], limit: 1, id: 'job-1' }), {
    id: 'job-1',
    state: 'queued',
    reason: null,
    evidence: null,
    updatedAt: null,
  });
});

test('start moves a queued job to running and records the supplied instant', () => {
  const before = state();
  const after = transitionJob(before, event('start'));
  assert.deepEqual(after, { id: 'job-1', state: 'running', reason: null, evidence: null, updatedAt: T });
  assert.notEqual(after, before);
});

test('succeed requires explicit successful evidence and records it', () => {
  const after = transitionJob(state({ state: 'running' }), event('succeed', { evidence: { ok: true } }));
  assert.deepEqual(after, {
    id: 'job-1',
    state: 'succeeded',
    reason: null,
    evidence: { ok: true },
    updatedAt: T,
  });
});

test('succeed without ok:true evidence is refused, never inferred', () => {
  assert.throws(() => transitionJob(state({ state: 'running' }), event('succeed')), /event\.evidence\.ok/);
  assert.throws(() => transitionJob(state({ state: 'running' }), event('succeed', { evidence: { ok: false } })), /event\.evidence\.ok/);
  assert.throws(() => transitionJob(state({ state: 'running' }), event('succeed', { evidence: { ok: 'yes' } })), /event\.evidence\.ok/);
});

test('failure is a failed state that preserves its reason', () => {
  const after = transitionJob(state({ state: 'running' }), event('fail', { reason: 'scanner error' }));
  assert.deepEqual(after, {
    id: 'job-1',
    state: 'failed',
    reason: 'scanner error',
    evidence: null,
    updatedAt: T,
  });
});

test('timeout becomes failed with its reason and can never become success', () => {
  const failed = transitionJob(state({ state: 'running' }), event('timeout', { reason: 'deadline exceeded' }));
  assert.equal(failed.state, 'failed');
  assert.equal(failed.reason, 'deadline exceeded');
  assert.throws(
    () => transitionJob(failed, event('succeed', { evidence: { ok: true } })),
    /terminal state: failed/,
  );
});

test('cancel moves a queued or running job to cancelled', () => {
  const fromQueued = transitionJob(state(), event('cancel'));
  const fromRunning = transitionJob(state({ state: 'running' }), event('cancel'));
  assert.equal(fromQueued.state, 'cancelled');
  assert.equal(fromRunning.state, 'cancelled');
  assert.equal(fromQueued.reason, null);
});

test('cancel preserves a supplied reason', () => {
  const after = transitionJob(state({ state: 'running' }), event('cancel', { reason: 'operator stopped it' }));
  assert.equal(after.state, 'cancelled');
  assert.equal(after.reason, 'operator stopped it');
});

test('terminal states cannot resume', () => {
  for (const terminal of ['succeeded', 'failed', 'cancelled']) {
    const terminalState = state({ state: terminal });
    assert.throws(() => transitionJob(terminalState, event('start')), /cannot transition from terminal state/);
    assert.throws(() => transitionJob(terminalState, event('cancel')), /cannot transition from terminal state/);
    assert.throws(
      () => transitionJob(terminalState, event('succeed', { evidence: { ok: true } })),
      /cannot transition from terminal state/,
    );
  }
});

test('an event that does not apply to the current state is refused', () => {
  assert.throws(() => transitionJob(state({ state: 'running' }), event('start')), /cannot start a job that is running/);
  assert.throws(() => transitionJob(state(), event('succeed', { evidence: { ok: true } })), /cannot succeed a job that is queued/);
  assert.throws(() => transitionJob(state(), event('fail', { reason: 'x' })), /cannot fail a job that is queued/);
  assert.throws(() => transitionJob(state(), event('timeout', { reason: 'x' })), /cannot timeout a job that is queued/);
});

test('admission rejects a duplicate id, including a terminal job and a duplicate in the queue', () => {
  assert.throws(() => admitJob({ jobs: [state({ id: 'job-1', state: 'succeeded' })], limit: 5, id: 'job-1' }), /duplicate job id: job-1/);
  assert.throws(() => admitJob({ jobs: [state({ id: 'a' }), state({ id: 'a', state: 'failed' })], limit: 5, id: 'b' }), /duplicate job id: a/);
});

test('admission counts only queued and running jobs against the limit', () => {
  const jobs = [
    state({ id: 'done', state: 'succeeded' }),
    state({ id: 'failed', state: 'failed' }),
    state({ id: 'stopped', state: 'cancelled' }),
    state({ id: 'live', state: 'running' }),
  ];
  assert.equal(admitJob({ jobs, limit: 2, id: 'new' }).state, 'queued');
  assert.throws(() => admitJob({ jobs, limit: 1, id: 'new' }), /capacity exceeded: 1 active, limit 1/);
});

test('the limit is a hard boundary and zero admits nothing', () => {
  assert.equal(admitJob({ jobs: [], limit: 1, id: 'a' }).state, 'queued');
  assert.throws(() => admitJob({ jobs: [state({ id: 'a' })], limit: 1, id: 'b' }), /limit 1/);
  assert.throws(() => admitJob({ jobs: [], limit: 0, id: 'a' }), /capacity exceeded: 0 active, limit 0/);
});

test('malformed state and event fields are TypeErrors naming the field', () => {
  assert.throws(() => transitionJob(null, event('start')), { name: 'TypeError', message: /state must be an object/ });
  assert.throws(() => transitionJob([], event('start')), { name: 'TypeError', message: /state must be an object/ });
  assert.throws(() => transitionJob({ state: 'queued' }, event('start')), { name: 'TypeError', message: /state\.id/ });
  assert.throws(() => transitionJob({ id: '', state: 'queued' }, event('start')), { name: 'TypeError', message: /state\.id/ });
  assert.throws(() => transitionJob({ id: 'j', state: 'paused' }, event('start')), { name: 'TypeError', message: /state\.state/ });
  assert.throws(() => transitionJob(state({ reason: 3 }), event('start')), { name: 'TypeError', message: /state\.reason/ });
  assert.throws(() => transitionJob(state({ updatedAt: '2026-02-30T00:00:00Z' }), event('start')), { name: 'TypeError', message: /state\.updatedAt/ });
  assert.throws(() => transitionJob(state(), null), { name: 'TypeError', message: /event must be an object/ });
  assert.throws(() => transitionJob(state(), { at: T }), { name: 'TypeError', message: /event\.type/ });
  assert.throws(() => transitionJob(state(), { type: 'start' }), { name: 'TypeError', message: /event\.at/ });
  assert.throws(() => transitionJob(state(), { type: 'start', at: '2026-02-30T00:00:00Z' }), { name: 'TypeError', message: /event\.at/ });
  assert.throws(() => transitionJob(state({ state: 'running' }), event('fail')), { name: 'TypeError', message: /event\.reason/ });
  assert.throws(() => transitionJob(state({ state: 'running' }), event('timeout', { reason: '' })), { name: 'TypeError', message: /event\.reason/ });
  assert.throws(() => transitionJob(state(), event('cancel', { reason: 7 })), { name: 'TypeError', message: /event\.reason/ });
});

test('malformed admission inputs are TypeErrors naming the field', () => {
  assert.throws(() => admitJob(null), { name: 'TypeError', message: /input must be an object/ });
  assert.throws(() => admitJob({ limit: 1, id: 'x' }), { name: 'TypeError', message: /jobs must be an array/ });
  assert.throws(() => admitJob({ jobs: [], limit: -1, id: 'x' }), { name: 'TypeError', message: /limit must be a non-negative integer/ });
  assert.throws(() => admitJob({ jobs: [], limit: 1.5, id: 'x' }), { name: 'TypeError', message: /limit must be a non-negative integer/ });
  assert.throws(() => admitJob({ jobs: [], limit: 1, id: '' }), { name: 'TypeError', message: /id must be a non-empty string/ });
  assert.throws(() => admitJob({ jobs: [null], limit: 1, id: 'x' }), { name: 'TypeError', message: /jobs\[0\] must be an object/ });
  assert.throws(() => admitJob({ jobs: [{ state: 'queued' }], limit: 1, id: 'x' }), { name: 'TypeError', message: /jobs\[0\]\.id/ });
  assert.throws(() => admitJob({ jobs: [{ id: 'a' }], limit: 1, id: 'x' }), { name: 'TypeError', message: /jobs\[0\]\.state/ });
  assert.throws(() => admitJob({ jobs: [state({ state: 'paused' })], limit: 1, id: 'x' }), { name: 'TypeError', message: /jobs\[0\]\.state/ });
});

test('alternative field names are not accepted as substitutes', () => {
  assert.throws(() => transitionJob({ id: 'j', status: 'queued' }, event('start')), /state\.state/);
  assert.throws(() => transitionJob(state(), { kind: 'start', at: T }), /event\.type/);
  assert.throws(() => admitJob({ jobs: [], limit: 1, jobId: 'x' }), /id must be a non-empty string/);
});

test('deep-frozen inputs are not mutated and the result is a new object', () => {
  const frozenState = deepFreeze(state({ state: 'running' }));
  const frozenEvent = deepFreeze(event('succeed', { evidence: { ok: true } }));
  const after = transitionJob(frozenState, frozenEvent);
  assert.deepEqual(frozenState, state({ state: 'running' }));
  assert.equal(frozenEvent.evidence.ok, true);
  assert.notEqual(after, frozenState);
  assert.notEqual(after.evidence, frozenEvent.evidence);
  assert.deepEqual(after.evidence, { ok: true });
});

test('admission does not mutate the queue and ignores its order', () => {
  const jobs = deepFreeze([
    state({ id: 'a', state: 'succeeded' }),
    state({ id: 'b', state: 'running' }),
    state({ id: 'c', state: 'failed' }),
  ]);
  const first = admitJob({ jobs, limit: 5, id: 'new' });
  const reversed = admitJob({ jobs: [...jobs].reverse(), limit: 5, id: 'new' });
  assert.equal(JSON.stringify(first), JSON.stringify(reversed));
  assert.deepEqual(jobs.map((j) => j.id), ['a', 'b', 'c']);
});

test('the same transition gives byte-identical output', () => {
  const input = state({ state: 'running' });
  const ev = event('fail', { reason: 'boom' });
  assert.equal(JSON.stringify(transitionJob(input, ev)), JSON.stringify(transitionJob(input, ev)));
});

test('an id named like an object prototype key is an ordinary id', () => {
  assert.equal(admitJob({ jobs: [], limit: 1, id: '__proto__' }).id, '__proto__');
  assert.equal(transitionJob(state({ id: '__proto__' }), event('start')).id, '__proto__');
  assert.throws(() => admitJob({ jobs: [state({ id: '__proto__', state: 'succeeded' })], limit: 1, id: '__proto__' }), /duplicate job id/);
});

test('a state whose evidence is not an object is refused', () => {
  for (const evidence of ['ok', 1, true, []]) {
    assert.throws(() => transitionJob(state({ evidence }), event('start')), (e) => e instanceof TypeError && /state\.evidence/.test(e.message));
  }
  assert.equal(transitionJob(state({ evidence: null }), event('start')).state, 'running');
});
