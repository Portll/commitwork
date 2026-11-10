// Computes the canary column for a lane from scan-canary evidence (monitor/lane-trust.mjs canaryColumn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canaryColumn } from '../lane-trust.mjs';

test('returns not-measured when no scan-canary record is provided', () => {
  const r = canaryColumn([{ lane: 'a', date: '2024-01-01', credits: 1, verdict: 'clean' }], false);
  assert.deepEqual(r, { state: "not-measured", why: "no scan-canary record" });
});

test('returns not-measured when evidence is null', () => {
  const r = canaryColumn(null, true);
  assert.deepEqual(r, { state: "not-measured", why: "the scan canary records no run of this lane's tool" });
});

test('returns not-measured when evidence is an empty array', () => {
  const r = canaryColumn([], true);
  assert.deepEqual(r, { state: "not-measured", why: "the scan canary records no run of this lane's tool" });
});

test('returns unscored when some records lack credits', () => {
  const evidence = [
    { lane: 'a', date: '2024-01-01', credits: 1, verdict: 'clean' },
    { lane: 'b', date: '2024-01-02', credits: 0, verdict: 'alarm' }
  ];
  const r = canaryColumn(evidence, true);
  assert.deepEqual(r, { state: "unscored", lanes: ["a", "b"], date: "2024-01-02", verdicts: [{ lane: "a", verdict: "clean" }, { lane: "b", verdict: "alarm" }], why: "a canary record exists without a both-directions verdict and both runs recorded" });
});

test('returns measured with zero false-clean and false-alarm rates when all records are scored', () => {
  const evidence = [
    { lane: 'a', date: '2024-01-01', credits: 1, verdict: 'clean' },
    { lane: 'b', date: '2024-01-02', credits: 1, verdict: 'alarm' }
  ];
  const r = canaryColumn(evidence, true);
  assert.deepEqual(r, { state: "measured", lanes: ["a", "b"], date: "2024-01-02", falseClean: { state: "measured", n: 0, of: 2, rate: 0 }, falseAlarm: { state: "measured", n: 0, of: 2, rate: 0 } });
});

test('returns measured with single record and null date when date is missing', () => {
  const evidence = [{ lane: 'a', credits: 1, verdict: 'clean' }];
  const r = canaryColumn(evidence, true);
  assert.deepEqual(r, { state: "measured", lanes: ["a"], date: null, falseClean: { state: "measured", n: 0, of: 1, rate: 0 }, falseAlarm: { state: "measured", n: 0, of: 1, rate: 0 } });
});

test('returns measured with single record and populated date when date is present', () => {
  const evidence = [{ lane: 'a', date: '2024-06-15', credits: 1, verdict: 'clean' }];
  const r = canaryColumn(evidence, true);
  assert.deepEqual(r, { state: "measured", lanes: ["a"], date: "2024-06-15", falseClean: { state: "measured", n: 0, of: 1, rate: 0 }, falseAlarm: { state: "measured", n: 0, of: 1, rate: 0 } });
});
