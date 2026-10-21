import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUEUE, CORE_PHASES, readyJob, phaseBlockers, completionText } from '../lib/security-work-queue.mjs';

const delivered = key => ({ status: 'completed', state: { job: { programmeKey: key }, review: 'accepted', landed: 'a'.repeat(40) } });

test('core phase two cannot begin while agent containment remains unreviewed', () => {
  const job = QUEUE.find(q => q.key === 'authz-matrix');
  const first = CORE_PHASES[0].keys.map(delivered);
  assert.equal(readyJob(job, first), true);
  first[0].state.review = 'pending';
  assert.equal(readyJob(job, first), false);
  assert.deepEqual(phaseBlockers(job, first), ['agent-effective-config']);
});

test('the interactive history and other secondary work waits for all five core phases', () => {
  const job = QUEUE.find(q => q.key === 'machine-events');
  const tasks = CORE_PHASES.flatMap(p => p.keys.map(delivered));
  assert.equal(readyJob(job, tasks), true);
  assert.equal(readyJob(job, tasks.slice(0,-1)), false);
  assert.equal(readyJob(QUEUE.find(q => q.key === 'sarif-export'), []), false);
});

test('stale repair metadata cannot bypass current build order', () => {
  const repair = { key: null, programmeKey: 'machine-events', corePhase: 1, priorityClass: 'core', priority: 999999 };
  assert.equal(readyJob(repair, []), false);
  assert.equal(readyJob(QUEUE.find(q => q.key === 'agent-effective-config'), []), true);
});

test('Betterleaks remains secondary and remote validation waits for local integration', () => {
  const core = CORE_PHASES.flatMap(p => p.keys.map(delivered));
  const report = QUEUE.find(q => q.key === 'betterleaks-report');
  const wire = QUEUE.find(q => q.key === 'betterleaks-wire');
  const remote = QUEUE.find(q => q.key === 'betterleaks-scoped-sources');
  for (const job of [report, wire, remote]) {
    assert.equal(job.priorityClass, 'secondary');
    assert.equal(readyJob(job, []), false);
  }
  assert.equal(readyJob(report, core), true);
  assert.equal(readyJob(wire, core), false);
  assert.equal(readyJob(wire, [...core, delivered(report.key)]), true);
  assert.equal(readyJob(remote, [...core, delivered(report.key)]), false);
  assert.equal(readyJob(remote, [...core, delivered(report.key), delivered(wire.key)]), true);
});

test('every core task depends only on its own or an earlier core phase', () => {
  for (const q of QUEUE.filter(q => q.priorityClass === 'core')) {
    for (const dep of q.deps) {
      const earlier = QUEUE.find(x => x.key === dep);
      assert.equal(earlier.priorityClass, 'core');
      assert.ok(earlier.corePhase <= q.corePhase, `${q.key} depends on later phase ${dep}`);
    }
  }
});

test('programme keys are unique and dependencies refer to earlier work', () => {
  const seen = new Set();
  for (const job of QUEUE) {
    assert.ok(!seen.has(job.key));
    for (const dep of job.deps) assert.ok(seen.has(dep), `${job.key} depends on ${dep}`);
    assert.ok(job.spec.length > 200);
    seen.add(job.key);
  }
});

test('a passed model draft does not release integration work before review and landing', () => {
  const job = { deps: ['component'] };
  const task = { status: 'completed', state: { job: { key: 'component' }, review: 'pending' } };
  assert.equal(readyJob(job, [task]), false);
  task.state.review = 'accepted';
  assert.equal(readyJob(job, [task]), false);
  task.state.landed = 'a'.repeat(40);
  assert.equal(readyJob(job, [task]), true);
});

test('missing, abandoned and unreviewed dependencies never read as ready', () => {
  const job = { deps: ['component'] };
  assert.equal(readyJob(job, []), false);
  assert.equal(readyJob(job, [{ status: 'abandoned', state: { job: { key: 'component' }, review: 'accepted', landed: 'a'.repeat(40) } }]), false);
  assert.equal(readyJob(job, [{ status: 'completed', state: { job: { key: 'component' }, review: 'dropped', landed: 'a'.repeat(40) } }]), false);
  assert.equal(readyJob({ deps: [] }, []), true);
});

test('all dependencies must be independently released', () => {
  const t = key => ({ status: 'completed', state: { job: { key }, review: 'accepted', landed: 'b'.repeat(40) } });
  assert.equal(readyJob({ deps: ['a','b'] }, [t('a')]), false);
  assert.equal(readyJob({ deps: ['a','b'] }, [t('a'),t('b')]), true);
});

test('a reviewed and landed repair releases its programme dependency', () => {
  const repaired = { status: 'completed', state: { job: { key: null, programmeKey: 'component', repairOf: '1' }, review: 'accepted', landed: 'a'.repeat(40) } };
  assert.equal(readyJob({ deps: ['component'] }, [repaired]), true);
  repaired.state.landed = 'looks landed';
  assert.equal(readyJob({ deps: ['component'] }, [repaired]), false);
});

test('errors, empty output and clipped completions cannot become successful drafts', () => {
  assert.throws(() => completionText({ is_error: true, result: 'looks like code' }), /failed/);
  assert.throws(() => completionText({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }), /incomplete/);
  assert.throws(() => completionText({ result: ' ' }), /empty/);
  assert.throws(() => completionText({}), /empty/);
  assert.equal(completionText({ result: 'complete file' }), 'complete file');
  assert.equal(completionText({ choices: [{ finish_reason: 'stop', message: { content: 'complete file' } }] }), 'complete file');
});
