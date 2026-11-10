// Parses a pnpm flow mapping string into a key-value object (monitor/observables.mjs parsePnpmFlowMapping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePnpmFlowMapping } from '../observables.mjs';

test('returns null when the body contains a brace', () => {
  const r = parsePnpmFlowMapping('a:1, b:{x:1}');
  assert.equal(r, null);
});

test('skips parts whose colon is at index zero', () => {
  const r = parsePnpmFlowMapping(':v, k:v');
  assert.deepEqual(r, { k: "v" });
});

test('skips parts whose colon is at index one', () => {
  const r = parsePnpmFlowMapping('x: v, k:v');
  assert.deepEqual(r, { x: "v", k: "v" });
});

test('trims whitespace around keys and values', () => {
  const r = parsePnpmFlowMapping('  k1  :  v1  ,  k2  :  v2  ');
  assert.deepEqual(r, { k1: "v1", k2: "v2" });
});

test('strips single quotes from values', () => {
  const r = parsePnpmFlowMapping("k:'v'");
  assert.deepEqual(r, { k: "v" });
});

test('strips double quotes from values', () => {
  const r = parsePnpmFlowMapping('k:"v"');
  assert.deepEqual(r, { k: "v" });
});

test('keeps values with a single quote only at the start', () => {
  const r = parsePnpmFlowMapping("k:'v");
  assert.deepEqual(r, { k: "'v" });
});

test('keeps values with a single quote only at the end', () => {
  const r = parsePnpmFlowMapping("k:v'");
  assert.deepEqual(r, { k: "v'" });
});

test('keeps values with a double quote only at the start', () => {
  const r = parsePnpmFlowMapping('k:"v');
  assert.deepEqual(r, { k: "\"v" });
});

test('keeps values with a double quote only at the end', () => {
  const r = parsePnpmFlowMapping('k:v"');
  assert.deepEqual(r, { k: "v\"" });
});
