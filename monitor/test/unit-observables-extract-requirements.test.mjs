// Extracts package and URL observables from requirements text (monitor/observables.mjs extractRequirements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirements } from '../observables.mjs';

test('empty text yields empty observables and zero provenance', () => {
  const r = extractRequirements('', 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "index is configuration, not per-requirement; --hash pins are not read" });
});

test('comment-only line is skipped', () => {
  const r = extractRequirements('# comment', 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "index is configuration, not per-requirement; --hash pins are not read" });
});

test('dash-prefixed line is skipped', () => {
  const r = extractRequirements('-r other.txt', 'w');
  assert.deepEqual(r, { observables: [], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "index is configuration, not per-requirement; --hash pins are not read" });
});

test('direct URL requirement records package and URL', () => {
  const r = extractRequirements('pkg @ https://example.com/pkg.whl', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "pkg", where: "w", tier: "declared" }, { type: "url", value: "https://example.com/pkg.whl", where: "w", tier: "declared" }, { type: "domain", value: "example.com", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: false, canDigest: false }, note: "index is configuration, not per-requirement; --hash pins are not read" });
});

test('bare URL line records URL observable', () => {
  const r = extractRequirements('https://example.com/pkg.whl', 'w');
  assert.deepEqual(r, { observables: [{ type: "url", value: "https://example.com/pkg.whl", where: "w", tier: "declared" }, { type: "domain", value: "example.com", where: "w", tier: "declared" }], provenance: { packages: 0, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "index is configuration, not per-requirement; --hash pins are not read" });
});

test('plain package name records package observable', () => {
  const r = extractRequirements('requests', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "requests", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "index is configuration, not per-requirement; --hash pins are not read" });
});

test('package with extras and version records package observable', () => {
  const r = extractRequirements('requests[security]==2.0.0', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "requests", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false }, note: "index is configuration, not per-requirement; --hash pins are not read" });
});

test('file URL in direct requirement is not recorded as URL observable', () => {
  const r = extractRequirements('pkg @ file:///local/path.whl', 'w');
  assert.deepEqual(r, { observables: [{ type: "package", value: "pkg", where: "w", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: false, canDigest: false }, note: "index is configuration, not per-requirement; --hash pins are not read" });
});

test('provenance canOrigin is false for requirements files', () => {
  const r = extractRequirements('requests', 'w');
  assert.equal(r.provenance.canOrigin, false);
});

test('provenance canDigest is false for requirements files', () => {
  const r = extractRequirements('requests', 'w');
  assert.equal(r.provenance.canDigest, false);
});
