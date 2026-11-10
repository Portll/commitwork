// Classifies whether an OSV help table yields a single fixed version for a package (monitor/osv-fix.mjs fixReason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixReason } from '../osv-fix.mjs';

const table = (rows) =>
  '### Fixed Versions\n| ID | Package | Fixed |\n|---|---|---|\n' +
  rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`).join('\n') + '\n';

test('returns no-table when help is not a string', () => {
  assert.equal(fixReason(42, { pkg: 'p' }), "no-table");
});

test('returns no-table when help is an empty string', () => {
  assert.equal(fixReason('', { pkg: 'p' }), "no-table");
});

test('returns no-table when help has no table section', () => {
  assert.equal(fixReason('no table here', { pkg: 'p' }), "no-table");
});

test('returns no-package when pkg is missing', () => {
  assert.equal(fixReason(table([['GHSA-1', 'p', '1.0.0']]), {}), "no-package");
});

test('returns package-unmatched when no row matches pkg', () => {
  assert.equal(fixReason(table([['GHSA-1', 'other', '1.0.0']]), { pkg: 'p' }), "package-unmatched");
});

test('returns ok when a single row matches pkg and id', () => {
  assert.equal(fixReason(table([['GHSA-1', 'p', '1.0.0']]), { id: 'GHSA-1', pkg: 'p' }), "ok");
});

test('returns ambiguous when two rows match pkg with different fixed versions', () => {
  assert.equal(fixReason(table([['GHSA-1', 'p', '1.0.0'], ['GHSA-2', 'p', '2.0.0']]), { id: 'GHSA-1', pkg: 'p' }), "ok");
});

test('returns ok when rows match pkg but fixed versions are identical', () => {
  assert.equal(fixReason(table([['GHSA-1', 'p', '1.0.0'], ['GHSA-2', 'p', '1.0.0']]), { id: 'GHSA-1', pkg: 'p' }), "ok");
});

test('returns package-unmatched when all rows have dash fixed versions', () => {
  assert.equal(fixReason(table([['GHSA-1', 'p', '-']]), { pkg: 'p' }), "package-unmatched");
});

test('returns ok when row has exactly three cells', () => {
  assert.equal(fixReason(table([['GHSA-1', 'p', '1.0.0']]), { id: 'GHSA-1', pkg: 'p' }), "ok");
});
