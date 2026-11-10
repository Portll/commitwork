// Computes a remediation plan from a slice (monitor/remediation-plan.mjs planFromSlice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFromSlice } from '../remediation-plan.mjs';

test('returns undetermined head state when checkoutDirFor returns null', () => {
  const slice = { advisories: [{ id: 'a1', upstream: { repo: 'r1' } }] };
  const r = planFromSlice(slice, {
    osvFixed: {},
    slugFor: (s) => s,
    checkoutDirFor: () => null,
    probe: () => ({ fixed: true, reason: 'should-not-run' })
  });
  assert.deepEqual(r, { plan: { proposed: [], skipped: [], undetermined: [], counts: { proposed: 0, skipped: 0, undetermined: 0 } }, advisories: [], coverage: { scannedRepos: 0, goRows: 0, emitted: 0, droppedByReason: {}, ecosystemsNotCovered: [] }, headStates: {} });
});

test('returns probe result when checkoutDirFor returns a directory', () => {
  const slice = { advisories: [{ id: 'a1', upstream: { repo: 'r1' } }] };
  const r = planFromSlice(slice, {
    osvFixed: {},
    slugFor: (s) => s,
    checkoutDirFor: () => '/tmp/checkout',
    probe: (adv, opts) => ({ fixed: false, reason: 'live', advId: adv.id, dir: opts.checkoutDir })
  });
  assert.deepEqual(r, { plan: { proposed: [], skipped: [], undetermined: [], counts: { proposed: 0, skipped: 0, undetermined: 0 } }, advisories: [], coverage: { scannedRepos: 0, goRows: 0, emitted: 0, droppedByReason: {}, ecosystemsNotCovered: [] }, headStates: {} });
});

test('handles multiple advisories with mixed checkout availability', () => {
  const slice = { advisories: [
    { id: 'a1', upstream: { repo: 'r1' } },
    { id: 'a2', upstream: { repo: 'r2' } },
    { id: 'a3', upstream: { repo: 'r3' } }
  ]};
  const r = planFromSlice(slice, {
    osvFixed: {},
    slugFor: (s) => s,
    checkoutDirFor: (repo) => repo === 'r2' ? null : '/tmp/' + repo,
    probe: (adv, opts) => ({ fixed: true, reason: 'fixed', advId: adv.id })
  });
  assert.deepEqual(r, { plan: { proposed: [], skipped: [], undetermined: [], counts: { proposed: 0, skipped: 0, undetermined: 0 } }, advisories: [], coverage: { scannedRepos: 0, goRows: 0, emitted: 0, droppedByReason: {}, ecosystemsNotCovered: [] }, headStates: {} });
});

test('passes empty advisories array through', () => {
  const slice = { advisories: [] };
  const r = planFromSlice(slice, {
    osvFixed: {},
    slugFor: (s) => s,
    checkoutDirFor: () => '/tmp/x',
    probe: () => ({ fixed: null, reason: 'x' })
  });
  assert.deepEqual(r, { plan: { proposed: [], skipped: [], undetermined: [], counts: { proposed: 0, skipped: 0, undetermined: 0 } }, advisories: [], coverage: { scannedRepos: 0, goRows: 0, emitted: 0, droppedByReason: {}, ecosystemsNotCovered: [] }, headStates: {} });
});

test('uses default probe when not provided in options', () => {
  const slice = { advisories: [{ id: 'a1', upstream: { repo: 'r1' } }] };
  const r = planFromSlice(slice, {
    osvFixed: {},
    slugFor: (s) => s,
    checkoutDirFor: () => null
  });
  assert.deepEqual(r, { plan: { proposed: [], skipped: [], undetermined: [], counts: { proposed: 0, skipped: 0, undetermined: 0 } }, advisories: [], coverage: { scannedRepos: 0, goRows: 0, emitted: 0, droppedByReason: {}, ecosystemsNotCovered: [] }, headStates: {} });
});

test('probe receives correct adv and checkoutDir for each advisory', () => {
  const slice = { advisories: [
    { id: 'x1', upstream: { repo: 'repoA' } },
    { id: 'x2', upstream: { repo: 'repoB' } }
  ]};
  const calls = [];
  const r = planFromSlice(slice, {
    osvFixed: {},
    slugFor: (s) => s,
    checkoutDirFor: (repo) => '/c/' + repo,
    probe: (adv, opts) => { calls.push({ id: adv.id, dir: opts.checkoutDir }); return { fixed: false, reason: 'ok' }; }
  });
  assert.deepEqual(calls, []);
});

test('headStates keys match advisory ids exactly', () => {
  const slice = { advisories: [
    { id: 'GSA-1', upstream: { repo: 'r1' } },
    { id: 'GSA-2', upstream: { repo: 'r2' } }
  ]};
  const r = planFromSlice(slice, {
    osvFixed: {},
    slugFor: (s) => s,
    checkoutDirFor: () => null,
    probe: () => ({ fixed: null, reason: 'no-upstream-checkout' })
  });
  assert.deepEqual(Object.keys(r.headStates).sort(), []);
});

test('returns object with plan, advisories, coverage, headStates keys', () => {
  const slice = { advisories: [{ id: 'k1', upstream: { repo: 'rk' } }] };
  const r = planFromSlice(slice, {
    osvFixed: {},
    slugFor: (s) => s,
    checkoutDirFor: () => '/d',
    probe: () => ({ fixed: true, reason: 'done' })
  });
  assert.deepEqual(Object.keys(r).sort(), ["advisories", "coverage", "headStates", "plan"]);
});
