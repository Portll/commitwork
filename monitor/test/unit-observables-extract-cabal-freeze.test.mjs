// Extracts pinned package names from a cabal freeze file (monitor/observables.mjs extractCabalFreeze).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCabalFreeze } from '../observables.mjs';

test('returns unknown when text lacks constraints section', () => {
  const r = extractCabalFreeze('name: foo\nversion: 1.0', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: no constraints: \u2014 not a cabal freeze file this reader knows" });
});

test('returns unknown when constraints has no pinned packages', () => {
  const r = extractCabalFreeze('constraints:\n  any.foo >= 1.0', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: constraints with no ==-pinned packages \u2014 a freeze of flags alone resolves nothing" });
});

test('extracts single pinned package with correct provenance', () => {
  const r = extractCabalFreeze('constraints:\n  any.foo == 1.0', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false } });
});

test('deduplicates repeated package names in constraints', () => {
  const r = extractCabalFreeze('constraints:\n  any.foo == 1.0\n  any.foo == 2.0', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false } });
});

test('extracts multiple distinct pinned packages', () => {
  const r = extractCabalFreeze('constraints:\n  any.foo == 1.0\n  any.bar == 2.0', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "w", tier: "declared" }, { type: "package", value: "bar", where: "w", tier: "declared" }], provenance: { packages: 2, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false } });
});

test('handles package names with digits and hyphens', () => {
  const r = extractCabalFreeze('constraints:\n  any.my-pkg-2 == 1.0', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "my-pkg-2", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false } });
});

test('returns unknown for empty constraints section', () => {
  const r = extractCabalFreeze('constraints:', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: constraints with no ==-pinned packages \u2014 a freeze of flags alone resolves nothing" });
});

test('extracts package with whitespace before equals', () => {
  const r = extractCabalFreeze('constraints:\n  any.foo   == 1.0', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "foo", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false } });
});
