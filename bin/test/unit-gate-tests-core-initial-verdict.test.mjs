// Maps a test tally against a baseline to a gate verdict (bin/gate-tests-core.mjs initialVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialVerdict } from '../gate-tests-core.mjs';

test('returns no-tally when fail is null', () => {
  assert.deepEqual(initialVerdict({ fail: null, pass: 1, tests: 1 }, { fail: 1, pass: 1, tests: 1 }), { verdict: "no-tally", exit: 0 });
});

test('returns armed when base is missing', () => {
  assert.deepEqual(initialVerdict({ fail: 0, pass: 1, tests: 1 }, null), { verdict: "armed", writeBaseline: true, exit: 0 });
});

test('returns floor-lowered when fail is below baseline', () => {
  assert.deepEqual(initialVerdict({ fail: 1, pass: 1, tests: 1 }, { fail: 2, pass: 1, tests: 1 }), { verdict: "floor-lowered", from: 2, to: 1, writeBaseline: true, exit: 0 });
});

test('returns regression-pending when fail is above baseline', () => {
  assert.deepEqual(initialVerdict({ fail: 2, pass: 1, tests: 1 }, { fail: 1, pass: 1, tests: 1 }), { verdict: "regression-pending" });
});

test('returns coverage-pending when tests drop below baseline', () => {
  assert.deepEqual(initialVerdict({ fail: 1, pass: 1, tests: 1 }, { fail: 1, pass: 1, tests: 2 }), { verdict: "coverage-pending", fromTests: 2, toTests: 1 });
});

test('returns steady with floor raised when tests rise above baseline', () => {
  assert.deepEqual(initialVerdict({ fail: 1, pass: 1, tests: 2 }, { fail: 1, pass: 1, tests: 1 }), { verdict: "steady", exit: 0, floorRaised: true, writeBaseline: true, coverageCheckable: true });
});

test('returns steady with floor not raised when tests equal baseline', () => {
  assert.deepEqual(initialVerdict({ fail: 1, pass: 1, tests: 1 }, { fail: 1, pass: 1, tests: 1 }), { verdict: "steady", exit: 0, floorRaised: false, writeBaseline: false, coverageCheckable: true });
});

test('returns steady with floor raised when pass rises and baseline lacks tests', () => {
  assert.deepEqual(initialVerdict({ fail: 1, pass: 2, tests: 1 }, { fail: 1, pass: 1 }), { verdict: "steady", exit: 0, floorRaised: true, writeBaseline: true, coverageCheckable: false });
});

test('returns steady with floor not raised when pass equals baseline and baseline lacks tests', () => {
  assert.deepEqual(initialVerdict({ fail: 1, pass: 1, tests: 1 }, { fail: 1, pass: 1 }), { verdict: "steady", exit: 0, floorRaised: false, writeBaseline: false, coverageCheckable: false });
});

test('returns steady with floor raised when baseline lacks pass field', () => {
  assert.deepEqual(initialVerdict({ fail: 1, pass: 1, tests: 1 }, { fail: 1 }), { verdict: "steady", exit: 0, floorRaised: true, writeBaseline: true, coverageCheckable: false });
});
