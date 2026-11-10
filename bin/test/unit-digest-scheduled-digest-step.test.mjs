// Maps a spawn result and written flag to a digest step record (bin/digest-scheduled.mjs digestStep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestStep } from '../digest-scheduled.mjs';

test('returns measured when written and exit is zero', () => {
  assert.deepEqual(digestStep({ status: 0, stderr: 'ok' }, true), { step: "write", exit: 0, written: true, outcome: "measured", failed: false });
});

test('returns not-all-measured when written and exit is twenty', () => {
  assert.deepEqual(digestStep({ status: 20, stderr: 'partial' }, true), { step: "write", exit: 20, written: true, outcome: "not-all-measured", failed: false });
});

test('returns returns-not-recorded when written and exit is twenty-one', () => {
  assert.deepEqual(digestStep({ status: 21, stderr: 'no record' }, true), { step: "write", exit: 21, written: true, outcome: "returns-not-recorded", failed: true, reason: "no record" });
});

test('returns not-written when not written and exit is zero', () => {
  assert.deepEqual(digestStep({ status: 0, stderr: 'done' }, false), { step: "write", exit: 0, written: false, outcome: "not-written", failed: true, reason: "exited 0 but wrote no digest for the window" });
});

test('returns not-written when not written and exit is twenty', () => {
  assert.deepEqual(digestStep({ status: 20, stderr: 'partial' }, false), { step: "write", exit: 20, written: false, outcome: "not-written", failed: true, reason: "exited 20 but wrote no digest for the window" });
});

test('returns not-written when not written and exit is twenty-one', () => {
  assert.deepEqual(digestStep({ status: 21, stderr: 'no record' }, false), { step: "write", exit: 21, written: false, outcome: "not-written", failed: true, reason: "exited 21 but wrote no digest for the window" });
});

test('returns unexpected-exit when written and exit is one', () => {
  assert.deepEqual(digestStep({ status: 1, stderr: 'boom' }, true), { step: "write", exit: 1, written: true, outcome: "unexpected-exit", failed: true, reason: "boom" });
});

test('returns not-written when not written and exit is one', () => {
  assert.deepEqual(digestStep({ status: 1, stderr: 'boom' }, false), { step: "write", exit: 1, written: false, outcome: "not-written", failed: true, reason: "boom" });
});

test('uses error message for reason when error is present', () => {
  assert.deepEqual(digestStep({ status: 1, error: { message: 'custom fail' } }, true), { step: "write", exit: 1, written: true, outcome: "unexpected-exit", failed: true, reason: "custom fail" });
});

test('uses timed out message when error code is ETIMEDOUT', () => {
  assert.deepEqual(digestStep({ status: 1, error: { code: 'ETIMEDOUT', message: 'ignored' } }, true), { step: "write", exit: 1, written: true, outcome: "unexpected-exit", failed: true, reason: "timed out after 15 min" });
});
