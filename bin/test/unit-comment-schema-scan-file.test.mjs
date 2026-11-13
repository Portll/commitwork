// Computes fact trailer violations and long comment run counts (bin/comment-schema.mjs scanFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFile } from '../comment-schema.mjs';

test('ignores non-comment lines and accepts a valid fact line', () => {
  const src = 'const x = 1;\n// fact: valid claim (expiry: never, prev: broken)\n';
  const result = scanFile('test.mjs', src);
  assert.deepEqual(result, { violations: [], long: 0, reference: 0 });
});

test('flags a fact line with malformed trailer in claim', () => {
  const src = '// fact: this claim has (expiry: never) in it\n';
  const result = scanFile('test.mjs', src);
  assert.deepEqual(result, { violations: [{ rel: "test.mjs", line: 1, why: "malformed trailer \u2014 write (expiry: <cond>, prev: <state>) or none", text: "fact: this claim has (expiry: never) in it" }], long: 0, reference: 0 });
});

test('flags a fact line with prev not in closed set', () => {
  const src = '// fact: some claim (expiry: never, prev: bogus)\n';
  const result = scanFile('test.mjs', src);
  assert.deepEqual(result, { violations: [{ rel: "test.mjs", line: 1, why: "prev \"bogus\" is not in the closed set", text: "fact: some claim (expiry: never, prev: bogus)" }], long: 0, reference: 0 });
});

test('flags a fact line with empty expiry', () => {
  const src = '// fact: some claim (expiry: , prev: broken)\n';
  const result = scanFile('test.mjs', src);
  assert.deepEqual(result, { violations: [{ rel: "test.mjs", line: 1, why: "empty expiry", text: "fact: some claim (expiry: , prev: broken)" }], long: 0, reference: 0 });
});

test('flags a fact line with unresolved expiry placeholder', () => {
  const src = '// fact: some claim (expiry: TODO, prev: broken)\n';
  const result = scanFile('test.mjs', src);
  assert.deepEqual(result, { violations: [{ rel: "test.mjs", line: 1, why: "unresolved expiry \"TODO\"", text: "fact: some claim (expiry: TODO, prev: broken)" }], long: 0, reference: 0 });
});

test('counts a long reference run as reference', () => {
  const lines = Array.from({ length: 7 }, () => '// @param x');
  const src = lines.join('\n');
  const result = scanFile('test.mjs', src);
  assert.deepEqual(result, { violations: [], long: 0, reference: 1 });
});

test('counts a long narrative run as long', () => {
  const lines = Array.from({ length: 7 }, () => '// this is a narrative line');
  const src = lines.join('\n');
  const result = scanFile('test.mjs', src);
  assert.deepEqual(result, { violations: [], long: 1, reference: 0 });
});
