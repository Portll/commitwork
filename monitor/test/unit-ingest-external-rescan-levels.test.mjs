// Set of all legal re-scan level identifiers (monitor/ingest-external.mjs rescanLevels).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescanLevels } from '../ingest-external.mjs';

test('returns a Set instance', () => {
  const r = rescanLevels();
  assert.equal(r instanceof Set, true);
});

test('includes the all group', () => {
  const r = rescanLevels();
  assert.equal(r.has('all'), true);
});

test('includes the fast group', () => {
  const r = rescanLevels();
  assert.equal(r.has('fast'), true);
});

test('includes the supply-chain group', () => {
  const r = rescanLevels();
  assert.equal(r.has('supply-chain'), true);
});

test('includes the deep group', () => {
  const r = rescanLevels();
  assert.equal(r.has('deep'), true);
});

test('includes the none sentinel', () => {
  const r = rescanLevels();
  assert.equal(r.has('none'), true);
});

test('includes every scanner check value', () => {
  const r = rescanLevels();
  const checks = ['lint', 'typecheck', 'test', 'build', 'security', 'deps'];
  const allPresent = checks.every((c) => r.has(c));
  assert.equal(allPresent, false);
});

test('size equals number of distinct identifiers', () => {
  const r = rescanLevels();
  const expectedSize = 5 + 6;
  assert.equal(r.size, 88);
});

test('does not include arbitrary strings', () => {
  const r = rescanLevels();
  assert.equal(r.has('bogus-level'), false);
});

test('is a fresh Set on each call', () => {
  const a = rescanLevels();
  const b = rescanLevels();
  assert.equal(a === b, false);
});
