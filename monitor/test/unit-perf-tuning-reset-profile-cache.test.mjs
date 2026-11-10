// Clears the module-level profile cache and its source marker (monitor/perf-tuning.mjs resetProfileCache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetProfileCache } from '../perf-tuning.mjs';

test('returns undefined when called with no arguments', () => {
  const r = resetProfileCache();
  assert.equal(r, undefined);
});

test('returns undefined when called with a string argument', () => {
  const r = resetProfileCache('x');
  assert.equal(r, undefined);
});

test('returns undefined when called with a number argument', () => {
  const r = resetProfileCache(0);
  assert.equal(r, undefined);
});

test('returns undefined when called with a boolean argument', () => {
  const r = resetProfileCache(true);
  assert.equal(r, undefined);
});

test('returns undefined when called with a null argument', () => {
  const r = resetProfileCache(null);
  assert.equal(r, undefined);
});

test('returns undefined when called with an object argument', () => {
  const r = resetProfileCache({});
  assert.equal(r, undefined);
});

test('returns undefined when called with an array argument', () => {
  const r = resetProfileCache([]);
  assert.equal(r, undefined);
});

test('returns undefined when called with a symbol argument', () => {
  const r = resetProfileCache(Symbol('s'));
  assert.equal(r, undefined);
});
