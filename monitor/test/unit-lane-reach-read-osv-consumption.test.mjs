// Extracts scanned file paths from osv-scanner log text (monitor/lane-reach.mjs readOsvConsumption).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOsvConsumption } from '../lane-reach.mjs';

test('returns empty set for empty string', () => {
  const r = readOsvConsumption('');
  assert.deepEqual(r, new Set([]));
});

test('returns empty set for text with no matches', () => {
  const r = readOsvConsumption('no scanner output here');
  assert.deepEqual(r, new Set([]));
});

test('strips /src/ prefix from matched path', () => {
  const r = readOsvConsumption('Scanned /src/package.json file and found 3 packages');
  assert.deepEqual(r, new Set(["package.json"]));
});

test('keeps path without /src/ prefix as-is', () => {
  const r = readOsvConsumption('Scanned package.json file and found 1 package');
  assert.deepEqual(r, new Set(["package.json"]));
});

test('collects multiple distinct paths into set', () => {
  const r = readOsvConsumption('Scanned /src/a.json file and found 1 package\nScanned /src/b.json file and found 2 packages');
  assert.deepEqual(r, new Set(["a.json", "b.json"]));
});

test('deduplicates identical paths in set', () => {
  const r = readOsvConsumption('Scanned /src/a.json file and found 1 package\nScanned /src/a.json file and found 2 packages');
  assert.deepEqual(r, new Set(["a.json"]));
});

test('handles non-string input by coercing to string', () => {
  const r = readOsvConsumption(null);
  assert.deepEqual(r, new Set([]));
});

test('matches multiple files in single line', () => {
  const r = readOsvConsumption('Scanned /src/x.json file and found 1 package Scanned /src/y.json file and found 2 packages');
  assert.deepEqual(r, new Set(["x.json", "y.json"]));
});
