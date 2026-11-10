// Clears the deduped warning set (monitor/settings.mjs resetSettingsWarnings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetSettingsWarnings } from '../settings.mjs';

test('returns undefined when called with no arguments', () => {
  const r = resetSettingsWarnings();
  assert.equal(r, undefined);
});

test('returns undefined when called with a string argument', () => {
  const r = resetSettingsWarnings('some-message');
  assert.equal(r, undefined);
});

test('returns undefined when called with a number argument', () => {
  const r = resetSettingsWarnings(42);
  assert.equal(r, undefined);
});

test('returns undefined when called with a boolean argument', () => {
  const r = resetSettingsWarnings(true);
  assert.equal(r, undefined);
});

test('returns undefined when called with a null argument', () => {
  const r = resetSettingsWarnings(null);
  assert.equal(r, undefined);
});

test('returns undefined when called with an object argument', () => {
  const r = resetSettingsWarnings({ key: 'value' });
  assert.equal(r, undefined);
});

test('returns undefined when called with an array argument', () => {
  const r = resetSettingsWarnings(['a', 'b', 'c']);
  assert.equal(r, undefined);
});

test('returns undefined when called with a symbol argument', () => {
  const r = resetSettingsWarnings(Symbol('test'));
  assert.equal(r, undefined);
});
