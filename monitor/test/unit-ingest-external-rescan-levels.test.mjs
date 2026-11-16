// Set of all legal re-scan level identifiers (monitor/ingest-external.mjs rescanLevels).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescanLevels, RESCAN_GROUPS, RESCAN_NONE } from '../ingest-external.mjs';
import { SCANNER_CHECKS } from '../scanner-checks.mjs';

const checkValues = [...new Set(Object.values(SCANNER_CHECKS))];

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
  assert.ok(checkValues.length > 0, 'SCANNER_CHECKS is empty, so this would pass having checked nothing');
  assert.deepEqual(checkValues.filter((c) => !r.has(c)), []);
});

// Equal sizes mean no check id collides with a group name or the none sentinel.
test('size equals number of distinct identifiers', () => {
  const r = rescanLevels();
  assert.equal(r.size, RESCAN_GROUPS.length + 1 + checkValues.length);
  assert.equal(r.has(RESCAN_NONE), true);
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
