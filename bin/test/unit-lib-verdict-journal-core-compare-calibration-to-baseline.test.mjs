// Compares calibration rates against baseline to find regressions (bin/lib/verdict-journal-core.mjs compareCalibrationToBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCalibrationToBaseline } from '../lib/verdict-journal-core.mjs';

test('returns empty arrays when baseline is null', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.5 }, standing: { falseAlarmRate: 0.5 } } } } } };
  const result = compareCalibrationToBaseline(calibration, null);
  assert.deepEqual(result, { deltaRegressions: [], standingRegressions: [] });
});

test('returns empty arrays when baseline has no checks property', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.5 }, standing: { falseAlarmRate: 0.5 } } } } } };
  const result = compareCalibrationToBaseline(calibration, {});
  assert.deepEqual(result, { deltaRegressions: [], standingRegressions: [] });
});

test('returns empty arrays when baseline is an object without checks', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.5 }, standing: { falseAlarmRate: 0.5 } } } } } };
  const result = compareCalibrationToBaseline(calibration, { other: 1 });
  assert.deepEqual(result, { deltaRegressions: [], standingRegressions: [] });
});

test('skips model when baseline does not have that check-model pair', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.9 }, standing: { falseAlarmRate: 0.9 } } } } } };
  const baseline = { checks: { c: { other: { falseAlarmRate: 0.1 } } } };
  const result = compareCalibrationToBaseline(calibration, baseline);
  assert.deepEqual(result, { deltaRegressions: [], standingRegressions: [] });
});

test('detects delta regression when delta rate exceeds baseline rate', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.6 }, standing: { falseAlarmRate: 0.1 } } } } } };
  const baseline = { checks: { c: { m: { falseAlarmRate: 0.5 } } } };
  const result = compareCalibrationToBaseline(calibration, baseline);
  assert.deepEqual(result, { deltaRegressions: [{ check: "c", model: "m", rateKey: "falseAlarmRate", from: 0.5, to: 0.6 }], standingRegressions: [] });
});

test('does not flag delta regression when delta rate equals baseline rate', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.5 }, standing: { falseAlarmRate: 0.1 } } } } } };
  const baseline = { checks: { c: { m: { falseAlarmRate: 0.5 } } } };
  const result = compareCalibrationToBaseline(calibration, baseline);
  assert.deepEqual(result, { deltaRegressions: [], standingRegressions: [] });
});

test('does not flag delta regression when delta rate is below baseline rate', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.4 }, standing: { falseAlarmRate: 0.1 } } } } } };
  const baseline = { checks: { c: { m: { falseAlarmRate: 0.5 } } } };
  const result = compareCalibrationToBaseline(calibration, baseline);
  assert.deepEqual(result, { deltaRegressions: [], standingRegressions: [] });
});

test('detects standing regression when standing rate exceeds baseline rate', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.1 }, standing: { falseAlarmRate: 0.6 } } } } } };
  const baseline = { checks: { c: { m: { falseAlarmRate: 0.5 } } } };
  const result = compareCalibrationToBaseline(calibration, baseline);
  assert.deepEqual(result, { deltaRegressions: [], standingRegressions: [{ check: "c", model: "m", rateKey: "falseAlarmRate", from: 0.5, to: 0.6 }] });
});

test('does not flag standing regression when standing rate equals baseline rate', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.1 }, standing: { falseAlarmRate: 0.5 } } } } } };
  const baseline = { checks: { c: { m: { falseAlarmRate: 0.5 } } } };
  const result = compareCalibrationToBaseline(calibration, baseline);
  assert.deepEqual(result, { deltaRegressions: [], standingRegressions: [] });
});

test('does not flag standing regression when standing rate is below baseline rate', () => {
  const calibration = { checks: { c: { m: { cohorts: { delta: { falseAlarmRate: 0.1 }, standing: { falseAlarmRate: 0.4 } } } } } };
  const baseline = { checks: { c: { m: { falseAlarmRate: 0.5 } } } };
  const result = compareCalibrationToBaseline(calibration, baseline);
  assert.deepEqual(result, { deltaRegressions: [], standingRegressions: [] });
});
