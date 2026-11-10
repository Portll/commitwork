// Computes the default reports root path, using CW_MONITOR_OUT env var or a derived path (monitor/nondeterministic-store.mjs reportsRootDefault).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportsRootDefault } from '../nondeterministic-store.mjs';

test('returns the CW_MONITOR_OUT value when set to an absolute path', () => {
  const original = process.env.CW_MONITOR_OUT;
  process.env.CW_MONITOR_OUT = '/tmp/monitor-out';
  try {
    const result = reportsRootDefault();
    assert.strictEqual(result, '/tmp/monitor-out');
  } finally {
    process.env.CW_MONITOR_OUT = original;
  }
});

test('returns the CW_MONITOR_OUT value when set to a relative path', () => {
  const original = process.env.CW_MONITOR_OUT;
  process.env.CW_MONITOR_OUT = './relative-out';
  try {
    const result = reportsRootDefault();
    assert.ok(result.endsWith('relative-out'));
    assert.ok(result.startsWith('/'));
  } finally {
    process.env.CW_MONITOR_OUT = original;
  }
});

test('returns the default path when CW_MONITOR_OUT is undefined', () => {
  const original = process.env.CW_MONITOR_OUT;
  delete process.env.CW_MONITOR_OUT;
  try {
    const result = reportsRootDefault();
    assert.ok(result.endsWith('reports'));
    assert.ok(result.startsWith('/'));
  } finally {
    process.env.CW_MONITOR_OUT = original;
  }
});

test('returns the default path when CW_MONITOR_OUT is an empty string', () => {
  const original = process.env.CW_MONITOR_OUT;
  process.env.CW_MONITOR_OUT = '';
  try {
    const result = reportsRootDefault();
    assert.ok(result.endsWith('reports'));
    assert.ok(result.startsWith('/'));
  } finally {
    process.env.CW_MONITOR_OUT = original;
  }
});

test('returns a path that is always absolute regardless of environment variable', () => {
  const original = process.env.CW_MONITOR_OUT;
  process.env.CW_MONITOR_OUT = 'relative';
  try {
    const result = reportsRootDefault();
    assert.ok(result.startsWith('/'));
  } finally {
    process.env.CW_MONITOR_OUT = original;
  }
});
