// Identity gate verdict and offender summary for a scan result (bin/release-candidate.mjs identityReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityReport } from '../release-candidate.mjs';

const pathsOf = (n) => Array.from({ length: n }, (_, i) => `src/file${i}.txt`);
const scope = { fingerprint: 'fp', words: [] };

test('passes with empty details when no paths or content offend', () => {
  const r = identityReport({ paths: [], content: [] }, { fingerprint: 'fp' });
  assert.deepEqual(r, {
    gate: 'identity',
    status: 'pass',
    detail: { scope: 'fp', offendingPaths: [], offendingFiles: 0, rows: [], rowCount: 0 },
  });
});

test('copies the scope fingerprint into the detail', () => {
  const r = identityReport({ paths: [], content: [] }, { fingerprint: 'abc123' });
  assert.deepEqual(r, {
    gate: 'identity',
    status: 'pass',
    detail: { scope: 'abc123', offendingPaths: [], offendingFiles: 0, rows: [], rowCount: 0 },
  });
});

test('fails when a single path offends even though no content does', () => {
  const r = identityReport({ paths: pathsOf(1), content: [] }, scope);
  assert.equal(r.gate, 'identity');
  assert.equal(r.status, 'fail');
  const { offendingPaths, ...rest } = r.detail;
  assert.equal(offendingPaths.length, 1);
  assert.deepEqual(rest, { scope: 'fp', offendingFiles: 0, rows: [], rowCount: 0 });
});

test('keeps all 49 paths when under the cap of 50', () => {
  const r = identityReport({ paths: pathsOf(49), content: [] }, scope);
  assert.equal(r.status, 'fail');
  assert.equal(r.detail.offendingPaths.length, 49);
  assert.equal(r.detail.rowCount, 0);
});

test('keeps all 50 paths when exactly at the cap', () => {
  const r = identityReport({ paths: pathsOf(50), content: [] }, scope);
  assert.equal(r.status, 'fail');
  assert.equal(r.detail.offendingPaths.length, 50);
  assert.equal(r.detail.offendingFiles, 0);
});

test('truncates to 50 paths when 51 offend', () => {
  const r = identityReport({ paths: pathsOf(51), content: [] }, scope);
  assert.equal(r.status, 'fail');
  assert.equal(r.detail.offendingPaths.length, 50);
  assert.deepEqual(r.detail.rows, []);
});

test('truncates to 50 paths when far more offend', () => {
  const r = identityReport({ paths: pathsOf(120), content: [] }, scope);
  assert.equal(r.status, 'fail');
  assert.equal(r.detail.offendingPaths.length, 50);
  assert.equal(r.detail.rowCount, 0);
});
