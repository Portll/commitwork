// Matching brace pairs and per-position nesting depth of a masked string (codegraph/lexical.mjs braceIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { braceIndex } from '../lexical.mjs';

test('a single balanced pair records depth after each character and the open to close match', () => {
  const r = braceIndex('{a}');
  assert.deepEqual(r, {
    ok: true,
    reason: null,
    depth: new Int32Array([0, 1, 1, 0]),
    match: new Map([[0, 2]]),
  });
});

test('a string without braces stays at depth zero with no matches', () => {
  const r = braceIndex('abc');
  assert.deepEqual(r, {
    ok: true,
    reason: null,
    depth: new Int32Array([0, 0, 0, 0]),
    match: new Map(),
  });
});

test('an empty string yields a one element depth array and no matches', () => {
  const r = braceIndex('');
  assert.deepEqual(r, {
    ok: true,
    reason: null,
    depth: new Int32Array([0]),
    match: new Map(),
  });
});

test('a leading close brace is reported as unbalanced at index zero', () => {
  const r = braceIndex('}');
  assert.deepEqual(r, { ok: false, reason: 'unbalanced } at 0', depth: null, match: null });
});

test('a lone open brace is reported as one unclosed brace', () => {
  const r = braceIndex('{');
  assert.deepEqual(r, { ok: false, reason: '1 unclosed {', depth: null, match: null });
});

test('two leading close braces stop at the first one', () => {
  const r = braceIndex('}}');
  assert.deepEqual(r, { ok: false, reason: 'unbalanced } at 0', depth: null, match: null });
});

test('two open braces are reported as two unclosed braces', () => {
  const r = braceIndex('{{');
  assert.deepEqual(r, { ok: false, reason: '2 unclosed {', depth: null, match: null });
});

test('nested braces raise depth to two and match inner pair before outer pair', () => {
  const r = braceIndex('{x{y}z}');
  assert.deepEqual(r, {
    ok: true,
    reason: null,
    depth: new Int32Array([0, 1, 1, 2, 2, 1, 1, 0]),
    match: new Map([[2, 4], [0, 6]]),
  });
});

test('an extra close brace after a balanced pair is reported at its index', () => {
  const r = braceIndex('{}}');
  assert.deepEqual(r, { ok: false, reason: 'unbalanced } at 2', depth: null, match: null });
});

test('two sibling pairs return to depth zero between them and match separately', () => {
  const r = braceIndex('{a}{b}');
  assert.deepEqual(r, {
    ok: true,
    reason: null,
    depth: new Int32Array([0, 1, 1, 0, 1, 1, 0]),
    match: new Map([[0, 2], [3, 5]]),
  });
});
