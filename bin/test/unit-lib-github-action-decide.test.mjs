// Computes whether a commitwork run should fail the gate (bin/lib/github-action.mjs decide).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../lib/github-action.mjs';

test('run exit 1 records the lane failure reason', () => {
  const r = decide({ runExit: 1, exportExit: 0, sarif: { state: 'ok', levels: {}, unmeasured: [] }, failOn: 'none', failOnUnmeasured: false });
  assert.deepEqual(r, { failed: true, reasons: ["commitwork run exited 1: a lane failed to execute (its line in the run log names it)"], warnings: [] });
});

test('run exit 2 records the could-not-run reason', () => {
  const r = decide({ runExit: 2, exportExit: 0, sarif: { state: 'ok', levels: {}, unmeasured: [] }, failOn: 'none', failOnUnmeasured: false });
  assert.deepEqual(r, { failed: true, reasons: ["commitwork run exited 2: it could not run (the error is in the run log)"], warnings: [] });
});

test('run exit 3 records the generic exit reason', () => {
  const r = decide({ runExit: 3, exportExit: 0, sarif: { state: 'ok', levels: {}, unmeasured: [] }, failOn: 'none', failOnUnmeasured: false });
  assert.deepEqual(r, { failed: true, reasons: ["commitwork run exited 3"], warnings: [] });
});

test('run exit 0 with ok sarif and no failOn passes cleanly', () => {
  const r = decide({ runExit: 0, exportExit: 0, sarif: { state: 'ok', levels: {}, unmeasured: [] }, failOn: 'none', failOnUnmeasured: false });
  assert.deepEqual(r, { failed: false, reasons: [], warnings: [] });
});

test('non-zero export exit records the sarif export failure', () => {
  const r = decide({ runExit: 0, exportExit: 1, sarif: { state: 'ok', levels: {}, unmeasured: [] }, failOn: 'none', failOnUnmeasured: false });
  assert.deepEqual(r, { failed: true, reasons: ["commitwork sarif exited 1: the SARIF export failed"], warnings: [] });
});

test('sarif state not ok fails immediately with the why detail', () => {
  const r = decide({ runExit: 0, exportExit: 0, sarif: { state: 'missing', why: 'no file' }, failOn: 'none', failOnUnmeasured: false });
  assert.deepEqual(r, { failed: true, reasons: ["no SARIF to judge (missing: no file)"], warnings: [] });
});

test('failOn warning counts results at warning level or above', () => {
  const r = decide({ runExit: 0, exportExit: 0, sarif: { state: 'ok', levels: { warning: 2, note: 1 }, unmeasured: [] }, failOn: 'warning', failOnUnmeasured: false });
  assert.deepEqual(r, { failed: true, reasons: ["2 result(s) at level warning or above"], warnings: [] });
});

test('failOn error counts only error level results', () => {
  const r = decide({ runExit: 0, exportExit: 0, sarif: { state: 'ok', levels: { warning: 2, note: 1 }, unmeasured: [] }, failOn: 'error', failOnUnmeasured: false });
  assert.deepEqual(r, { failed: false, reasons: [], warnings: [] });
});

test('unmeasured lanes with failOnUnmeasured fail the gate', () => {
  const r = decide({ runExit: 0, exportExit: 0, sarif: { state: 'ok', levels: {}, unmeasured: [{ text: 'lane A' }, { text: 'lane B' }] }, failOn: 'none', failOnUnmeasured: true });
  assert.deepEqual(r, { failed: true, reasons: ["2 lane(s) did not measure"], warnings: [] });
});

test('unmeasured lanes without failOnUnmeasured produce warnings only', () => {
  const r = decide({ runExit: 0, exportExit: 0, sarif: { state: 'ok', levels: {}, unmeasured: [{ text: 'lane A' }] }, failOn: 'none', failOnUnmeasured: false });
  assert.deepEqual(r, { failed: false, reasons: [], warnings: ["lane A"] });
});
