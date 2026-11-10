// Clears the committed-cache map (monitor/history-chain.mjs _clearCommittedCache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _clearCommittedCache } from '../history-chain.mjs';

test('returns undefined when called with no arguments', () => {
  const r = _clearCommittedCache();
  assert.equal(r, undefined);
});

test('returns undefined when called with a string argument', () => {
  const r = _clearCommittedCache('some-key');
  assert.equal(r, undefined);
});

test('returns undefined when called with a number argument', () => {
  const r = _clearCommittedCache(42);
  assert.equal(r, undefined);
});

test('returns undefined when called with a boolean argument', () => {
  const r = _clearCommittedCache(true);
  assert.equal(r, undefined);
});

test('returns undefined when called with an object argument', () => {
  const r = _clearCommittedCache({ a: 1 });
  assert.equal(r, undefined);
});

test('returns undefined when called with an array argument', () => {
  const r = _clearCommittedCache([1, 2, 3]);
  assert.equal(r, undefined);
});

test('returns undefined when called with a null argument', () => {
  const r = _clearCommittedCache(null);
  assert.equal(r, undefined);
});

test('returns undefined when called with a symbol argument', () => {
  const r = _clearCommittedCache(Symbol('test'));
  assert.equal(r, undefined);
});
