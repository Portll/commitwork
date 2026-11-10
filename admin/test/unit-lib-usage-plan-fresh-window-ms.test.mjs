// Computes the fresh window duration in milliseconds from CW_USAGE_FRESH_MS or a 15-minute default (admin/lib/usage-plan.mjs freshWindowMs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshWindowMs } from '../lib/usage-plan.mjs';

test('returns 15 minutes in ms when CW_USAGE_FRESH_MS is unset', () => {
  const saved = process.env.CW_USAGE_FRESH_MS;
  delete process.env.CW_USAGE_FRESH_MS;
  try {
    assert.equal(freshWindowMs(), 15 * 60 * 1000);
  } finally {
    if (saved !== undefined) process.env.CW_USAGE_FRESH_MS = saved;
  }
});

test('returns the parsed value when CW_USAGE_FRESH_MS is a positive number', () => {
  const saved = process.env.CW_USAGE_FRESH_MS;
  process.env.CW_USAGE_FRESH_MS = '60000';
  try {
    assert.equal(freshWindowMs(), 60000);
  } finally {
    if (saved !== undefined) process.env.CW_USAGE_FRESH_MS = saved;
    else delete process.env.CW_USAGE_FRESH_MS;
  }
});

test('returns the default when CW_USAGE_FRESH_MS is zero', () => {
  const saved = process.env.CW_USAGE_FRESH_MS;
  process.env.CW_USAGE_FRESH_MS = '0';
  try {
    assert.equal(freshWindowMs(), 15 * 60 * 1000);
  } finally {
    if (saved !== undefined) process.env.CW_USAGE_FRESH_MS = saved;
    else delete process.env.CW_USAGE_FRESH_MS;
  }
});

test('returns the default when CW_USAGE_FRESH_MS is negative', () => {
  const saved = process.env.CW_USAGE_FRESH_MS;
  process.env.CW_USAGE_FRESH_MS = '-100';
  try {
    assert.equal(freshWindowMs(), 15 * 60 * 1000);
  } finally {
    if (saved !== undefined) process.env.CW_USAGE_FRESH_MS = saved;
    else delete process.env.CW_USAGE_FRESH_MS;
  }
});

test('returns the default when CW_USAGE_FRESH_MS is not a number', () => {
  const saved = process.env.CW_USAGE_FRESH_MS;
  process.env.CW_USAGE_FRESH_MS = 'abc';
  try {
    assert.equal(freshWindowMs(), 15 * 60 * 1000);
  } finally {
    if (saved !== undefined) process.env.CW_USAGE_FRESH_MS = saved;
    else delete process.env.CW_USAGE_FRESH_MS;
  }
});

test('returns the default when CW_USAGE_FRESH_MS is empty string', () => {
  const saved = process.env.CW_USAGE_FRESH_MS;
  process.env.CW_USAGE_FRESH_MS = '';
  try {
    assert.equal(freshWindowMs(), 15 * 60 * 1000);
  } finally {
    if (saved !== undefined) process.env.CW_USAGE_FRESH_MS = saved;
    else delete process.env.CW_USAGE_FRESH_MS;
  }
});

test('returns the parsed value for a very large positive number', () => {
  const saved = process.env.CW_USAGE_FRESH_MS;
  process.env.CW_USAGE_FRESH_MS = '999999999999';
  try {
    assert.equal(freshWindowMs(), 999999999999);
  } finally {
    if (saved !== undefined) process.env.CW_USAGE_FRESH_MS = saved;
    else delete process.env.CW_USAGE_FRESH_MS;
  }
});

test('returns the default when CW_USAGE_FRESH_MS is NaN string', () => {
  const saved = process.env.CW_USAGE_FRESH_MS;
  process.env.CW_USAGE_FRESH_MS = 'NaN';
  try {
    assert.equal(freshWindowMs(), 15 * 60 * 1000);
  } finally {
    if (saved !== undefined) process.env.CW_USAGE_FRESH_MS = saved;
    else delete process.env.CW_USAGE_FRESH_MS;
  }
});
