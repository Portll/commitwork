// Folds a formatter run's parsed deviating files into a build-health status record (bin/lib/build-health-parse.mjs foldFormat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldFormat } from '../lib/build-health-parse.mjs';

const args = { lang: 'js', tool: 'eslint', declaredBy: 'package.json', command: 'eslint .' };
const base = { lang: 'js', ran: true, tool: 'eslint', declaredBy: 'package.json', command: 'eslint .' };
const noParser = 'no parser is registered for eslint \u2014 its output was not read, which is not conformance';
const exitedNote = (c) => `eslint exited ${c} but no deviating file could be parsed \u2014 it either failed to run or emits a format this parser does not match. Not clean, and not a count either.`;

test('null files with a successful run is unreadable with exit zero', () => {
  const r = foldFormat({ ...args, ok: true, code: 0, files: null });
  assert.deepEqual(r, { ...base, status: 'unreadable', exit: 0, deviationCount: null, note: noParser });
});

test('null files with a failed run keeps the exit code or null when absent', () => {
  const r = foldFormat({ ...args, ok: false, code: 2, files: null });
  assert.deepEqual(r, { ...base, status: 'unreadable', exit: 2, deviationCount: null, note: noParser });
  const u = foldFormat({ ...args, ok: false, code: undefined, files: null });
  assert.deepEqual(u, { ...base, status: 'unreadable', exit: null, deviationCount: null, note: noParser });
});

test('a failed run with no parsed files is unreadable and names the exit code', () => {
  const r = foldFormat({ ...args, ok: false, code: 1, files: [] });
  assert.deepEqual(r, { ...base, status: 'unreadable', exit: 1, deviationCount: null, note: exitedNote(1) });
});

test('a failed run with no parsed files and no code shows a question mark and null exit', () => {
  const r = foldFormat({ ...args, ok: false, code: undefined, files: [] });
  assert.deepEqual(r, { ...base, status: 'unreadable', exit: null, deviationCount: null, note: exitedNote('?') });
});

test('a successful run with no files is clean with exit zero', () => {
  const r = foldFormat({ ...args, ok: true, code: 0, files: [] });
  assert.deepEqual(r, { ...base, status: 'clean', exit: 0, deviationCount: 0, deviations: [] });
});

test('a successful run with files reports findings starting from the first file', () => {
  const r = foldFormat({ ...args, ok: true, code: 0, files: ['a.js', 'b.js'] });
  assert.deepEqual(r, { ...base, status: 'findings', exit: 0, deviationCount: 2, deviations: ['a.js', 'b.js'] });
});

test('a failed run with files reports findings with the exit code', () => {
  const r = foldFormat({ ...args, ok: false, code: 1, files: ['a.js'] });
  assert.deepEqual(r, { ...base, status: 'findings', exit: 1, deviationCount: 1, deviations: ['a.js'] });
});

test('exactly 200 files are all kept as deviations', () => {
  const files = Array.from({ length: 200 }, (_, i) => `file${i}.js`);
  const r = foldFormat({ ...args, ok: true, code: 0, files });
  assert.deepEqual(r, { ...base, status: 'findings', exit: 0, deviationCount: 200, deviations: files });
});

test('201 files are counted in full but deviations stop at 200', () => {
  const files = Array.from({ length: 201 }, (_, i) => `file${i}.js`);
  const r = foldFormat({ ...args, ok: true, code: 0, files });
  assert.deepEqual(r, { ...base, status: 'findings', exit: 0, deviationCount: 201, deviations: files.slice(0, 200) });
});
