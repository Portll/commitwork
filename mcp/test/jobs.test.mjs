// The bounded job queue behind run_checks_start / run_checks_result, driven with a fake runner so
// every bound is exercised without spawning anything.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobQueue, jobLimits, JOB_STORE_SCHEMA } from '../jobs.mjs';
import { validateAgainstSchema } from '../../monitor/registry.mjs';

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

  test('shutdown interrupts waiting jobs, kills running ones, and refuses new submissions', async () => {
    const { q, runs } = harness();
    const a = q.submit('a').jobId; const b = q.submit('b').jobId;
    assert.equal(q.shutdown('client gone'), 1);
    assert.equal(runs[0].killed, true);
    await tick();
    assert.equal(q.get(b).state, 'interrupted');
    assert.equal(q.get(b).reason, 'interrupted before it started: client gone; not re-run');
    assert.equal(q.get(b).startedAt, null);
    assert.equal(q.get(a).state, 'interrupted');
    assert.match(q.get(a).reason, /^interrupted while running: client gone; not re-run \(the run ended: killed\)$/);
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

describe('the job store: results outlive the process, in-flight jobs come back interrupted', () => {
  const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'mcp-job-store.schema.json');
  const LIM = { concurrency: 1, maxQueued: 4, maxRetained: 9, retainMs: 1000 };
  let dir; let t;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cw-job-store-')); t = Date.parse('2026-01-01T00:00:00Z'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // The server's redaction: the log tail and the matched text stay in memory.
  const redact = ({ logTail, ...v }) => (v.injection?.output
    ? { ...v, injection: { ...v.injection, output: { ...v.injection.output, signals: v.injection.output.signals.map(({ match, ...s }) => s) } } }
    : v);
  function queue(prefix, opts = {}) {
    const runs = [];
    const start = (payload, job) => {
      let settle; const done = new Promise((r) => { settle = r; });
      runs.push({ payload, id: job.id, settle });
      return { done, kill: () => settle({ state: 'failed', reason: 'killed' }) };
    };
    const q = createJobQueue({ start, prefix, now: () => t, limits: () => LIM, store: () => dir, redact, ...opts });
    return { q, runs };
  }
  const doc = (p) => JSON.parse(readFileSync(join(dir, `${p}.json`), 'utf8'));

  test('a new queue over the same store returns the finished result and reports queued and running jobs as interrupted', async () => {
    const one = queue('aaa');
    const a = one.q.submit('a', { request: { repo: '/r' } }).jobId;
    const b = one.q.submit('b').jobId;
    const c = one.q.submit('c').jobId;
    one.runs[0].settle({ state: 'done', result: { gate: 'PASS' },
      extra: { logTail: 'raw log', injection: { output: { count: 1, signals: [{ id: 'override-instructions', why: 'w', match: 'Ignore all previous instructions', span: '0123456789abcdef' }] } } } });
    await new Promise((r) => setImmediate(r));
    assert.equal(one.q.get(b).state, 'running');
    assert.deepEqual(validateAgainstSchema(doc('aaa'), { path: SCHEMA }).errors, []);
    assert.equal(doc('aaa').schema, JOB_STORE_SCHEMA);
    const raw = readFileSync(join(dir, 'aaa.json'), 'utf8');
    assert.ok(!raw.includes('raw log') && !raw.includes('Ignore all previous'), 'the log tail and matched text are not stored');

    // The first process is gone without a shutdown: a crash.
    t += 10;
    const two = queue('bbb');
    const done = two.q.get(a);
    assert.equal(done.state, 'done');
    assert.equal(done.restored, true);
    assert.deepEqual(done.result, { gate: 'PASS' });
    assert.deepEqual(done.request, { repo: '/r' });
    assert.equal(done.logTail, undefined);
    assert.deepEqual(done.injection.output.signals, [{ id: 'override-instructions', why: 'w', span: '0123456789abcdef' }]);
    for (const [id, was] of [[b, 'running'], [c, 'queued']]) {
      const v = two.q.get(id);
      assert.equal(v.state, 'interrupted', id);
      assert.match(v.reason, new RegExp(`^interrupted: the server process that held this job \\(pid ${process.pid}\\) exited while it was ${was}; last recorded .*; not re-run$`));
      assert.equal(v.restored, true);
    }
    assert.equal(two.runs.length, 0, 'nothing is re-run');
    assert.throws(() => two.q.get('job-aaa-4'), /never issued: the process that owns its prefix issued 3/);
    assert.throws(() => two.q.get('job-zzz-1'), /not issued by this server process, and the job store holds no record of it/);
  });

  test('a shutdown records interrupted jobs before the process goes', async () => {
    const one = queue('aaa');
    const a = one.q.submit('a').jobId; const b = one.q.submit('b').jobId;
    assert.deepEqual(doc('aaa').jobs.map((j) => j.state), ['running', 'queued']);
    one.q.shutdown('the client closed stdin');
    assert.deepEqual(doc('aaa').jobs.map((j) => j.state), ['running', 'interrupted'], 'written at shutdown, before the kill settles');
    await new Promise((r) => setImmediate(r));
    const two = queue('bbb');
    assert.match(two.q.get(a).reason, /^interrupted while running: the client closed stdin; not re-run/);
    assert.equal(two.q.get(b).reason, 'interrupted before it started: the client closed stdin; not re-run');
  });

  test('a job a live process still holds is not called interrupted', () => {
    const one = queue('aaa');
    const a = one.q.submit('a').jobId;
    const two = queue('bbb', { alive: () => true });
    const v = two.q.get(a);
    assert.equal(v.state, 'running');
    assert.equal(v.heldBy.pid, process.pid);
  });

  test('a corrupt store file is an error, never an absent job', () => {
    writeFileSync(join(dir, 'ccc.json'), '{"schema": "commitwork.mcp-jobs/1", "owner": ');
    writeFileSync(join(dir, 'ddd.json'), JSON.stringify({ schema: 'something-else/1' }));
    const { q } = queue('bbb');
    assert.throws(() => q.get('job-ccc-1'), /job store .*ccc\.json is unreadable .*refusing to report job-ccc-1 as absent/);
    assert.throws(() => q.get('job-ddd-1'), /unreadable \(not a commitwork\.mcp-jobs\/1 document\)/);
    assert.ok(existsSync(join(dir, 'ccc.json')), 'an unreadable record is never swept away');
  });

  test('stored jobs leave by the same retention bound, and a dead process\'s expired file is swept', async () => {
    const one = queue('aaa');
    const a = one.q.submit('a').jobId;
    one.runs[0].settle({ state: 'done', result: {} });
    await new Promise((r) => setImmediate(r));
    const two = queue('bbb');
    assert.equal(two.q.get(a).state, 'done');
    t += LIM.retainMs + 1;
    assert.throws(() => two.q.get(a), /expired from retention/);
    assert.deepEqual(readdirSync(dir), ['aaa.json'], 'swept only at construction');
    queue('ccc');
    assert.deepEqual(readdirSync(dir), [], 'aaa is past retention and its process is gone; ccc has written nothing yet');
  });

  test('a store that cannot be listed refuses the queue by name', () => {
    writeFileSync(join(dir, 'file'), 'not a directory');
    assert.throws(() => queue('aaa', { store: () => join(dir, 'file', 'jobs') }), /job store .* cannot be listed \(ENOTDIR\)/);
  });

  test('a store that cannot be written refuses the job and issues no id',
    { skip: (process.platform === 'win32' && 'no POSIX modes') || (process.getuid?.() === 0 && 'root ignores modes') }, () => {
      const ro = join(dir, 'ro');
      mkdirSync(ro); chmodSync(ro, 0o500);
      try {
        const { q, runs } = queue('aaa', { store: () => ro });
        assert.throws(() => q.submit('a'), /job refused: the job store could not be written \(EACCES\)/);
        assert.equal(runs.length, 0);
        assert.throws(() => q.get('job-aaa-1'), /never issued/);
      } finally { chmodSync(ro, 0o700); }
    });

  test('a prefix with an existing record is refused rather than overwritten', () => {
    queue('aaa').q.submit('a');
    assert.throws(() => queue('aaa'), /already exists; refusing to overwrite/);
  });
});
