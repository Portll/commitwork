// Absolute report directory for an area slug, honouring CW_MONITOR_OUT (monitor/area.mjs outDirFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { outDirFor } from '../area.mjs';

test('returns the resolved CW_MONITOR_OUT path when env is true and the variable is set', () => {
  const prev = process.env.CW_MONITOR_OUT;
  process.env.CW_MONITOR_OUT = '/tmp/custom-out';
  try {
    const reg = { reportsRoot: 'reports', areas: [{ slug: 'alpha', primary: true }] };
    assert.equal(outDirFor('alpha', reg, { env: true }), resolve('/tmp/custom-out'));
  } finally {
    if (prev === undefined) delete process.env.CW_MONITOR_OUT;
    else process.env.CW_MONITOR_OUT = prev;
  }
});

test('ignores CW_MONITOR_OUT when env is false and joins reportsRoot with the area out name', () => {
  const prev = process.env.CW_MONITOR_OUT;
  process.env.CW_MONITOR_OUT = '/tmp/custom-out';
  try {
    const reg = { reportsRoot: 'reports', areas: [{ slug: 'alpha', primary: true, out: 'alpha-reports' }] };
    const result = outDirFor('alpha', reg, { env: false });
    assert.match(result, /reports[\\/]alpha-reports$/);
  } finally {
    if (prev === undefined) delete process.env.CW_MONITOR_OUT;
    else process.env.CW_MONITOR_OUT = prev;
  }
});

test('uses the primary area out name when slug is null and env is false', () => {
  const prev = process.env.CW_MONITOR_OUT;
  delete process.env.CW_MONITOR_OUT;
  try {
    const reg = { reportsRoot: 'reports', areas: [{ slug: 'beta', primary: true, out: 'beta-reports' }] };
    const result = outDirFor(null, reg, { env: false });
    assert.match(result, /reports[\\/]beta-reports$/);
  } finally {
    if (prev !== undefined) process.env.CW_MONITOR_OUT = prev;
  }
});

test('uses monitorOutput when slug is null, no primary area exists, and env is false', () => {
  const prev = process.env.CW_MONITOR_OUT;
  delete process.env.CW_MONITOR_OUT;
  try {
    const reg = { reportsRoot: 'reports', monitorOutput: 'shared-out', areas: [{ slug: 'gamma' }] };
    const result = outDirFor(null, reg, { env: false });
    assert.match(result, /reports[\\/]shared-out$/);
  } finally {
    if (prev !== undefined) process.env.CW_MONITOR_OUT = prev;
  }
});

test('throws when slug is null, no primary area, no monitorOutput, and env is false', () => {
  const prev = process.env.CW_MONITOR_OUT;
  delete process.env.CW_MONITOR_OUT;
  try {
    const reg = { reportsRoot: 'reports', areas: [] };
    assert.throws(() => outDirFor(null, reg, { env: false }), /cannot resolve a report directory/);
  } finally {
    if (prev !== undefined) process.env.CW_MONITOR_OUT = prev;
  }
});

test('returns the resolved CW_MONITOR_OUT path when env is true even if slug is null', () => {
  const prev = process.env.CW_MONITOR_OUT;
  process.env.CW_MONITOR_OUT = '/tmp/env-out';
  try {
    const reg = { reportsRoot: 'reports', areas: [{ slug: 'epsilon', primary: true }] };
    assert.equal(outDirFor(null, reg, { env: true }), resolve('/tmp/env-out'));
  } finally {
    if (prev === undefined) delete process.env.CW_MONITOR_OUT;
    else process.env.CW_MONITOR_OUT = prev;
  }
});

test('joins reportsRoot with the area out name when env is false and slug is provided', () => {
  const prev = process.env.CW_MONITOR_OUT;
  delete process.env.CW_MONITOR_OUT;
  try {
    const reg = { reportsRoot: 'reports', areas: [{ slug: 'zeta', out: 'zeta-reports' }] };
    const result = outDirFor('zeta', reg, { env: false });
    assert.match(result, /reports[\\/]zeta-reports$/);
  } finally {
    if (prev !== undefined) process.env.CW_MONITOR_OUT = prev;
  }
});

test('uses the default reports root when reportsRoot is missing from the registry', () => {
  const prev = process.env.CW_MONITOR_OUT;
  delete process.env.CW_MONITOR_OUT;
  try {
    const reg = { areas: [{ slug: 'eta', primary: true, out: 'eta-reports' }] };
    const result = outDirFor('eta', reg, { env: false });
    assert.match(result, /reports[\\/]eta-reports$/);
  } finally {
    if (prev !== undefined) process.env.CW_MONITOR_OUT = prev;
  }
});

test('honours CW_MONITOR_OUT by default when the env option is omitted', () => {
  const prev = process.env.CW_MONITOR_OUT;
  process.env.CW_MONITOR_OUT = '/tmp/default-env-out';
  try {
    const reg = { reportsRoot: 'reports', areas: [{ slug: 'theta', primary: true, out: 'theta-reports' }] };
    assert.equal(outDirFor('theta', reg), resolve('/tmp/default-env-out'));
  } finally {
    if (prev === undefined) delete process.env.CW_MONITOR_OUT;
    else process.env.CW_MONITOR_OUT = prev;
  }
});
