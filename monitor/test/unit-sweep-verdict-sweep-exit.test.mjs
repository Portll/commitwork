// Computes the exit code, not-ran scan list, and summary line for a sweep verdict. (monitor/sweep-verdict.mjs sweepExit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepExit } from '../sweep-verdict.mjs';

test('returns exit 0 and a summary line when all scans ran and the verdict is recorded', () => {
  const r = sweepExit({ scans: [{ name: 'a', ran: true }, { name: 'b', ran: true }], verdictRecorded: true, failedSteps: [] });
  assert.deepEqual(r, { exit: 0, notRan: [], line: "all 2 scan(s) ran and the verdict is recorded" });
});

test('returns exit 1 and lists scans that did not run when some scans have ran false', () => {
  const r = sweepExit({ scans: [{ name: 'a', ran: true }, { name: 'b', ran: false, why: 'skipped' }], verdictRecorded: true, failedSteps: [] });
  assert.deepEqual(r, { exit: 1, notRan: ["b: skipped"], line: "1 of 2 scan(s) did NOT run \u2014 b: skipped" });
});

test('returns exit 1 and notes the verdict was not recorded when verdictRecorded is false', () => {
  const r = sweepExit({ scans: [{ name: 'a', ran: true }], verdictRecorded: false, failedSteps: [] });
  assert.deepEqual(r, { exit: 1, notRan: [], line: "this slice's verdict was NOT recorded" });
});

test('returns exit 1 and lists failed finalize steps when failedSteps is non-empty', () => {
  const r = sweepExit({ scans: [{ name: 'a', ran: true }], verdictRecorded: true, failedSteps: ['step1', 'step2'] });
  assert.deepEqual(r, { exit: 0, notRan: [], line: "2 finalize step(s) failed (recorded per step, exit unchanged): step1, step2" });
});

test('returns exit 1 and includes both not-ran and verdict-not-recorded parts when both conditions hold', () => {
  const r = sweepExit({ scans: [{ name: 'a', ran: false, why: 'x' }], verdictRecorded: false, failedSteps: [] });
  assert.deepEqual(r, { exit: 1, notRan: ["a: x"], line: "1 of 1 scan(s) did NOT run \u2014 a: x \u00b7 this slice's verdict was NOT recorded" });
});

test('returns exit 0 and a summary line when the input object is empty so defaults apply', () => {
  const r = sweepExit();
  assert.deepEqual(r, { exit: 0, notRan: [], line: "all 0 scan(s) ran and the verdict is recorded" });
});

test('returns exit 1 and includes a manifest suffix in the not-ran entry when a scan has a manifest', () => {
  const r = sweepExit({ scans: [{ name: 'a', ran: false, why: 'y', manifest: 'm1' }], verdictRecorded: true, failedSteps: [] });
  assert.deepEqual(r, { exit: 1, notRan: ["a (m1): y"], line: "1 of 1 scan(s) did NOT run \u2014 a (m1): y" });
});

test('returns exit 1 and lists a single failed step when failedSteps has one entry', () => {
  const r = sweepExit({ scans: [{ name: 'a', ran: true }], verdictRecorded: true, failedSteps: ['only'] });
  assert.deepEqual(r, { exit: 0, notRan: [], line: "1 finalize step(s) failed (recorded per step, exit unchanged): only" });
});
