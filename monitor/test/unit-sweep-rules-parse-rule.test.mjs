// Validates a sweep rule row and returns a normalized rule or a list of errors (monitor/sweep-rules.mjs parseRule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRule } from '../sweep-rules.mjs';

test('returns ok false with type error when row is null', () => {
  const res = parseRule(null);
  assert.deepEqual(res, { ok: false, errors: ['row must be an object, got null'] });
});

test('returns ok false with type error when row is an array', () => {
  const res = parseRule([]);
  assert.deepEqual(res, { ok: false, errors: ['row must be an object, got array'] });
});

test('returns ok false with type error when row is a string', () => {
  const res = parseRule('hello');
  assert.deepEqual(res, { ok: false, errors: ['row must be an object, got string'] });
});

test('returns ok false with include error when include is undefined', () => {
  const res = parseRule({ directory: 'src', name: 'test.js' });
  assert.deepEqual(res, { ok: false, errors: ['include must be a boolean (include-or-exclude), got undefined'] });
});

test('returns ok false with include error when include is a string', () => {
  const res = parseRule({ include: 'yes', directory: 'src', name: 'test.js' });
  assert.deepEqual(res, { ok: false, errors: ['include must be a boolean (include-or-exclude), got string'] });
});

test('returns ok false with directory error when directory is undefined', () => {
  const res = parseRule({ include: true, name: 'test.js' });
  assert.deepEqual(res, { ok: false, errors: ["directory must be a string, got undefined (no wildcard-by-omission \u2014 write '*' if you mean any)"] });
});

test('returns ok false with directory error when directory is empty string', () => {
  const res = parseRule({ include: true, directory: '', name: 'test.js' });
  assert.deepEqual(res, { ok: false, errors: ["directory must not be empty (no wildcard-by-omission \u2014 write '*' if you mean any)"] });
});

test('returns ok false with name error when name is empty string', () => {
  const res = parseRule({ include: true, directory: 'src', name: '' });
  assert.deepEqual(res, { ok: false, errors: ["name must not be empty (no wildcard-by-omission \u2014 write '*' if you mean any)"] });
});

test('returns ok true with trimmed fields and value when row is valid', () => {
  const res = parseRule({ include: true, directory: '  src  ', name: '  test.js  ', value: 42 });
  assert.deepEqual(res, { ok: true, rule: { include: true, directory: 'src', name: 'test.js', value: 42 } });
});

test('returns ok true with wildcard values when directory and name are asterisks', () => {
  const res = parseRule({ include: false, directory: '*', name: '*', value: undefined });
  assert.deepEqual(res, { ok: true, rule: { include: false, directory: '*', name: '*', value: undefined } });
});
