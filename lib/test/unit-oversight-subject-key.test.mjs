// Computes a unique key from a subject's repo, file, rule, and package fields (lib/oversight.mjs subjectKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectKey } from '../oversight.mjs';

test('returns null when the input is null', () => {
  const r = subjectKey(null);
  assert.equal(r, null);
});

test('returns null when the input is a string', () => {
  const r = subjectKey('hello');
  assert.equal(r, null);
});

test('returns null when the input is a number', () => {
  const r = subjectKey(42);
  assert.equal(r, null);
});

test('returns null when the input is an empty object', () => {
  const r = subjectKey({});
  assert.equal(r, null);
});

test('returns null when all fields are null', () => {
  const r = subjectKey({ repo: null, file: null, rule: null, package: null });
  assert.equal(r, null);
});

test('returns null when all fields are empty strings', () => {
  const r = subjectKey({ repo: '', file: '', rule: '', package: '' });
  assert.equal(r, null);
});

test('returns the joined key when only repo is set', () => {
  const r = subjectKey({ repo: 'myrepo', file: null, rule: null, package: null });
  assert.equal(r, "myrepo\u0000\u0000\u0000");
});

test('returns the joined key when only file is set', () => {
  const r = subjectKey({ repo: null, file: 'src/index.js', rule: null, package: null });
  assert.equal(r, "\u0000src/index.js\u0000\u0000");
});

test('returns the joined key when only rule is set', () => {
  const r = subjectKey({ repo: null, file: null, rule: 'no-unused-vars', package: null });
  assert.equal(r, "\u0000\u0000no-unused-vars\u0000");
});

test('returns the joined key when only package is set', () => {
  const r = subjectKey({ repo: null, file: null, rule: null, package: 'lodash' });
  assert.equal(r, "\u0000\u0000\u0000lodash");
});

test('returns the joined key when all fields are set', () => {
  const r = subjectKey({ repo: 'myrepo', file: 'src/index.js', rule: 'no-unused-vars', package: 'lodash' });
  assert.equal(r, "myrepo\u0000src/index.js\u0000no-unused-vars\u0000lodash");
});

test('returns the joined key when fields contain spaces', () => {
  const r = subjectKey({ repo: 'my repo', file: 'src/my file.js', rule: 'no unused vars', package: 'my package' });
  assert.equal(r, "my repo\u0000src/my file.js\u0000no unused vars\u0000my package");
});

test('returns the joined key when fields contain NUL characters', () => {
  const r = subjectKey({ repo: 'a\u0000b', file: 'c\u0000d', rule: 'e\u0000f', package: 'g\u0000h' });
  assert.equal(r, "a\u0000b\u0000c\u0000d\u0000e\u0000f\u0000g\u0000h");
});

test('returns the joined key when fields are non-string primitives', () => {
  const r = subjectKey({ repo: 123, file: 456, rule: 789, package: 1011 });
  assert.equal(r, "123\u0000456\u0000789\u00001011");
});

test('returns the joined key when fields are boolean values', () => {
  const r = subjectKey({ repo: true, file: false, rule: true, package: false });
  assert.equal(r, "true\u0000false\u0000true\u0000false");
});

test('returns the joined key when fields are arrays', () => {
  const r = subjectKey({ repo: ['a'], file: ['b'], rule: ['c'], package: ['d'] });
  assert.equal(r, "a\u0000b\u0000c\u0000d");
});

test('returns the joined key when fields are nested objects', () => {
  const r = subjectKey({ repo: { name: 'a' }, file: { name: 'b' }, rule: { name: 'c' }, package: { name: 'd' } });
  assert.equal(r, "[object Object]\u0000[object Object]\u0000[object Object]\u0000[object Object]");
});

test('returns the joined key when some fields are undefined', () => {
  const r = subjectKey({ repo: 'myrepo', file: undefined, rule: undefined, package: undefined });
  assert.equal(r, "myrepo\u0000\u0000\u0000");
});

test('returns the joined key when fields are zero', () => {
  const r = subjectKey({ repo: 0, file: 0, rule: 0, package: 0 });
  assert.equal(r, "0\u00000\u00000\u00000");
});

test('returns the joined key when fields are false', () => {
  const r = subjectKey({ repo: false, file: false, rule: false, package: false });
  assert.equal(r, "false\u0000false\u0000false\u0000false");
});
