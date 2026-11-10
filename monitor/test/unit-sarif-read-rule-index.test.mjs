// Maps SARIF rule ids to rule objects, optionally including extension rules (monitor/sarif-read.mjs ruleIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleIndex } from '../sarif-read.mjs';

test('returns empty object when run is null', () => {
  assert.deepEqual(ruleIndex(null), {});
});

test('returns empty object when run has no tool', () => {
  assert.deepEqual(ruleIndex({}), {});
});

test('returns empty object when tool has no driver', () => {
  assert.deepEqual(ruleIndex({ tool: {} }), {});
});

test('returns empty object when driver has no rules', () => {
  assert.deepEqual(ruleIndex({ tool: { driver: {} } }), {});
});

test('indexes driver rules by id and skips entries without id', () => {
  const run = { tool: { driver: { rules: [{ id: 'a' }, null, { name: 'no-id' }, { id: 'b' }] } } };
  assert.deepEqual(ruleIndex(run), { a: { id: "a" }, b: { id: "b" } });
});

test('does not include extension rules when extensions is false', () => {
  const run = { tool: { driver: { rules: [{ id: 'a' }] }, extensions: [{ rules: [{ id: 'x' }] }] } };
  assert.deepEqual(ruleIndex(run, { extensions: false }), { a: { id: "a" } });
});

test('includes extension rules when extensions is true', () => {
  const run = { tool: { driver: { rules: [{ id: 'a' }] }, extensions: [{ rules: [{ id: 'x' }] }] } };
  assert.deepEqual(ruleIndex(run, { extensions: true }), { a: { id: "a" }, x: { id: "x" } });
});

test('keeps driver rule over extension rule with same id', () => {
  const run = { tool: { driver: { rules: [{ id: 'a', src: 'd' }] }, extensions: [{ rules: [{ id: 'a', src: 'e' }] }] } };
  assert.deepEqual(ruleIndex(run, { extensions: true }), { a: { id: "a", src: "d" } });
});

test('skips extension entries without rules', () => {
  const run = { tool: { driver: { rules: [{ id: 'a' }] }, extensions: [null, { name: 'no-rules' }] } };
  assert.deepEqual(ruleIndex(run, { extensions: true }), { a: { id: "a" } });
});

test('skips extension rule entries without id', () => {
  const run = { tool: { driver: { rules: [{ id: 'a' }] }, extensions: [{ rules: [null, { name: 'no-id' }] }] } };
  assert.deepEqual(ruleIndex(run, { extensions: true }), { a: { id: "a" } });
});
