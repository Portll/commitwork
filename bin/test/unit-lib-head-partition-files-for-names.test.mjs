// Maps test names to the files that declare them (bin/lib/head-partition.mjs filesForNames).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filesForNames } from '../lib/head-partition.mjs';

test('returns empty result when names contain only non-strings or empty strings', () => {
  const r = filesForNames([42, null, '  ', 0, ''], [], () => '');
  assert.deepEqual(r, { files: [], unresolved: [], ambiguous: [] });
});

test('returns empty result when names are all whitespace strings', () => {
  const r = filesForNames(['   ', '\t\n'], [], () => '');
  assert.deepEqual(r, { files: [], unresolved: [], ambiguous: [] });
});

test('returns empty result when names array is empty', () => {
  const r = filesForNames([], [], () => '');
  assert.deepEqual(r, { files: [], unresolved: [], ambiguous: [] });
});

test('marks name as unresolved when no file contains it', () => {
  const r = filesForNames(['missing'], ['a.js'], () => 'other content');
  assert.deepEqual(r, { files: [], unresolved: ["missing"], ambiguous: [] });
});

test('selects single file when exactly one file contains the name', () => {
  const r = filesForNames(['foo'], ['a.js', 'b.js'], (f) => f === 'a.js' ? 'foo here' : 'bar here');
  assert.deepEqual(r, { files: ["a.js"], unresolved: [], ambiguous: [] });
});

test('marks name as ambiguous when multiple files contain it', () => {
  const r = filesForNames(['foo'], ['a.js', 'b.js'], () => 'foo here');
  assert.deepEqual(r, { files: ["a.js", "b.js"], unresolved: [], ambiguous: [{ name: "foo", files: ["a.js", "b.js"] }] });
});

test('deduplicates repeated names in input', () => {
  const r = filesForNames(['foo', 'foo', 'foo'], ['a.js'], () => 'foo');
  assert.deepEqual(r, { files: ["a.js"], unresolved: [], ambiguous: [] });
});

test('handles multiple names with mixed resolution outcomes', () => {
  const r = filesForNames(['foo', 'bar', 'baz'], ['a.js', 'b.js'], (f) => f === 'a.js' ? 'foo bar' : 'foo baz');
  assert.deepEqual(r, { files: ["a.js", "b.js"], unresolved: [], ambiguous: [{ name: "foo", files: ["a.js", "b.js"] }] });
});

test('skips unreadable files without treating them as no-match', () => {
  const r = filesForNames(['foo'], ['a.js', 'b.js'], (f) => { if (f === 'a.js') throw new Error('nope'); return 'foo'; });
  assert.deepEqual(r, { files: ["b.js"], unresolved: [], ambiguous: [] });
});

test('returns empty result when single name is whitespace only', () => {
  const r = filesForNames(['  '], ['a.js'], () => '  ');
  assert.deepEqual(r, { files: [], unresolved: [], ambiguous: [] });
});
