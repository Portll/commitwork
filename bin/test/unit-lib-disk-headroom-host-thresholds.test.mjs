// Computes disk usage warn and fail percentage thresholds from environment (bin/lib/disk-headroom.mjs hostThresholds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostThresholds } from '../lib/disk-headroom.mjs';

test('returns default warn and fail percentages when env vars are unset', () => {
  const savedWarn = process.env.CW_DISK_WARN_PCT;
  const savedFail = process.env.CW_DISK_FAIL_PCT;
  delete process.env.CW_DISK_WARN_PCT;
  delete process.env.CW_DISK_FAIL_PCT;
  try {
    const r = hostThresholds();
    assert.deepEqual(r, { warnPct: { value: 15, source: "default" }, failPct: { value: 8, source: "default" } });
  } finally {
    if (savedWarn === undefined) delete process.env.CW_DISK_WARN_PCT;
    else process.env.CW_DISK_WARN_PCT = savedWarn;
    if (savedFail === undefined) delete process.env.CW_DISK_FAIL_PCT;
    else process.env.CW_DISK_FAIL_PCT = savedFail;
  }
});

test('returns env-sourced values when valid non-negative numbers are set', () => {
  const savedWarn = process.env.CW_DISK_WARN_PCT;
  const savedFail = process.env.CW_DISK_FAIL_PCT;
  process.env.CW_DISK_WARN_PCT = '20';
  process.env.CW_DISK_FAIL_PCT = '5';
  try {
    const r = hostThresholds();
    assert.deepEqual(r, { warnPct: { value: 20, source: "env" }, failPct: { value: 5, source: "env" } });
  } finally {
    if (savedWarn === undefined) delete process.env.CW_DISK_WARN_PCT;
    else process.env.CW_DISK_WARN_PCT = savedWarn;
    if (savedFail === undefined) delete process.env.CW_DISK_FAIL_PCT;
    else process.env.CW_DISK_FAIL_PCT = savedFail;
  }
});

test('falls back to default when env var is empty string', () => {
  const savedWarn = process.env.CW_DISK_WARN_PCT;
  const savedFail = process.env.CW_DISK_FAIL_PCT;
  process.env.CW_DISK_WARN_PCT = '';
  process.env.CW_DISK_FAIL_PCT = '';
  try {
    const r = hostThresholds();
    assert.deepEqual(r, { warnPct: { value: 15, source: "default" }, failPct: { value: 8, source: "default" } });
  } finally {
    if (savedWarn === undefined) delete process.env.CW_DISK_WARN_PCT;
    else process.env.CW_DISK_WARN_PCT = savedWarn;
    if (savedFail === undefined) delete process.env.CW_DISK_FAIL_PCT;
    else process.env.CW_DISK_FAIL_PCT = savedFail;
  }
});

test('falls back to default when env var is non-numeric', () => {
  const savedWarn = process.env.CW_DISK_WARN_PCT;
  const savedFail = process.env.CW_DISK_FAIL_PCT;
  process.env.CW_DISK_WARN_PCT = 'abc';
  process.env.CW_DISK_FAIL_PCT = 'xyz';
  try {
    const r = hostThresholds();
    assert.deepEqual(r, { warnPct: { value: 15, source: "default" }, failPct: { value: 8, source: "default" } });
  } finally {
    if (savedWarn === undefined) delete process.env.CW_DISK_WARN_PCT;
    else process.env.CW_DISK_WARN_PCT = savedWarn;
    if (savedFail === undefined) delete process.env.CW_DISK_FAIL_PCT;
    else process.env.CW_DISK_FAIL_PCT = savedFail;
  }
});

test('falls back to default when env var is negative', () => {
  const savedWarn = process.env.CW_DISK_WARN_PCT;
  const savedFail = process.env.CW_DISK_FAIL_PCT;
  process.env.CW_DISK_WARN_PCT = '-1';
  process.env.CW_DISK_FAIL_PCT = '-5';
  try {
    const r = hostThresholds();
    assert.deepEqual(r, { warnPct: { value: 15, source: "default" }, failPct: { value: 8, source: "default" } });
  } finally {
    if (savedWarn === undefined) delete process.env.CW_DISK_WARN_PCT;
    else process.env.CW_DISK_WARN_PCT = savedWarn;
    if (savedFail === undefined) delete process.env.CW_DISK_FAIL_PCT;
    else process.env.CW_DISK_FAIL_PCT = savedFail;
  }
});

test('falls back to default when env var is NaN string', () => {
  const savedWarn = process.env.CW_DISK_WARN_PCT;
  const savedFail = process.env.CW_DISK_FAIL_PCT;
  process.env.CW_DISK_WARN_PCT = 'NaN';
  process.env.CW_DISK_FAIL_PCT = 'Infinity';
  try {
    const r = hostThresholds();
    assert.deepEqual(r, { warnPct: { value: 15, source: "default" }, failPct: { value: 8, source: "default" } });
  } finally {
    if (savedWarn === undefined) delete process.env.CW_DISK_WARN_PCT;
    else process.env.CW_DISK_WARN_PCT = savedWarn;
    if (savedFail === undefined) delete process.env.CW_DISK_FAIL_PCT;
    else process.env.CW_DISK_FAIL_PCT = savedFail;
  }
});

test('uses env value for warn and default for fail when only warn is valid', () => {
  const savedWarn = process.env.CW_DISK_WARN_PCT;
  const savedFail = process.env.CW_DISK_FAIL_PCT;
  process.env.CW_DISK_WARN_PCT = '25';
  delete process.env.CW_DISK_FAIL_PCT;
  try {
    const r = hostThresholds();
    assert.deepEqual(r, { warnPct: { value: 25, source: "env" }, failPct: { value: 8, source: "default" } });
  } finally {
    if (savedWarn === undefined) delete process.env.CW_DISK_WARN_PCT;
    else process.env.CW_DISK_WARN_PCT = savedWarn;
    if (savedFail === undefined) delete process.env.CW_DISK_FAIL_PCT;
    else process.env.CW_DISK_FAIL_PCT = savedFail;
  }
});

test('uses default for warn and env value for fail when only fail is valid', () => {
  const savedWarn = process.env.CW_DISK_WARN_PCT;
  const savedFail = process.env.CW_DISK_FAIL_PCT;
  delete process.env.CW_DISK_WARN_PCT;
  process.env.CW_DISK_FAIL_PCT = '3';
  try {
    const r = hostThresholds();
    assert.deepEqual(r, { warnPct: { value: 15, source: "default" }, failPct: { value: 3, source: "env" } });
  } finally {
    if (savedWarn === undefined) delete process.env.CW_DISK_WARN_PCT;
    else process.env.CW_DISK_WARN_PCT = savedWarn;
    if (savedFail === undefined) delete process.env.CW_DISK_FAIL_PCT;
    else process.env.CW_DISK_FAIL_PCT = savedFail;
  }
});
