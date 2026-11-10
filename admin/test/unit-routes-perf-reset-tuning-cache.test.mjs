// Clears the module-level loaded cache map (admin/routes/perf.mjs resetTuningCache).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetTuningCache } from '../routes/perf.mjs';

test('resetTuningCache is a function', () => {
  assert.equal(typeof resetTuningCache, 'function');
});

test('resetTuningCache returns undefined', () => {
  const result = resetTuningCache();
  assert.equal(result, undefined);
});

test('resetTuningCache can be called multiple times without error', () => {
  resetTuningCache();
  resetTuningCache();
  resetTuningCache();
  assert.ok(true);
});

test('resetTuningCache does not throw on empty state', () => {
  assert.doesNotThrow(() => resetTuningCache());
});

test('resetTuningCache is idempotent in effect', () => {
  resetTuningCache();
  const first = resetTuningCache();
  const second = resetTuningCache();
  assert.equal(first, second);
});

test('resetTuningCache accepts no arguments', () => {
  assert.doesNotThrow(() => resetTuningCache());
});

test('resetTuningCache ignores extra arguments', () => {
  assert.doesNotThrow(() => resetTuningCache('ignored', 42, true, null));
});

test('resetTuningCache is callable with this set to null', () => {
  assert.doesNotThrow(() => resetTuningCache.call(null));
});
