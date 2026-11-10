// Builds the initial checkbox picker state with defaults and user overrides. (bin/lib/checkbox-tui.mjs initialPicker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPicker } from '../lib/checkbox-tui.mjs';

test('returns defaults when called with no arguments', () => {
  const r = initialPicker();
  assert.deepEqual(r, { cursor: 0, types: ["patch", "minor"], unchecked: new Set([]), lockfile: true, advisories: true, merge: false, trustRepo: false });
});

test('returns lockfile false when lockfile is false', () => {
  const r = initialPicker({ lockfile: false });
  assert.deepEqual(r, { cursor: 0, types: ["patch", "minor"], unchecked: new Set([]), lockfile: false, advisories: true, merge: false, trustRepo: false });
});

test('returns advisories false when advisories is false', () => {
  const r = initialPicker({ advisories: false });
  assert.deepEqual(r, { cursor: 0, types: ["patch", "minor"], unchecked: new Set([]), lockfile: true, advisories: false, merge: false, trustRepo: false });
});

test('returns merge true when merge is true', () => {
  const r = initialPicker({ merge: true });
  assert.deepEqual(r, { cursor: 0, types: ["patch", "minor"], unchecked: new Set([]), lockfile: true, advisories: true, merge: true, trustRepo: false });
});

test('returns trustRepo true when trustRepo is true', () => {
  const r = initialPicker({ trustRepo: true });
  assert.deepEqual(r, { cursor: 0, types: ["patch", "minor"], unchecked: new Set([]), lockfile: true, advisories: true, merge: false, trustRepo: true });
});

test('returns cursor 0 and copies types when types is provided', () => {
  const r = initialPicker({ types: ['major'] });
  assert.deepEqual(r, { cursor: 0, types: ["major"], unchecked: new Set([]), lockfile: true, advisories: true, merge: false, trustRepo: false });
});

test('returns empty unchecked set when no items are unchecked', () => {
  const r = initialPicker();
  assert.deepEqual(r, { cursor: 0, types: ["patch", "minor"], unchecked: new Set([]), lockfile: true, advisories: true, merge: false, trustRepo: false });
});

test('returns all defaults with explicit true values', () => {
  const r = initialPicker({ lockfile: true, advisories: true, merge: false, trustRepo: false });
  assert.deepEqual(r, { cursor: 0, types: ["patch", "minor"], unchecked: new Set([]), lockfile: true, advisories: true, merge: false, trustRepo: false });
});
