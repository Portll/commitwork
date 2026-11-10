// Maps a rule set and match metadata to a severity label (bin/yara-witness.mjs sevFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sevFor } from '../yara-witness.mjs';

test('returns high when score is 80', () => {
  assert.equal(sevFor({}, { score: 80 }), 'high');
});

test('returns high when score is 100', () => {
  assert.equal(sevFor({}, { score: 100 }), 'high');
});

test('returns med when score is 79', () => {
  assert.equal(sevFor({}, { score: 79 }), 'med');
});

test('returns med when score is 60', () => {
  assert.equal(sevFor({}, { score: 60 }), 'med');
});

test('returns low when score is 59', () => {
  assert.equal(sevFor({}, { score: 59 }), 'low');
});

test('returns low when score is 0', () => {
  assert.equal(sevFor({}, { score: 0 }), 'low');
});

test('returns defaultSev when score is not finite', () => {
  assert.equal(sevFor({ defaultSev: 'high' }, { score: 'noise' }), 'high');
});

test('returns med when score is not finite and defaultSev is missing', () => {
  assert.equal(sevFor({}, { score: undefined }), 'med');
});

test('returns defaultSev when score is NaN', () => {
  assert.equal(sevFor({ defaultSev: 'low' }, { score: NaN }), 'low');
});

test('returns low when score is null', () => {
  assert.equal(sevFor({ defaultSev: 'med' }, { score: null }), 'low');
});
