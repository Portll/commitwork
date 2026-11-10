// Clears the module-level memo map (monitor/rollup-head.mjs resetRollupHeadCache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetRollupHeadCache } from '../rollup-head.mjs';

test('returns undefined when called with no arguments', () => {
  const r = resetRollupHeadCache();
  assert.equal(r, undefined);
});

test('returns undefined when called with a string argument', () => {
  const r = resetRollupHeadCache('some-string');
  assert.equal(r, undefined);
});

test('returns undefined when called with a number argument', () => {
  const r = resetRollupHeadCache(42);
  assert.equal(r, undefined);
});

test('returns undefined when called with a boolean argument', () => {
  const r = resetRollupHeadCache(true);
  assert.equal(r, undefined);
});

test('returns undefined when called with a null argument', () => {
  const r = resetRollupHeadCache(null);
  assert.equal(r, undefined);
});

test('returns undefined when called with an object argument', () => {
  const r = resetRollupHeadCache({ key: 'value' });
  assert.equal(r, undefined);
});

test('returns undefined when called with an array argument', () => {
  const r = resetRollupHeadCache([1, 2, 3]);
  assert.equal(r, undefined);
});

test('returns undefined when called with a symbol argument', () => {
  const r = resetRollupHeadCache(Symbol('test'));
  assert.equal(r, undefined);
});
