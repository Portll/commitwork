// Projects a calibration aggregate into a served projection with sanitized keys and null-safe rates. (admin/lib/served-projection.mjs projectCalibration).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectCalibration } from '../lib/served-projection.mjs';

test('returns no-records state when calib is null', () => {
  const result = projectCalibration(null);
  assert.deepEqual(result, { state: 'no-records' });
});

test('returns no-records state when calib has no checks property', () => {
  const result = projectCalibration({});
  assert.deepEqual(result, { state: 'no-records' });
});

test('returns no-records state when checks is an empty object', () => {
  const result = projectCalibration({ checks: {} });
  assert.deepEqual(result, { state: 'no-records' });
});

test('returns ok state with sanitized checks and null rates for zero adjudicated', () => {
  const calib = {
    generated: '2024-01-01T00:00:00Z',
    checks: {
      'check-a': {
        'model-x': {
          denominator: 10,
          adjudicated: 0,
          unadjudicated: 10,
          falseAlarmRate: null,
          falseCleanRate: null,
          cohortUnknown: 0,
        },
      },
    },
  };
  const result = projectCalibration(calib);
  assert.equal(result.state, 'ok');
  assert.equal(result.generated, '2024-01-01T00:00:00Z');
  assert.deepEqual(result.checks['check-a']['model-x'], {
    denominator: 10,
    adjudicated: 0,
    unadjudicated: 10,
    falseAlarmRate: null,
    falseCleanRate: null,
    cohortUnknown: 0,
  });
});

test('preserves numeric rates when adjudicated is non-zero', () => {
  const calib = {
    generated: '2024-06-15T12:00:00Z',
    checks: {
      'lint': {
        'eslint': {
          denominator: 100,
          adjudicated: 50,
          unadjudicated: 50,
          falseAlarmRate: 0.1,
          falseCleanRate: 0.05,
          cohortUnknown: 2,
        },
      },
    },
  };
  const result = projectCalibration(calib);
  assert.equal(result.state, 'ok');
  assert.equal(result.generated, '2024-06-15T12:00:00Z');
  assert.deepEqual(result.checks['lint']['eslint'], {
    denominator: 100,
    adjudicated: 50,
    unadjudicated: 50,
    falseAlarmRate: 0.1,
    falseCleanRate: 0.05,
    cohortUnknown: 2,
  });
});

test('coerces non-numeric denominator and adjudicated to zero', () => {
  const calib = {
    generated: 'gen',
    checks: {
      'c': {
        'm': {
          denominator: 'not-a-number',
          adjudicated: undefined,
          unadjudicated: NaN,
          falseAlarmRate: Infinity,
          falseCleanRate: -Infinity,
          cohortUnknown: 'x',
        },
      },
    },
  };
  const result = projectCalibration(calib);
  assert.equal(result.state, 'ok');
  assert.deepEqual(result.checks['c']['m'], {
    denominator: 0,
    adjudicated: 0,
    unadjudicated: 0,
    falseAlarmRate: null,
    falseCleanRate: null,
    cohortUnknown: 0,
  });
});

test('truncates check names longer than 80 characters', () => {
  const longCheck = 'a'.repeat(100);
  const calib = {
    generated: 'g',
    checks: {
      [longCheck]: {
        'm': {
          denominator: 1,
          adjudicated: 1,
          unadjudicated: 0,
          falseAlarmRate: 0,
          falseCleanRate: 0,
          cohortUnknown: 0,
        },
      },
    },
  };
  const result = projectCalibration(calib);
  const keys = Object.keys(result.checks);
  assert.equal(keys.length, 1);
  assert.equal(keys[0], 'a'.repeat(80));
});

test('truncates model names longer than 60 characters', () => {
  const longModel = 'b'.repeat(80);
  const calib = {
    generated: 'g',
    checks: {
      'c': {
        [longModel]: {
          denominator: 5,
          adjudicated: 3,
          unadjudicated: 2,
          falseAlarmRate: 0.2,
          falseCleanRate: 0.1,
          cohortUnknown: 1,
        },
      },
    },
  };
  const result = projectCalibration(calib);
  const keys = Object.keys(result.checks['c']);
  assert.equal(keys.length, 1);
  assert.equal(keys[0], 'b'.repeat(60));
});

test('truncates generated timestamp longer than 30 characters', () => {
  const longGen = 't'.repeat(50);
  const calib = {
    generated: longGen,
    checks: {
      'c': {
        'm': {
          denominator: 1,
          adjudicated: 1,
          unadjudicated: 0,
          falseAlarmRate: 0,
          falseCleanRate: 0,
          cohortUnknown: 0,
        },
      },
    },
  };
  const result = projectCalibration(calib);
  assert.equal(result.generated, 't'.repeat(30));
});

test('handles multiple checks and models in a single calibration', () => {
  const calib = {
    generated: '2024-01-01',
    checks: {
      'check1': {
        'model1': {
          denominator: 10,
          adjudicated: 5,
          unadjudicated: 5,
          falseAlarmRate: 0.2,
          falseCleanRate: 0.1,
          cohortUnknown: 0,
        },
        'model2': {
          denominator: 20,
          adjudicated: 10,
          unadjudicated: 10,
          falseAlarmRate: 0.3,
          falseCleanRate: 0.2,
          cohortUnknown: 1,
        },
      },
      'check2': {
        'model3': {
          denominator: 30,
          adjudicated: 15,
          unadjudicated: 15,
          falseAlarmRate: 0.4,
          falseCleanRate: 0.3,
          cohortUnknown: 2,
        },
      },
    },
  };
  const result = projectCalibration(calib);
  assert.equal(result.state, 'ok');
  assert.equal(result.generated, '2024-01-01');
  assert.deepEqual(Object.keys(result.checks).sort(), ['check1', 'check2']);
  assert.deepEqual(Object.keys(result.checks['check1']).sort(), ['model1', 'model2']);
  assert.deepEqual(Object.keys(result.checks['check2']), ['model3']);
  assert.equal(result.checks['check1']['model1'].denominator, 10);
  assert.equal(result.checks['check1']['model2'].denominator, 20);
  assert.equal(result.checks['check2']['model3'].denominator, 30);
});
