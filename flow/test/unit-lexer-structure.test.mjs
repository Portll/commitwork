// Bracket structure and import bindings over the MASKED source (flow/lexer.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, matchBracket, splitArgs, importedNames } from '../lexer.mjs';
import { maskFrom } from '../verify.mjs';

const mask = (src) => {
  const lex = classify(src);
  return { masked: maskFrom(src, lex.spans).masked, spans: lex.spans };
};

test('matchBracket finds the close of nested brackets and ignores brackets inside strings', () => {
  // arrange
  const { masked } = mask('f(a, [1, ")"], { b: (c) })');
  // act
  const close = matchBracket(masked, 1);
  // assert
  assert.equal(close, masked.length - 1);
});

test('matchBracket returns -1 for a non-bracket, a mismatch and an unclosed bracket', () => {
  // arrange
  const cases = [['x(', 0], ['(]', 0], ['(((', 0]];
  // act
  const got = cases.map(([s, i]) => matchBracket(s, i));
  // assert
  assert.deepEqual(got, [-1, -1, -1]);
});

test('splitArgs splits top-level commas only and trims each argument', () => {
  // arrange
  const src = 'f( a , g(b, c), [d, e] ,{ f: 1, g } )';
  // act
  const args = splitArgs(src, 1).map((r) => src.slice(r.start, r.end));
  // assert
  assert.deepEqual(args, ['a', 'g(b, c)', '[d, e]', '{ f: 1, g }']);
});

test('splitArgs returns [] for an empty call and null when the bracket never closes', () => {
  // arrange
  const empty = 'f(   )';
  // act
  const a = splitArgs(empty, 1);
  const b = splitArgs('f(a, b', 1);
  // assert
  assert.deepEqual(a, []);
  assert.equal(b, null);
});

test('importedNames reads namespace, default, named and aliased imports and requires', () => {
  // arrange
  const src = [
    "import * as cp from 'node:child_process';",
    "import fs, { watch as w, readFileSync } from 'node:fs';",
    "const http = require('node:http');",
    "const { get: hget } = require('node:https');",
    "import { other } from 'node:path';",
  ].join('\n');
  const { masked, spans } = mask(src);
  // act
  const r = importedNames(masked, spans, ['node:child_process', 'node:fs', 'node:http', 'node:https']);
  // assert
  assert.deepEqual([...r.namespaces].sort(), ['cp', 'fs', 'http']);
  assert.deepEqual([...r.named.entries()].sort(), [['hget', 'get'], ['readFileSync', 'readFileSync'], ['w', 'watch']]);
});

test('importedNames ignores a matching string that is not an import or require', () => {
  // arrange
  const { masked, spans } = mask("const s = 'node:fs';\nlog('node:fs');");
  // act
  const r = importedNames(masked, spans, ['node:fs']);
  // assert
  assert.equal(r.namespaces.size, 0);
  assert.equal(r.named.size, 0);
});
