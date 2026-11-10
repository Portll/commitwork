// normalizes a name to a safe slug or null (monitor/registry.mjs ownArea).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownArea } from '../registry.mjs';

test('returns the input when it is a valid slug', () => {
  assert.equal(ownArea('abc'), "abc");
});

test('returns the input when it is a single lowercase letter', () => {
  assert.equal(ownArea('a'), "a");
});

test('returns the input when it is a single digit', () => {
  assert.equal(ownArea('0'), "0");
});

test('returns the input when it contains a hyphen', () => {
  assert.equal(ownArea('a-b'), "a-b");
});

test('returns null when the input is an empty string', () => {
  assert.equal(ownArea(''), null);
});

test('returns null when the input is undefined', () => {
  assert.equal(ownArea(undefined), null);
});

test('returns null when the input is null', () => {
  assert.equal(ownArea(null), null);
});

test('returns null when the input starts with a hyphen', () => {
  assert.equal(ownArea('-abc'), null);
});

test('returns null when the input contains an uppercase letter', () => {
  assert.equal(ownArea('Abc'), null);
});

test('returns null when the input contains a space', () => {
  assert.equal(ownArea('a b'), null);
});
