// Computes a sweep-area verdict grade (admin/routes/rollups.mjs gradeVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeVerdict } from '../routes/rollups.mjs';

test('returns null when record is missing', () => {
  assert.equal(gradeVerdict(null), null);
});

test('returns null when kind is not sweep-area-verdict', () => {
  assert.equal(gradeVerdict({ kind: 'other' }), null);
});

test('returns empty when rollup is nothing-to-roll-up and resolved is 0', () => {
  const rec = { kind: 'sweep-area-verdict', rollup: 'nothing-to-roll-up', repos: { resolved: 0 } };
  assert.equal(gradeVerdict(rec), 'empty');
});

test('returns broken when rollup is not published', () => {
  const rec = { kind: 'sweep-area-verdict', rollup: 'draft', repos: { scans: [] } };
  assert.equal(gradeVerdict(rec), 'broken');
});

test('returns broken when any scan has ran false', () => {
  const rec = { kind: 'sweep-area-verdict', rollup: 'published', repos: { scans: [{ ran: false }] } };
  assert.equal(gradeVerdict(rec), 'broken');
});

test('returns warn when issues is failed', () => {
  const rec = { kind: 'sweep-area-verdict', rollup: 'published', repos: { scans: [] }, issues: 'failed' };
  assert.equal(gradeVerdict(rec), 'warn');
});

test('returns warn when a step value is not ok or skipped', () => {
  const rec = { kind: 'sweep-area-verdict', rollup: 'published', repos: { scans: [] }, steps: { build: 'error' } };
  assert.equal(gradeVerdict(rec), 'warn');
});

test('returns warn when preflight blind is greater than 0', () => {
  const rec = { kind: 'sweep-area-verdict', rollup: 'published', repos: { scans: [] }, preflight: { blind: 1 } };
  assert.equal(gradeVerdict(rec), 'warn');
});

test('returns good when all checks pass', () => {
  const rec = { kind: 'sweep-area-verdict', rollup: 'published', repos: { scans: [] }, steps: { build: 'ok' }, finalize: { push: 'skipped' } };
  assert.equal(gradeVerdict(rec), 'good');
});

test('returns good when preflight blind is 0', () => {
  const rec = { kind: 'sweep-area-verdict', rollup: 'published', repos: { scans: [] }, preflight: { blind: 0 } };
  assert.equal(gradeVerdict(rec), 'good');
});
