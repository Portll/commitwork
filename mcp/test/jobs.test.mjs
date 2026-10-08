// The bounded job queue behind run_checks_start / run_checks_result, driven with a fake runner so
// every bound is exercised without spawning anything.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createJobQueue, jobLimits } from '../jobs.mjs';

function harness(limitsOverride = {}) {
  let t = Date.parse('2026-01-01T00:00:00Z');
  const runs = [];
  const start = (payload) => {
    let settle;
    const done = new Promise((r) => { settle = r; });
    const run = { payload, settle, killed: false };
    runs.push(run);
    return { done, kill: () => { run.killed = true; settle({ state: 'failed', reason: 'killed' }); } };
  };
  const limits = () => ({ concurrency: 1, maxQueued: 2, maxRetained: 3, retainMs: 1000, ...limitsOverride });
  const q = createJobQueue({ start, now: () => t, limits, prefix: 'test' });
  return { q, runs, advance: (ms) => { t += ms; } };
}
const tick = () => new Promise((r) => setImmediate(r));

describe('jobLimits', () => {
  test('defaults when unset, and reads the env it is given', () => {
    assert.deepEqual(jobLimits({}), { concurrency: 1, maxQueued: 8, maxRetained: 50, retainMs: 3600000 });
    assert.deepEqual(jobLimits({ CW_MCP_JOB_CONCURRENCY: '3', CW_MCP_JOB_QUEUE: '0' }).maxQueued, 0);
  });
  test('a malformed value throws by name instead of becoming the default', () => {
    assert.throws(() => jobLimits({ CW_MCP_JOB_QUEUE: 'eight' }), /CW_MCP_JOB_QUEUE/);
    assert.throws(() => jobLimits({ CW_MCP_JOB_CONCURRENCY: '0' }), /CW_MCP_JOB_CONCURRENCY.*>= 1/);
    assert.throws(() => jobLimits({ CW_MCP_JOB_RETAIN_MS: '-5' }), /CW_MCP_JOB_RETAIN_MS/);
  });
});

describe('createJobQueue', () => {
  test('runs at the concurrency bound, queues the rest in order, and reports positions', async () => {
    const { q, runs } = harness();
    const a = q.submit('a'); const b = q.submit('b'); const c = q.submit('c');
    assert.equal(a.state, 'running');
    assert.equal(b.state, 'queued'); assert.equal(b.queuePosition, 1);
    assert.equal(c.queuePosition, 2);
    assert.equal(runs.length, 1, 'concurrency 1 starts one runner');
    runs[0].settle({ state: 'done', result: { gate: 'PASS' } });
    await tick();
    assert.equal(q.get(a.jobId).state, 'done');
    assert.deepEqual(q.get(a.jobId).result, { gate: 'PASS' });
    assert.equal(q.get(b.jobId).state, 'running');
    assert.equal(q.get(c.jobId).queuePosition, 1);
    assert.deepEqual(runs.map((r) => r.payload), ['a', 'b']);
  });

  test('a full queue refuses with the reason and keeps every accepted job', () => {
    const { q } = harness({ maxQueued: 1 });
    const ids = [q.submit('a').jobId, q.submit('b').jobId];
    assert.throws(() => q.submit('c'), /queue full \(1 running of 1, 1 queued of 1\)/);
    for (const id of ids) assert.ok(['running', 'queued'].includes(q.get(id).state));
  });

  test('maxQueued 0 still runs a job when a slot is free', () => {
    const { q } = harness({ maxQueued: 0 });
    assert.equal(q.submit('a').state, 'running');
    assert.throws(() => q.submit('b'), /queue full/);
  });

  test('failure reasons are kept: a rejected runner, a throwing start, a failed result without a reason', async () => {
    let n = 0;
    const q = createJobQueue({ prefix: 'f', limits: () => ({ concurrency: 3, maxQueued: 0, maxRetained: 9, retainMs: 1e9 }),
      start: () => {
        n += 1;
        if (n === 1) return { done: Promise.reject(new Error('runner crashed')), kill() {} };
        if (n === 2) throw new Error('spawn EACCES');
        return { done: Promise.resolve({ state: 'failed' }), kill() {} };
      } });
    const [a, b, c] = ['x', 'y', 'z'].map((p) => q.submit(p).jobId);
    await tick();
    assert.deepEqual([q.get(a).state, q.get(a).reason], ['failed', 'runner crashed']);
    assert.deepEqual([q.get(b).state, q.get(b).reason], ['failed', 'did not start: spawn EACCES']);
    assert.match(q.get(c).reason, /without a reason/);
  });

  test('extra fields merge one level deep, so input and output signals sit together', async () => {
    const { q, runs } = harness();
    const { jobId } = q.submit('a', { request: { repo: '/r' }, extra: { injection: { inputs: { count: 0 } } } });
    runs[0].settle({ state: 'done', result: {}, extra: { injection: { output: { count: 2 } } } });
    await tick();
    assert.deepEqual(q.get(jobId).injection, { inputs: { count: 0 }, output: { count: 2 } });
    assert.deepEqual(q.get(jobId).request, { repo: '/r' });
  });

  test('finished jobs leave retention by age and by count, and an expired id says so', async () => {
    const { q, runs, advance } = harness({ concurrency: 9, maxQueued: 0, maxRetained: 2, retainMs: 1000 });
    const ids = ['a', 'b', 'c'].map((p) => q.submit(p).jobId);
    runs.forEach((r) => r.settle({ state: 'done', result: {} }));
    await tick();
    assert.throws(() => q.get(ids[0]), /expired from retention/, 'the oldest of three goes at maxRetained 2');
    assert.equal(q.get(ids[1]).state, 'done');
    advance(1001);
    assert.throws(() => q.get(ids[2]), /expired from retention.*1000 ms/);
  });

  test('a running job is never pruned, whatever its age', () => {
    const { q, advance } = harness({ retainMs: 1 });
    const { jobId } = q.submit('a');
    advance(1e6);
    assert.equal(q.get(jobId).state, 'running');
  });

  test('an id this process never issued is told apart from an expired one', () => {
    const { q } = harness();
    assert.throws(() => q.get('job-test-1'), /never issued by this server process/);
    assert.throws(() => q.get('job-other-1'), /never issued/);
    assert.throws(() => q.get('../../etc'), /never issued/);
  });

  test('shutdown fails waiting jobs, kills running ones, and refuses new submissions', async () => {
    const { q, runs } = harness();
    const a = q.submit('a').jobId; const b = q.submit('b').jobId;
    assert.equal(q.shutdown('client gone'), 1);
    assert.equal(runs[0].killed, true);
    await tick();
    assert.equal(q.get(b).state, 'failed');
    assert.equal(q.get(b).reason, 'not started: client gone');
    assert.equal(q.get(a).state, 'failed');
    assert.equal(runs.length, 1, 'the waiting job was never started');
    assert.throws(() => q.submit('c'), /shutting down/);
  });

  test('a limit that stops parsing fails the waiting jobs by name rather than stalling them', async () => {
    let bad = false;
    const runs = [];
    const q = createJobQueue({ prefix: 'l',
      limits: () => { if (bad) throw new Error('CW_MCP_JOB_CONCURRENCY="x" is not an integer >= 1'); return { concurrency: 1, maxQueued: 4, maxRetained: 9, retainMs: 1e9 }; },
      start: () => { let s; const done = new Promise((r) => { s = r; }); runs.push(s); return { done, kill() {} }; } });
    q.submit('a'); const b = q.submit('b').jobId;
    bad = true;
    runs[0]({ state: 'done', result: {} });
    await tick();
    bad = false;
    assert.match(q.get(b).reason, /not started: CW_MCP_JOB_CONCURRENCY/);
  });
});
