// Parses footer lines into token/separator/value objects, appending continuation lines to the last footer (bin/lib/conventional-commit.mjs parseFooters).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFooters } from '../lib/conventional-commit.mjs';

test('returns an empty array for an empty block', () => {
  assert.deepEqual(parseFooters([]), []);
});

test('parses a single footer with a colon separator', () => {
  assert.deepEqual(parseFooters(['Refs: #123']), [{ token: "Refs", separator: ": ", value: "#123" }]);
});

test('parses a single footer with a hash separator', () => {
  assert.deepEqual(parseFooters(['Refs: #123', 'Reviewed-by: Alice']), [{ token: "Refs", separator: ": ", value: "#123" }, { token: "Reviewed-by", separator: ": ", value: "Alice" }]);
});

test('appends a continuation line to the last footer value', () => {
  assert.deepEqual(parseFooters(['Refs: #123', 'extra line']), [{ token: "Refs", separator: ": ", value: "#123\nextra line" }]);
});

test('appends multiple continuation lines to the last footer value', () => {
  assert.deepEqual(parseFooters(['Refs: #123', 'line one', 'line two']), [{ token: "Refs", separator: ": ", value: "#123\nline one\nline two" }]);
});

test('ignores a continuation line when no footer has been parsed yet', () => {
  assert.deepEqual(parseFooters(['no footer here', 'Refs: #123']), [{ token: "Refs", separator: ": ", value: "#123" }]);
});

test('parses BREAKING CHANGE as a token with a colon separator', () => {
  assert.deepEqual(parseFooters(['BREAKING CHANGE: something']), [{ token: "BREAKING CHANGE", separator: ": ", value: "something" }]);
});

test('parses BREAKING-CHANGE as a token with a hash separator', () => {
  assert.deepEqual(parseFooters(['BREAKING-CHANGE: something']), [{ token: "BREAKING-CHANGE", separator: ": ", value: "something" }]);
});

test('appends a continuation line after a BREAKING CHANGE footer', () => {
  assert.deepEqual(parseFooters(['BREAKING CHANGE: something', 'details here']), [{ token: "BREAKING CHANGE", separator: ": ", value: "something\ndetails here" }]);
});

test('appends a continuation line to the first of two footers', () => {
  assert.deepEqual(parseFooters(['Refs: #123', 'Reviewed-by: Alice', 'extra line']), [{ token: "Refs", separator: ": ", value: "#123" }, { token: "Reviewed-by", separator: ": ", value: "Alice\nextra line" }]);
});
