// Computes the release verdict and exit code from gate statuses (bin/lib/release-candidate-core.mjs overallVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overallVerdict } from '../lib/release-candidate-core.mjs';

test('returns blocked with exit 1 when any gate fails', () => {
  const gates = [{ status: 'pass' }, { status: 'fail' }];
  assert.deepEqual(overallVerdict(gates), { verdict: "blocked", exit: 1 });
});

test('returns accepted with exit 0 when all gates pass', () => {
  const gates = [{ status: 'pass' }, { status: 'pass' }];
  assert.deepEqual(overallVerdict(gates), { verdict: "accepted", exit: 0 });
});

test('returns incomplete with exit 2 when gates are mixed without fail', () => {
  const gates = [{ status: 'pass' }, { status: 'pending' }];
  assert.deepEqual(overallVerdict(gates), { verdict: "incomplete", exit: 2 });
});

test('returns incomplete with exit 2 for empty gates array', () => {
  const gates = [];
  assert.deepEqual(overallVerdict(gates), { verdict: "incomplete", exit: 2 });
});

test('returns blocked with exit 1 when single gate fails', () => {
  const gates = [{ status: 'fail' }];
  assert.deepEqual(overallVerdict(gates), { verdict: "blocked", exit: 1 });
});

test('returns accepted with exit 0 when single gate passes', () => {
  const gates = [{ status: 'pass' }];
  assert.deepEqual(overallVerdict(gates), { verdict: "accepted", exit: 0 });
});

test('returns incomplete with exit 2 when all gates are pending', () => {
  const gates = [{ status: 'pending' }, { status: 'pending' }];
  assert.deepEqual(overallVerdict(gates), { verdict: "incomplete", exit: 2 });
});

test('returns blocked with exit 1 when fail appears after pass', () => {
  const gates = [{ status: 'pass' }, { status: 'pass' }, { status: 'fail' }];
  assert.deepEqual(overallVerdict(gates), { verdict: "blocked", exit: 1 });
});
