// Extracts leading comment lines from source text (bin/exit-codes.mjs headerLines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerLines } from '../exit-codes.mjs';

test('returns array with one empty entry for empty string', () => {
  assert.deepEqual(headerLines(''), [{ raw: '', text: '', indent: 0 }]);
});

test('skips shebang line and extracts single-line comment', () => {
  const src = '#!/usr/bin/env node\n// hello\nconst x = 1;';
  assert.deepEqual(headerLines(src), [{ raw: '// hello', text: 'hello', indent: 1 }]);
});

test('extracts multiple single-line comments until non-comment line', () => {
  const src = '// first\n  // second\nconst x = 1;';
  assert.deepEqual(headerLines(src), [
    { raw: '// first', text: 'first', indent: 1 },
    { raw: '  // second', text: 'second', indent: 1 },
  ]);
});

test('handles single-line block comment on one line', () => {
  const src = '/* hello */\nconst x = 1;';
  assert.deepEqual(headerLines(src), [{ raw: '/* hello */', text: 'hello', indent: 1 }]);
});

test('handles multi-line block comment with asterisk prefix', () => {
  const src = '/*\n * hello\n * world\n */\nconst x = 1;';
  assert.deepEqual(headerLines(src), [
    { raw: '/*', text: '', indent: 0 },
    { raw: ' * hello', text: 'hello', indent: 1 },
    { raw: ' * world', text: 'world', indent: 1 },
    { raw: ' */', text: '', indent: 0 },
  ]);
});

test('stops at first non-comment line', () => {
  const src = '// comment\nconst x = 1;\n// another';
  assert.deepEqual(headerLines(src), [{ raw: '// comment', text: 'comment', indent: 1 }]);
});

test('handles block comment with leading whitespace', () => {
  const src = '  /* hello */\nconst x = 1;';
  assert.deepEqual(headerLines(src), [{ raw: '  /* hello */', text: 'hello', indent: 1 }]);
});

test('handles empty line in comment block', () => {
  const src = '// first\n\n// second\nconst x = 1;';
  assert.deepEqual(headerLines(src), [
    { raw: '// first', text: 'first', indent: 1 },
    { raw: '', text: '', indent: 0 },
    { raw: '// second', text: 'second', indent: 1 },
  ]);
});

test('handles CRLF line endings', () => {
  const src = '// first\r\n// second\r\nconst x = 1;';
  assert.deepEqual(headerLines(src), [
    { raw: '// first', text: 'first', indent: 1 },
    { raw: '// second', text: 'second', indent: 1 },
  ]);
});

test('handles block comment that spans multiple lines with content', () => {
  const src = '/* start\n * middle\n end */\nconst x = 1;';
  assert.deepEqual(headerLines(src), [
    { raw: '/* start', text: 'start', indent: 1 },
    { raw: ' * middle', text: 'middle', indent: 1 },
    { raw: ' end */', text: 'end', indent: 0 },
  ]);
});
