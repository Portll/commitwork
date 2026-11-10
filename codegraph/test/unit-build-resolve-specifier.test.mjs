// Maps an import specifier to a tracked module, external id, or unresolved (codegraph/build.mjs resolveSpecifier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpecifier } from '../build.mjs';

test('returns external kind for non-relative specifiers', () => {
  const r = resolveSpecifier('/src/a.mjs', 'lodash', new Set());
  assert.deepEqual(r, { kind: "external", target: "ext:lodash" });
});

test('returns external kind for bare package specifiers', () => {
  const r = resolveSpecifier('/src/a.mjs', 'react', new Set());
  assert.deepEqual(r, { kind: "external", target: "ext:react" });
});

test('returns module kind when candidate is tracked', () => {
  const r = resolveSpecifier('/src/a.mjs', './b.mjs', new Set(['/src/b.mjs']));
  assert.deepEqual(r, { kind: "module", target: "/src/b.mjs" });
});

test('returns unresolved when no candidate is tracked', () => {
  const r = resolveSpecifier('/src/a.mjs', './missing.mjs', new Set());
  assert.deepEqual(r, { kind: "unresolved", target: null });
});

test('returns external kind for parent directory specifiers', () => {
  const r = resolveSpecifier('/src/a.mjs', '../c.mjs', new Set());
  assert.deepEqual(r, { kind: "unresolved", target: null });
});

test('returns module kind for parent directory when tracked', () => {
  const r = resolveSpecifier('/src/a.mjs', '../c.mjs', new Set(['/c.mjs']));
  assert.deepEqual(r, { kind: "module", target: "/c.mjs" });
});

test('returns external kind for double dot relative specifiers', () => {
  const r = resolveSpecifier('/src/a.mjs', '../../d.mjs', new Set());
  assert.deepEqual(r, { kind: "unresolved", target: null });
});

test('returns module kind for double dot relative when tracked', () => {
  const r = resolveSpecifier('/src/a.mjs', '../../d.mjs', new Set(['/d.mjs']));
  assert.deepEqual(r, { kind: "module", target: "/d.mjs" });
});
