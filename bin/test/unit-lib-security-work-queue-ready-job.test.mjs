// readyJob returns true when no phase blockers exist and all dependencies are delivered (bin/lib/security-work-queue.mjs readyJob).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyJob, CORE_PHASES } from '../lib/security-work-queue.mjs';

const SHA40 = 'a'.repeat(40);
const delivered = (key, { job = { key }, status = 'completed', review = 'accepted', landed = SHA40 } = {}) => ({ status, state: { job, review, landed } });
const keysOf = (...phases) => CORE_PHASES.filter((p) => phases.includes(p.phase)).flatMap((p) => p.keys);
const deliverAll = (keys) => keys.map((k) => delivered(k));

test('a phase-1 component with no dependencies is ready with nothing delivered', () => {
  assert.equal(readyJob({ key: 'agent-effective-config' }, []), true);
});

test('a phase-1 integration waits for its programme dependency and is ready once it is delivered', () => {
  assert.equal(readyJob({ key: 'agent-config-wire' }, []), false);
  assert.equal(readyJob({ key: 'agent-config-wire' }, [delivered('agent-effective-config')]), true);
});

test('a dependency is delivered only when completed, accepted and landed on a 40 to 64 character lowercase hex sha', () => {
  const job = { key: 'agent-config-wire' };
  const undelivered = {
    'not completed': { status: 'in_progress' },
    'not accepted': { review: 'pending' },
    'no landed sha': { landed: null },
    '39 characters': { landed: 'a'.repeat(39) },
    '65 characters': { landed: 'a'.repeat(65) },
    'uppercase hex': { landed: 'A'.repeat(40) },
    'not hex': { landed: 'g'.repeat(40) },
  };
  for (const [why, over] of Object.entries(undelivered)) {
    assert.equal(readyJob(job, [delivered('agent-effective-config', over)]), false, why);
  }
  assert.equal(readyJob(job, [delivered('agent-effective-config', { landed: 'f'.repeat(64) })]), true, '64 characters');
});

test('a phase-2 job is blocked until every phase-1 key is delivered', () => {
  const phase1 = keysOf(1);
  for (const missing of phase1) {
    assert.equal(readyJob({ key: 'authz-matrix' }, deliverAll(phase1.filter((k) => k !== missing))), false, missing);
  }
  assert.equal(readyJob({ key: 'authz-matrix' }, deliverAll(phase1)), true);
});

test('a later phase does not block an earlier one', () => {
  assert.equal(readyJob({ key: 'lane-trust' }, deliverAll(keysOf(1, 2, 3, 4))), true);
  assert.equal(readyJob({ key: 'lane-trust' }, deliverAll(keysOf(1, 2, 3))), false);
});

test('a secondary job is blocked until every core key in all five phases is delivered', () => {
  const core = keysOf(1, 2, 3, 4, 5);
  assert.equal(readyJob({ key: 'ledger-witness' }, deliverAll(core)), true);
  assert.equal(readyJob({ key: 'ledger-witness' }, deliverAll(core.filter((k) => k !== 'machinery-health-wire'))), false);
});

test('for a known key the programme dependencies decide and the job record deps are ignored', () => {
  assert.equal(readyJob({ key: 'agent-effective-config', deps: ['not-delivered'] }, []), true);
  assert.equal(readyJob({ key: 'agent-config-wire', deps: ['something'] }, [delivered('something')]), false);
});

test('for a key outside the programme there are no phase blockers and the job record deps decide', () => {
  assert.equal(readyJob({ key: 'outside' }, []), true);
  assert.equal(readyJob({ key: 'outside', deps: ['agent-effective-config'] }, []), false);
  assert.equal(readyJob({ key: 'outside', deps: ['agent-effective-config'] }, [delivered('agent-effective-config')]), true);
});

test('programmeKey names the job in the programme ahead of key, for the job and for a delivered task', () => {
  assert.equal(readyJob({ programmeKey: 'authz-matrix', key: 'agent-effective-config' }, []), false);
  assert.equal(readyJob({ programmeKey: 'agent-effective-config', key: 'authz-matrix' }, []), true);
  assert.equal(readyJob({ programmeKey: 'agent-config-wire', key: 'agent-effective-config' }, []), false);
  const renamed = delivered('x', { job: { programmeKey: 'agent-effective-config', key: 'repair-17' } });
  assert.equal(readyJob({ key: 'agent-config-wire' }, [renamed]), true);
});
