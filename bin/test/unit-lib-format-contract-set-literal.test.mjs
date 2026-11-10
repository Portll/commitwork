// Extracts a Set of string literals from a named export const declaration (bin/lib/format-contract.mjs setLiteral).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLiteral } from '../lib/format-contract.mjs';

test('returns null when the export declaration is absent', () => {
  const src = 'export const other = new Set([]);';
  const r = setLiteral(src, 'missing');
  assert.equal(r, null);
});

test('returns a Set of the quoted literals when the declaration is present', () => {
  const src = 'export const allowed = new Set([\'a\', \'b\']);';
  const r = setLiteral(src, 'allowed');
  assert.deepEqual(r, new Set(["a", "b"]));
});

test('returns an empty Set when the declaration has no quoted literals', () => {
  const src = 'export const empty = new Set([]);';
  const r = setLiteral(src, 'empty');
  assert.deepEqual(r, new Set([]));
});

test('returns a Set containing the literal when the declaration has one quoted value', () => {
  const src = 'export const single = new Set([\'x\']);';
  const r = setLiteral(src, 'single');
  assert.deepEqual(r, new Set(["x"]));
});

test('returns a Set of all quoted literals when the declaration has multiple values', () => {
  const src = 'export const multi = new Set([\'p\', \'q\', \'r\']);';
  const r = setLiteral(src, 'multi');
  assert.deepEqual(r, new Set(["p", "q", "r"]));
});

test('returns null when the source does not contain the expected export pattern', () => {
  const src = 'const notExport = new Set([\'z\']);';
  const r = setLiteral(src, 'notExport');
  assert.equal(r, null);
});

test('returns a Set of literals when the declaration spans multiple lines', () => {
  const src = 'export const multiLine = new Set([\n  \'one\',\n  \'two\'\n]);';
  const r = setLiteral(src, 'multiLine');
  assert.deepEqual(r, new Set(["one", "two"]));
});

test('returns null when the name does not match any export const declaration', () => {
  const src = 'export const alpha = new Set([\'a\']);\nexport const beta = new Set([\'b\']);';
  const r = setLiteral(src, 'gamma');
  assert.equal(r, null);
});
