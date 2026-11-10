// Strips block and line comments from source text (bin/lib/tracked-imports.mjs stripComments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments } from '../lib/tracked-imports.mjs';

test('removes a line comment at the start of a line', () => {
  assert.deepEqual(stripComments('// hello'), [""]);
});

test('removes a line comment preceded by a non-colon character', () => {
  assert.deepEqual(stripComments('a // hello'), ["a "]);
});

test('keeps a double slash preceded by a colon', () => {
  assert.deepEqual(stripComments('a: // hello'), ["a: "]);
});

test('removes a single-line block comment', () => {
  assert.deepEqual(stripComments('a /* b */ c'), ["a   c"]);
});

test('removes a block comment that starts on its own line', () => {
  assert.deepEqual(stripComments('a\n/* b */\nc'), ["a", " ", "c"]);
});

test('removes a multi-line block comment and keeps the rest of the closing line', () => {
  assert.deepEqual(stripComments('a\n/* b\nc */ d'), ["a", "", " d"]);
});

test('replaces a block comment that ends on a later line with an empty line', () => {
  assert.deepEqual(stripComments('a\n/* b\nc'), ["a", "", ""]);
});

test('strips line comments from every line of a multi-line input', () => {
  assert.deepEqual(stripComments('a // x\nb // y'), ["a ", "b "]);
});
