// Extracts NuGet package and digest observables from a lock file (monitor/observables.mjs extractNugetLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNugetLock } from '../observables.mjs';

test('returns unknown for unparseable JSON', () => {
  const r = extractNugetLock('not json', 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "w: Unexpected token 'o', \"not json\" is not valid JSON" });
});

test('returns unknown for missing dependencies', () => {
  const r = extractNugetLock(JSON.stringify({ foo: 1 }), 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: no dependencies{} \u2014 not a NuGet lock this reader knows" });
});

test('returns unknown for null dependencies', () => {
  const r = extractNugetLock(JSON.stringify({ dependencies: null }), 'w');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "w: no dependencies{} \u2014 not a NuGet lock this reader knows" });
});

test('returns empty observables for empty dependencies object', () => {
  const r = extractNugetLock(JSON.stringify({ dependencies: {} }), 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: true } });
});

test('extracts package and digest for valid entry', () => {
  const r = extractNugetLock(JSON.stringify({ dependencies: { net8: { A: { type: 'Package', contentHash: 'h1' } } } }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "A", where: "w", tier: "declared" }, { type: "sha512", value: "h1", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: false, canDigest: true } });
});

test('skips project type entries', () => {
  const r = extractNugetLock(JSON.stringify({ dependencies: { net8: { A: { type: 'Project' } } } }), 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: true } });
});

test('skips non-object tfm values', () => {
  const r = extractNugetLock(JSON.stringify({ dependencies: { net8: 'str' } }), 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: true } });
});

test('skips non-object node values', () => {
  const r = extractNugetLock(JSON.stringify({ dependencies: { net8: { A: 'str' } } }), 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: true } });
});

test('skips empty contentHash', () => {
  const r = extractNugetLock(JSON.stringify({ dependencies: { net8: { A: { type: 'Package', contentHash: '  ' } } } }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "A", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: true } });
});

test('deduplicates package names across tfms', () => {
  const r = extractNugetLock(JSON.stringify({ dependencies: { a: { P: { type: 'Package', contentHash: 'h' } }, b: { P: { type: 'Package', contentHash: 'h2' } } } }), 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "P", where: "w", tier: "declared" }, { type: "sha512", value: "h", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: false, canDigest: true } });
});
