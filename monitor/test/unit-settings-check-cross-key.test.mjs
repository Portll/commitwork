// Validates that sweepKillMs is strictly greater than sweepHangMs (monitor/settings.mjs checkCrossKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCrossKey } from '../settings.mjs';

test('returns empty array when kill is null', () => {
  const r = checkCrossKey({ sweepHangMs: 100, sweepKillMs: null });
  assert.deepEqual(r, []);
});

test('returns empty array when kill is undefined', () => {
  const r = checkCrossKey({ sweepHangMs: 100, sweepKillMs: undefined });
  assert.deepEqual(r, []);
});

test('returns empty array when kill is NaN', () => {
  const r = checkCrossKey({ sweepHangMs: 100, sweepKillMs: NaN });
  assert.deepEqual(r, []);
});

test('returns empty array when hang is NaN', () => {
  const r = checkCrossKey({ sweepHangMs: NaN, sweepKillMs: 200 });
  assert.deepEqual(r, []);
});

test('returns empty array when kill is greater than hang', () => {
  const r = checkCrossKey({ sweepHangMs: 100, sweepKillMs: 200 });
  assert.deepEqual(r, []);
});

test('returns error when kill equals hang', () => {
  const r = checkCrossKey({ sweepHangMs: 100, sweepKillMs: 100 });
  assert.deepEqual(r, ["sweepKillMs (100) must be GREATER than sweepHangMs (100) \u2014 a kill threshold at or below the hang threshold would kill sweeps it had never warned about"]);
});

test('returns error when kill is less than hang', () => {
  const r = checkCrossKey({ sweepHangMs: 100, sweepKillMs: 50 });
  assert.deepEqual(r, ["sweepKillMs (50) must be GREATER than sweepHangMs (100) \u2014 a kill threshold at or below the hang threshold would kill sweeps it had never warned about"]);
});

test('returns empty array when hang is null and kill is finite', () => {
  const r = checkCrossKey({ sweepHangMs: null, sweepKillMs: 200 });
  assert.deepEqual(r, []);
});
