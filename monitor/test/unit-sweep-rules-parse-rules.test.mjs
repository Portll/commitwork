// Parses an array of rule rows into a list of rules, preserving slot order with nulls for bad rows (monitor/sweep-rules.mjs parseRules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRules } from '../sweep-rules.mjs';

test('returns ok true with empty rules and errors when input is an empty array', () => {
  const result = parseRules([]);
  assert.deepEqual(result, { ok: true, rules: [], errors: [] });
});

test('returns ok false with empty rules and errors when input is not an array', () => {
  const result = parseRules(null);
  assert.deepEqual(result, { ok: false, rules: [], errors: [] });
});

test('returns ok false with empty rules and errors when input is a string', () => {
  const result = parseRules('not-an-array');
  assert.deepEqual(result, { ok: false, rules: [], errors: [] });
});

test('returns ok true with parsed rules when all rows are valid', () => {
  const rows = [
    { include: true, directory: 'src', name: '*.js' },
    { include: false, directory: 'dist', name: '*' },
  ];
  const result = parseRules(rows);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rules, [
    { include: true, directory: 'src', name: '*.js', value: undefined },
    { include: false, directory: 'dist', name: '*', value: undefined },
  ]);
  assert.deepEqual(result.errors, []);
});

test('returns ok false with null slot and errors when a row is null', () => {
  const rows = [null];
  const result = parseRules(rows);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rules, [null]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 0);
  assert.equal(result.errors[0].errors.length, 1);
  assert.match(result.errors[0].errors[0], /^row 0: row must be an object, got null$/);
});

test('returns ok false with null slot and errors when a row is an array', () => {
  const rows = [[1, 2, 3]];
  const result = parseRules(rows);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rules, [null]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 0);
  assert.equal(result.errors[0].errors.length, 1);
  assert.match(result.errors[0].errors[0], /^row 0: row must be an object, got array$/);
});

test('returns ok false with null slot and errors when include is not a boolean', () => {
  const rows = [{ include: 'yes', directory: 'src', name: '*.js' }];
  const result = parseRules(rows);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rules, [null]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 0);
  assert.equal(result.errors[0].errors.length, 1);
  assert.match(result.errors[0].errors[0], /^row 0: include must be a boolean \(include-or-exclude\), got string$/);
});

test('returns ok false with null slot and errors when directory is undefined', () => {
  const rows = [{ include: true, name: '*.js' }];
  const result = parseRules(rows);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rules, [null]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 0);
  assert.equal(result.errors[0].errors.length, 1);
  assert.match(result.errors[0].errors[0], /^row 0: directory must be a string, got undefined \(no wildcard-by-omission \u2014 write '\*' if you mean any\)$/);
});

test('returns ok false with null slot and errors when name is empty string', () => {
  const rows = [{ include: true, directory: 'src', name: '   ' }];
  const result = parseRules(rows);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rules, [null]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 0);
  assert.equal(result.errors[0].errors.length, 1);
  assert.match(result.errors[0].errors[0], /^row 0: name must not be empty \(no wildcard-by-omission \u2014 write '\*' if you mean any\)$/);
});

test('returns ok false with null slots and errors for multiple bad rows while preserving valid rows', () => {
  const rows = [
    { include: true, directory: 'src', name: '*.js' },
    null,
    { include: false, directory: 'dist', name: '*' },
    { include: true, directory: '', name: '*.ts' },
  ];
  const result = parseRules(rows);
  assert.equal(result.ok, false);
  assert.equal(result.rules.length, 4);
  assert.deepEqual(result.rules[0], { include: true, directory: 'src', name: '*.js', value: undefined });
  assert.equal(result.rules[1], null);
  assert.deepEqual(result.rules[2], { include: false, directory: 'dist', name: '*', value: undefined });
  assert.equal(result.rules[3], null);
  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].index, 1);
  assert.equal(result.errors[1].index, 3);
});
