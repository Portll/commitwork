// Extracts falseAlarmRate and falseCleanRate per check and model from a calibration object (bin/lib/verdict-journal-core.mjs bankedRatesFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankedRatesFrom } from '../lib/verdict-journal-core.mjs';

test('returns empty object when calibration has no checks', () => {
  const r = bankedRatesFrom({ checks: {} });
  assert.deepEqual(r, {});
});

test('maps a single check with a single model to its rates', () => {
  const calibration = { checks: { lint: { base: { falseAlarmRate: 0.1, falseCleanRate: 0.2 } } } };
  const r = bankedRatesFrom(calibration);
  assert.deepEqual(r, { lint: { base: { falseAlarmRate: 0.1, falseCleanRate: 0.2 } } });
});

test('maps multiple models under one check', () => {
  const calibration = {
    checks: {
      lint: {
        a: { falseAlarmRate: 0.1, falseCleanRate: 0.2 },
        b: { falseAlarmRate: 0.3, falseCleanRate: 0.4 }
      }
    }
  };
  const r = bankedRatesFrom(calibration);
  assert.deepEqual(r, { lint: { a: { falseAlarmRate: 0.1, falseCleanRate: 0.2 }, b: { falseAlarmRate: 0.3, falseCleanRate: 0.4 } } });
});

test('maps multiple checks each with one model', () => {
  const calibration = {
    checks: {
      lint: { m1: { falseAlarmRate: 0.1, falseCleanRate: 0.2 } },
      test: { m2: { falseAlarmRate: 0.5, falseCleanRate: 0.6 } }
    }
  };
  const r = bankedRatesFrom(calibration);
  assert.deepEqual(r, { lint: { m1: { falseAlarmRate: 0.1, falseCleanRate: 0.2 } }, test: { m2: { falseAlarmRate: 0.5, falseCleanRate: 0.6 } } });
});

test('preserves zero rates for a model', () => {
  const calibration = { checks: { c: { m: { falseAlarmRate: 0, falseCleanRate: 0 } } } };
  const r = bankedRatesFrom(calibration);
  assert.deepEqual(r, { c: { m: { falseAlarmRate: 0, falseCleanRate: 0 } } });
});

test('preserves one as a rate value', () => {
  const calibration = { checks: { c: { m: { falseAlarmRate: 1, falseCleanRate: 1 } } } };
  const r = bankedRatesFrom(calibration);
  assert.deepEqual(r, { c: { m: { falseAlarmRate: 1, falseCleanRate: 1 } } });
});

test('preserves fractional rates with many decimal places', () => {
  const calibration = { checks: { c: { m: { falseAlarmRate: 0.123456789, falseCleanRate: 0.987654321 } } } };
  const r = bankedRatesFrom(calibration);
  assert.deepEqual(r, { c: { m: { falseAlarmRate: 0.123456789, falseCleanRate: 0.987654321 } } });
});

test('handles a check with many models built programmatically', () => {
  const models = {};
  for (let i = 0; i < 5; i++) {
    models['m' + i] = { falseAlarmRate: i * 0.1, falseCleanRate: 1 - i * 0.1 };
  }
  const calibration = { checks: { c: models } };
  const r = bankedRatesFrom(calibration);
  assert.deepEqual(r, { c: { m0: { falseAlarmRate: 0, falseCleanRate: 1 }, m1: { falseAlarmRate: 0.1, falseCleanRate: 0.9 }, m2: { falseAlarmRate: 0.2, falseCleanRate: 0.8 }, m3: { falseAlarmRate: 0.30000000000000004, falseCleanRate: 0.7 }, m4: { falseAlarmRate: 0.4, falseCleanRate: 0.6 } } });
});
