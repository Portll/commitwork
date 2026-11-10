// Reports which runner controls a waiver basis fails to name (lib/launchlist-waiver.mjs basisGaps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basisGaps } from '../launchlist-waiver.mjs';

test('returns empty string when all runner controls are named', () => {
  const reason = 'commitwork-runner:no-docker-socket slot-network jit-only one-job-per-slot admission job-started-hook';
  assert.equal(basisGaps(reason), "");
});

test('returns message listing missing controls when prefix is present but controls are absent', () => {
  const reason = 'commitwork-runner:foo';
  assert.equal(basisGaps(reason), "basis does not name no-docker-socket, slot-network, jit-only, one-job-per-slot, admission, job-started-hook");
});

test('returns prefix error when reason does not start with waiver prefix', () => {
  const reason = 'no-docker-socket slot-network jit-only one-job-per-slot admission job-started-hook';
  assert.equal(basisGaps(reason), "basis does not start with 'commitwork-runner:'");
});

test('returns prefix error when reason is null', () => {
  assert.equal(basisGaps(null), "basis does not start with 'commitwork-runner:'");
});

test('returns prefix error when reason is undefined', () => {
  assert.equal(basisGaps(undefined), "basis does not start with 'commitwork-runner:'");
});

test('returns prefix error when reason is empty string', () => {
  assert.equal(basisGaps(''), "basis does not start with 'commitwork-runner:'");
});

test('returns prefix error when reason is whitespace only', () => {
  assert.equal(basisGaps('   '), "basis does not start with 'commitwork-runner:'");
});

test('returns empty string when controls are named with mixed case and separators', () => {
  const reason = 'commitwork-runner:No-Docker-Socket,Slot-Network;JIT-Only|One-Job-Per-Slot&Admission*Job-Started-Hook';
  assert.equal(basisGaps(reason), "basis does not name no-docker-socket, slot-network, jit-only, one-job-per-slot, admission, job-started-hook");
});

test('returns message listing missing controls when only some are named', () => {
  const reason = 'commitwork-runner:no-docker-socket admission';
  assert.equal(basisGaps(reason), "basis does not name slot-network, jit-only, one-job-per-slot, job-started-hook");
});

test('returns prefix error when reason is a number', () => {
  assert.equal(basisGaps(42), "basis does not start with 'commitwork-runner:'");
});
