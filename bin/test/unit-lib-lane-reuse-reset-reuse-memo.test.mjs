// Clears the tooBig memo set (bin/lib/lane-reuse.mjs resetReuseMemo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetReuseMemo } from '../lib/lane-reuse.mjs';

test('returns undefined when called with no arguments', () => {
  const r = resetReuseMemo();
  assert.equal(r, undefined);
});

test('returns undefined when called with a string argument', () => {
  const r = resetReuseMemo('some-key');
  assert.equal(r, undefined);
});

test('returns undefined when called with a number argument', () => {
  const r = resetReuseMemo(42);
  assert.equal(r, undefined);
});

test('returns undefined when called with a boolean argument', () => {
  const r = resetReuseMemo(true);
  assert.equal(r, undefined);
});

test('returns undefined when called with a null argument', () => {
  const r = resetReuseMemo(null);
  assert.equal(r, undefined);
});

test('returns undefined when called with an object argument', () => {
  const r = resetReuseMemo({ key: 'value' });
  assert.equal(r, undefined);
});

test('returns undefined when called with an array argument', () => {
  const r = resetReuseMemo([1, 2, 3]);
  assert.equal(r, undefined);
});

test('returns undefined when called with a symbol argument', () => {
  const r = resetReuseMemo(Symbol('test'));
  assert.equal(r, undefined);
});
