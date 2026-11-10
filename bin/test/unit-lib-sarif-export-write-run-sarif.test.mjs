// Per-repository SARIF logs written for a run, summarised per repository (bin/lib/sarif-export.mjs writeRunSarif).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeRunSarif } from '../lib/sarif-export.mjs';

const NUL_FILE = '/\u0000/x';
const base = { runDir: '/r', toolVersion: '1.0.0', generatedAt: '2026-10-31T00:00:00.000Z' };

test('refuses a single output file for a run with two repositories', () => {
  assert.throws(
    () => writeRunSarif({
      ...base,
      rows: [{ slug: 'b', repo: '/r/b', cells: {} }, { slug: 'a', repo: '/r/a', cells: {} }],
      file: NUL_FILE,
    }),
    { name: 'Error', message: 'a single SARIF file holds one repository; this run has 2' },
  );
});

test('refuses a single output file for a run with no repositories', () => {
  assert.throws(
    () => writeRunSarif({ ...base, rows: [], file: NUL_FILE }),
    { name: 'Error', message: 'a single SARIF file holds one repository; this run has 0' },
  );
});

test('returns an empty list when the run has no repositories and no file is given', () => {
  assert.deepEqual(writeRunSarif({ ...base, rows: [] }), []);
});

test('accepts a single output file for exactly one repository and goes on to read its slug', () => {
  assert.throws(
    () => writeRunSarif({ ...base, rows: [null], file: NUL_FILE }),
    { name: 'TypeError', message: "Cannot read properties of null (reading 'slug')" },
  );
});

test('goes on to read the slug of the only repository when no file is given', () => {
  assert.throws(
    () => writeRunSarif({ ...base, rows: [{}] }),
    { name: 'TypeError', message: 'The "path" argument must be of type string. Received undefined' },
  );
});

test('lets two repositories past the guard when no file is given', () => {
  assert.throws(
    () => writeRunSarif({ ...base, rows: [{}, { slug: 'a', repo: '/r/a', cells: {} }] }),
    { name: 'TypeError', message: 'The "path" argument must be of type string. Received undefined' },
  );
});

test('creates the parent folder of the requested file before writing the log there', () => {
  assert.throws(
    () => writeRunSarif({ ...base, rows: [{ slug: 'a', repo: '/r/a', cells: {} }], file: NUL_FILE }),
    {
      name: 'TypeError',
      message: "The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received '/\\x00'",
    },
  );
});
