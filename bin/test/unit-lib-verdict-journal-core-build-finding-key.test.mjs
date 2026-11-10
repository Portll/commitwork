// Builds a pipe-joined identity key from named components, rejecting line-keyed names (bin/lib/verdict-journal-core.mjs buildFindingKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindingKey } from '../lib/verdict-journal-core.mjs';

test('joins two named components with a pipe separator', () => {
  const r = buildFindingKey([['file', 'a.js'], ['symbol', 'foo']]);
  assert.equal(r, "a.js|foo");
});

test('joins three components in order with pipes', () => {
  const r = buildFindingKey([['lane', 'supplyChain'], ['pkg', 'undici'], ['ver', '5.28.4']]);
  assert.equal(r, "supplyChain|undici|5.28.4");
});

test('returns an empty string for zero components', () => {
  const r = buildFindingKey([]);
  assert.equal(r, "");
});

test('returns a single component value without a trailing pipe', () => {
  const r = buildFindingKey([['file', 'x.mjs']]);
  assert.equal(r, "x.mjs");
});

test('coerces a null component value to an empty string', () => {
  const r = buildFindingKey([['file', 'a.js'], ['symbol', null]]);
  assert.equal(r, "a.js|");
});

test('coerces a numeric component value to its string form', () => {
  const r = buildFindingKey([['count', 42]]);
  assert.equal(r, "42");
});

test('throws when a component is named line', () => {
  assert.throws(() => buildFindingKey([['file', 'a.js'], ['line', 10]]), {
    name: 'Error',
    message: "buildFindingKey: forbidden identity component 'line' \u2014 line-keyed identity un-suppresses itself on the next unrelated edit above it (house rule); use a place-stable field instead"
  });
});

test('throws when a component is named startLine', () => {
  assert.throws(() => buildFindingKey([['startLine', 1]]), {
    name: 'Error',
    message: "buildFindingKey: forbidden identity component 'startLine' \u2014 line-keyed identity un-suppresses itself on the next unrelated edit above it (house rule); use a place-stable field instead"
  });
});

test('throws when a component is named endLine', () => {
  assert.throws(() => buildFindingKey([['endLine', 99]]), {
    name: 'Error',
    message: "buildFindingKey: forbidden identity component 'endLine' \u2014 line-keyed identity un-suppresses itself on the next unrelated edit above it (house rule); use a place-stable field instead"
  });
});

test('throws when a component is named lineNumber', () => {
  assert.throws(() => buildFindingKey([['lineNumber', 5]]), {
    name: 'Error',
    message: "buildFindingKey: forbidden identity component 'lineNumber' \u2014 line-keyed identity un-suppresses itself on the next unrelated edit above it (house rule); use a place-stable field instead"
  });
});

test('throws when a component is named lineNo', () => {
  assert.throws(() => buildFindingKey([['lineNo', 7]]), {
    name: 'Error',
    message: "buildFindingKey: forbidden identity component 'lineNo' \u2014 line-keyed identity un-suppresses itself on the next unrelated edit above it (house rule); use a place-stable field instead"
  });
});
