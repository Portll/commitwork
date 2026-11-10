// Maps a temperature value to a sampling label or null (lib/model-provider.mjs samplingOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samplingOf } from '../model-provider.mjs';

test('returns the model default label when temperature is null', () => {
  const r = samplingOf(null);
  assert.equal(r, "model-default");
});

test('returns the model default label when temperature is undefined', () => {
  const r = samplingOf(undefined);
  assert.equal(r, null);
});

test('returns a pinned label when temperature is a finite number', () => {
  const r = samplingOf(0.7);
  assert.equal(r, "pinned-0.7");
});

test('returns a pinned label when temperature is zero', () => {
  const r = samplingOf(0);
  assert.equal(r, "pinned-0");
});

test('returns a pinned label when temperature is a negative finite number', () => {
  const r = samplingOf(-1.5);
  assert.equal(r, "pinned--1.5");
});

test('returns null when temperature is NaN', () => {
  const r = samplingOf(NaN);
  assert.equal(r, null);
});

test('returns null when temperature is positive infinity', () => {
  const r = samplingOf(Infinity);
  assert.equal(r, null);
});

test('returns null when temperature is a string', () => {
  const r = samplingOf('0.5');
  assert.equal(r, null);
});

test('returns null when temperature is an object', () => {
  const r = samplingOf({});
  assert.equal(r, null);
});
