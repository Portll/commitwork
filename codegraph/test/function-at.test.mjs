// codegraph/function-at.mjs: the function a line sits in, read off the lexical extraction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functionsOf, functionAt } from '../function-at.mjs';

const SRC = [
  "import { x } from './x.mjs';",          // 1
  'const LIMIT = 3;',                        // 2
  'export function outer(a) {',              // 3
  '  function inner(b) {',                   // 4
  '    return b + 1;',                       // 5
  '  }',                                     // 6
  '  return inner(a);',                      // 7
  '}',                                       // 8
  'export const arrow = (v) => {',           // 9
  '  return v * LIMIT;',                     // 10
  '};',                                      // 11
  'class Box {',                             // 12
  '  open(k) {',                             // 13
  '    return x(k);',                        // 14
  '  }',                                     // 15
  '}',                                       // 16
  'outer(1);',                               // 17
  '',
].join('\n');

test('functionsOf lists every symbol with a body, with its first and last line', () => {
  // arrange
  const src = SRC;
  // act
  const r = functionsOf(src);
  // assert
  assert.equal(r.ok, true);
  assert.deepEqual(r.functions.map((f) => [f.name, f.kind, f.line, f.endLine]),
    [['outer', 'function', 3, 8], ['arrow', 'function', 9, 11], ['Box', 'class', 12, 16], ['Box.open', 'method', 13, 15]]);
});

test('functionAt gives the innermost symbol: a method, not its class', () => {
  // arrange
  const { functions } = functionsOf(SRC);
  // act
  const hit = functionAt(functions, 14);
  // assert
  assert.equal(hit.name, 'Box.open');
});

test('a line inside a nested function resolves to the top-level function that holds it', () => {
  // arrange
  const { functions } = functionsOf(SRC);
  // act
  const hit = functionAt(functions, 5);
  // assert
  assert.equal(hit.name, 'outer');
});

test('a line in an arrow bound at top level resolves to the binding', () => {
  // arrange
  const { functions } = functionsOf(SRC);
  // act
  const hit = functionAt(functions, 10);
  // assert
  assert.deepEqual([hit.name, hit.kind], ['arrow', 'function']);
});

test('module-level lines resolve to null', () => {
  // arrange
  const { functions } = functionsOf(SRC);
  // act
  const hits = [functionAt(functions, 1), functionAt(functions, 2), functionAt(functions, 17), functionAt(functions, 99)];
  // assert
  assert.deepEqual(hits, [null, null, null, null]);
});

test('the first and last line of a function are inside it', () => {
  // arrange
  const { functions } = functionsOf(SRC);
  // act
  const edges = [functionAt(functions, 3).name, functionAt(functions, 8).name, functionAt(functions, 12).name, functionAt(functions, 16).name];
  // assert
  assert.deepEqual(edges, ['outer', 'outer', 'Box', 'Box']);
});

test('a file the lexer cannot read is unknown, never an empty list of functions', () => {
  // arrange
  const src = 'export function broken() { return `unterminated ${';
  // act
  const r = functionsOf(src);
  // assert
  assert.equal(r.ok, false);
  assert.equal(typeof r.reason, 'string');
  assert.deepEqual(r.functions, []);
});
