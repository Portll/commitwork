// Splits gate failures into breakage, expected, and stale declarations (bin/lib/parse-gate.mjs classifyFailures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailures } from '../lib/parse-gate.mjs';

test('empty failures with empty declared returns empty arrays and no stale', () => {
  const r = classifyFailures([], {});
  assert.deepEqual(r, { breakage: [], expected: [], staleDeclarations: [] });
});

test('failure matching declared path goes to expected', () => {
  const r = classifyFailures([{ path: 'a.mjs' }], { 'a.mjs': 'reason' });
  assert.deepEqual(r, { breakage: [], expected: [{ path: "a.mjs" }], staleDeclarations: [] });
});

test('failure not in declared goes to breakage', () => {
  const r = classifyFailures([{ path: 'b.mjs' }], { 'a.mjs': 'reason' });
  assert.deepEqual(r, { breakage: [{ path: "b.mjs" }], expected: [], staleDeclarations: ["a.mjs"] });
});

test('declared path with no failure is stale', () => {
  const r = classifyFailures([{ path: 'b.mjs' }], { 'a.mjs': 'reason' });
  assert.deepEqual(r, { breakage: [{ path: "b.mjs" }], expected: [], staleDeclarations: ["a.mjs"] });
});

test('declared path with failure is not stale', () => {
  const r = classifyFailures([{ path: 'a.mjs' }], { 'a.mjs': 'reason' });
  assert.deepEqual(r, { breakage: [], expected: [{ path: "a.mjs" }], staleDeclarations: [] });
});

test('multiple failures split correctly with stale detection', () => {
  const r = classifyFailures(
    [{ path: 'a.mjs' }, { path: 'b.mjs' }, { path: 'c.mjs' }],
    { 'a.mjs': 'r1', 'c.mjs': 'r2' }
  );
  assert.deepEqual(r, { breakage: [{ path: "b.mjs" }], expected: [{ path: "a.mjs" }, { path: "c.mjs" }], staleDeclarations: [] });
});

test('default declared uses NOT_MODULES for workflow path', () => {
  const r = classifyFailures([{ path: 'workflows/adversarial-review.mjs' }]);
  assert.deepEqual(r, { breakage: [], expected: [{ path: "workflows/adversarial-review.mjs" }], staleDeclarations: [] });
});

test('default declared marks workflow as stale when no failure', () => {
  const r = classifyFailures([{ path: 'other.mjs' }]);
  assert.deepEqual(r, { breakage: [{ path: "other.mjs" }], expected: [], staleDeclarations: ["workflows/adversarial-review.mjs"] });
});
