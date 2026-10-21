// Explains, rule by rule, whether each rule matches a target, which one wins and why (monitor/sweep-rules.mjs explain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../sweep-rules.mjs';

test('returns all rules marked not evaluated when target is invalid', () => {
  const rules = [
    { include: true, directory: '*', name: '*', value: 'a' },
    { include: false, directory: 'src', name: '*', value: null },
  ];
  const result = explain(null, { rules });
  assert.deepEqual(result, [
    { index: 0, rule: rules[0], matched: false, winner: false, why: 'not evaluated \u2014 target must be an object, got null' },
    { index: 1, rule: rules[1], matched: false, winner: false, why: 'not evaluated \u2014 target must be an object, got null' },
  ]);
});

test('returns all rules marked not evaluated when target is an array', () => {
  const rules = [{ include: true, directory: '*', name: '*', value: 'a' }];
  const result = explain([], { rules });
  assert.deepEqual(result, [
    { index: 0, rule: rules[0], matched: false, winner: false, why: 'not evaluated \u2014 target must be an object, got array' },
  ]);
});

test('returns all rules marked not evaluated when target is a string', () => {
  const rules = [{ include: true, directory: '*', name: '*', value: 'a' }];
  const result = explain('not-an-object', { rules });
  assert.deepEqual(result, [
    { index: 0, rule: rules[0], matched: false, winner: false, why: 'not evaluated \u2014 target must be an object, got string' },
  ]);
});

test('marks a matching include rule as winner with value applied', () => {
  const rules = [
    { include: true, directory: 'src', name: 'app.js', value: 'allow' },
  ];
  const target = { directory: 'src', name: 'app.js' };
  const result = explain(target, { rules });
  assert.deepEqual(result, [
    { index: 0, rule: rules[0], matched: true, winner: true, why: 'matched (directory=exact,name=exact) \u2014 WINS (last match); value applied' },
  ]);
});

test('marks a matching exclude rule as winner with target excluded', () => {
  const rules = [
    { include: false, directory: 'secrets', name: '*', value: null },
  ];
  const target = { directory: 'secrets', name: 'key.pem' };
  const result = explain(target, { rules });
  assert.deepEqual(result, [
    { index: 0, rule: rules[0], matched: true, winner: true, why: 'matched (directory=exact,name=*) \u2014 WINS (last match); target is EXCLUDED' },
  ]);
});

test('marks a matching rule as overridden when a later rule also matches', () => {
  const rules = [
    { include: true, directory: 'src', name: '*', value: 'first' },
    { include: true, directory: 'src', name: 'app.js', value: 'second' },
  ];
  const target = { directory: 'src', name: 'app.js' };
  const result = explain(target, { rules });
  assert.deepEqual(result, [
    { index: 0, rule: rules[0], matched: true, winner: false, why: 'matched (directory=exact,name=*) \u2014 overridden by rule #1 (last match wins)' },
    { index: 1, rule: rules[1], matched: true, winner: true, why: 'matched (directory=exact,name=exact) \u2014 WINS (last match); value applied' },
  ]);
});

test('marks a non-matching rule as not matched with directory mismatch', () => {
  const rules = [
    { include: true, directory: 'src', name: '*', value: 'a' },
  ];
  const target = { directory: 'lib', name: 'app.js' };
  const result = explain(target, { rules });
  assert.deepEqual(result, [
    { index: 0, rule: rules[0], matched: false, winner: false, why: "no match \u2014 directory 'src' != 'lib'" },
  ]);
});

test('marks a non-matching rule as not matched with name mismatch', () => {
  const rules = [
    { include: true, directory: 'src', name: 'app.js', value: 'a' },
  ];
  const target = { directory: 'src', name: 'other.js' };
  const result = explain(target, { rules });
  assert.deepEqual(result, [
    { index: 0, rule: rules[0], matched: false, winner: false, why: "no match \u2014 name 'app.js' != 'other.js'" },
  ]);
});

test('marks an invalid rule as skipped with error details', () => {
  const rules = [
    { include: 'yes', directory: 'src', name: 'app.js', value: 'a' },
  ];
  const target = { directory: 'src', name: 'app.js' };
  const result = explain(target, { rules });
  assert.deepEqual(result, [
    { index: 0, rule: rules[0], matched: false, winner: false, why: 'skipped \u2014 invalid rule: include must be a boolean (include-or-exclude), got string' },
  ]);
});

test('returns empty array when no rules are provided', () => {
  const target = { directory: 'src', name: 'app.js' };
  const result = explain(target, {});
  assert.deepEqual(result, []);
});
