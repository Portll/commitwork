// Canary verdict: maps harness output or a not-run reason to the sweep verdict's canary field (monitor/sweep-verdict.mjs canaryVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canaryVerdict } from '../sweep-verdict.mjs';

test('a string reason maps to not-measured with the canonical why', () => {
  const r = canaryVerdict('fleet');
  assert.deepEqual(r, { state: "not-measured", why: "the fleet parent does not run the canary; each scheduled area sweep records its own" });
});

test('the string failed maps to the failed state', () => {
  const r = canaryVerdict('failed');
  assert.deepEqual(r, { state: "failed", why: "the canary harness failed or its output was unreadable" });
});

test('a null input maps to not-measured with the no-result why', () => {
  const r = canaryVerdict(null);
  assert.deepEqual(r, { state: "not-measured", why: "the sweep supplied no canary result" });
});

test('a number input maps to not-measured with the no-result why', () => {
  const r = canaryVerdict(42);
  assert.deepEqual(r, { state: "not-measured", why: "the sweep supplied no canary result" });
});

test('an object without a results array maps to failed', () => {
  const r = canaryVerdict({ summary: {}, results: 'nope' });
  assert.deepEqual(r, { state: "failed", why: "the canary output carried no per-scenario results, so no rate can be computed" });
});

test('a harness run that scored no scenario maps to not-measured', () => {
  const r = canaryVerdict({ exit: 0, summary: {}, results: [{ skipped: true }] });
  assert.deepEqual(r, { state: "not-measured", why: "the harness ran but scored no scenario", exit: 0, scored: 0, skipped: 1, falseClean: { state: "not-measured", n: 0, of: 0, rate: null, why: "no scenario in this stratum was scored" }, falseAlarm: { state: "not-measured", n: 0, of: 0, rate: null, why: "no scenario in this stratum was scored" }, requiredSkipped: [] });
});

test('a harness run with one scored scenario maps to measured with exact rates', () => {
  const r = canaryVerdict({ exit: 0, summary: { requiredSkipped: [] }, results: [{ truth: 'true-clean' }] });
  assert.deepEqual(r, { state: "measured", exit: 0, scored: 1, skipped: 0, falseClean: { state: "measured", n: 0, of: 1, rate: 0 }, falseAlarm: { state: "not-measured", n: 0, of: 0, rate: null, why: "no scenario in this stratum was scored" }, requiredSkipped: [] });
});

test('a harness run with a false alarm and a skipped scenario reports both rates', () => {
  const r = canaryVerdict({ exit: 1, summary: { requiredSkipped: ['x'] }, results: [{ truth: 'false-alarm' }, { skipped: true }] });
  assert.deepEqual(r, { state: "measured", exit: 1, scored: 1, skipped: 1, falseClean: { state: "not-measured", n: 0, of: 0, rate: null, why: "no scenario in this stratum was scored" }, falseAlarm: { state: "measured", n: 1, of: 1, rate: 1 }, requiredSkipped: ["x"] });
});
