// Maps a label to its canonical alias name (lib/chain-lexicon.mjs canonical).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../chain-lexicon.mjs';

test('returns intact for the ok alias', () => {
  assert.equal(canonical('ok'), "intact");
});

test('returns broken for the chain-broken alias', () => {
  assert.equal(canonical('chain-broken'), "broken");
});

test('returns never-measured for the absent-not-running alias', () => {
  assert.equal(canonical('absent-not-running'), "never-measured");
});

test('returns the label unchanged when it is not an alias', () => {
  assert.equal(canonical('intact'), "intact");
});

test('returns the label unchanged for an empty string', () => {
  assert.equal(canonical(''), "");
});

test('returns the label unchanged for a long non-alias string', () => {
  const label = 'x'.repeat(100);
  assert.equal(canonical(label), "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
});

test('returns the label unchanged for a string that looks like a prototype key', () => {
  assert.equal(canonical('constructor'), "constructor");
});

test('returns the label unchanged for a string that is a property of Object.prototype', () => {
  assert.equal(canonical('toString'), "toString");
});
