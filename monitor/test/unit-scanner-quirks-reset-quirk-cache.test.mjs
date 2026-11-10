// resets the module-level quirk cache to null (monitor/scanner-quirks.mjs resetQuirkCache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetQuirkCache } from '../scanner-quirks.mjs';

test('returns undefined when called with no arguments', () => {
  const r = resetQuirkCache();
  assert.equal(r, undefined);
});

test('returns undefined when called with a string argument', () => {
  const r = resetQuirkCache('test-input');
  assert.equal(r, undefined);
});

test('returns undefined when called with a number argument', () => {
  const r = resetQuirkCache(42);
  assert.equal(r, undefined);
});

test('returns undefined when called with a boolean argument', () => {
  const r = resetQuirkCache(true);
  assert.equal(r, undefined);
});

test('returns undefined when called with an object argument', () => {
  const r = resetQuirkCache({ key: 'value' });
  assert.equal(r, undefined);
});

test('returns undefined when called with an array argument', () => {
  const r = resetQuirkCache([1, 2, 3]);
  assert.equal(r, undefined);
});

test('returns undefined when called with null argument', () => {
  const r = resetQuirkCache(null);
  assert.equal(r, undefined);
});

test('returns undefined when called with undefined argument', () => {
  const r = resetQuirkCache(undefined);
  assert.equal(r, undefined);
});
