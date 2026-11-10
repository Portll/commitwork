// Extracts package names, digests, and tarball origins from a pnpm v9 lockfile (monitor/observables.mjs extractPnpmLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPnpmLock } from '../observables.mjs';

test('returns unknown when the lockfile uses a YAML anchor', () => {
  const text = 'packages:\n  foo:\n    resolution: { integrity: sha512-abc }\n    &anchor: value';
  assert.deepEqual(extractPnpmLock(text, 'lockfile'), { observables: [{ type: "package", value: "foo", where: "lockfile", tier: "declared" }, { type: "sha512", value: "abc", where: "lockfile", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: false, canDigest: true }, note: "pnpm v9 packages block; origins appear only for tarball resolutions" });
});

test('returns unknown when multiple documents declare packages', () => {
  const text = 'packages:\n  foo:\n---\npackages:\n  bar:';
  assert.deepEqual(extractPnpmLock(text, 'lockfile'), { unknown: true, unknownReason: "unexaminable", unknownDetail: "lockfile: 2 documents each declare a `packages:` block \u2014 which one is authoritative is not this reader's call" });
});

test('returns unknown when a resolution is a block scalar', () => {
  const text = 'packages:\n  foo:\n    resolution: |-\n      hidden';
  assert.deepEqual(extractPnpmLock(text, 'lockfile'), { unknown: true, unknownReason: "unexaminable", unknownDetail: "lockfile: a `resolution` is written as a block scalar \u2014 refused rather than half-read" });
});

test('returns unknown when no packages block is present', () => {
  const text = 'lockfileVersion: 9';
  assert.deepEqual(extractPnpmLock(text, 'lockfile'), { unknown: true, unknownReason: "unstated", unknownDetail: "lockfile: no top-level `packages:` block \u2014 this reader targets pnpm v9 and this is a shape it does not know" });
});

test('extracts package names and digests from a standard packages block', () => {
  const text = 'packages:\n  foo:\n    resolution: { integrity: sha512-abc }\n  bar:\n    resolution: { integrity: sha256-def }';
  assert.deepEqual(extractPnpmLock(text, 'lockfile'), { observables: [{ type: "package", value: "foo", where: "lockfile", tier: "declared" }, { type: "sha512", value: "abc", where: "lockfile", tier: "declared" }, { type: "package", value: "bar", where: "lockfile", tier: "declared" }, { type: "sha256", value: "def", where: "lockfile", tier: "declared" }], provenance: { packages: 2, withOrigin: 0, withDigest: 2, canOrigin: false, canDigest: true }, note: "pnpm v9 packages block; origins appear only for tarball resolutions" });
});

test('extracts tarball origins for non-registry packages', () => {
  const text = 'packages:\n  foo:\n    resolution: { tarball: https://example.com/pkg.tgz, integrity: sha512-abc }';
  assert.deepEqual(extractPnpmLock(text, 'lockfile'), { observables: [{ type: "package", value: "foo", where: "lockfile", tier: "declared" }, { type: "sha512", value: "abc", where: "lockfile", tier: "declared" }, { type: "url", value: "https://example.com/pkg.tgz", where: "lockfile", tier: "declared" }, { type: "domain", value: "example.com", where: "lockfile", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 1, canOrigin: false, canDigest: true }, note: "pnpm v9 packages block; origins appear only for tarball resolutions" });
});

test('handles a single document with a leading separator', () => {
  const text = '---\npackages:\n  foo:\n    resolution: { integrity: sha512-abc }';
  assert.deepEqual(extractPnpmLock(text, 'lockfile'), { observables: [{ type: "package", value: "foo", where: "lockfile", tier: "declared" }, { type: "sha512", value: "abc", where: "lockfile", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: false, canDigest: true }, note: "pnpm v9 packages block; origins appear only for tarball resolutions" });
});

test('returns unknown when a resolution contains a nested flow mapping', () => {
  const text = 'packages:\n  foo:\n    resolution: { nested: { a: 1 } }';
  assert.deepEqual(extractPnpmLock(text, 'lockfile'), { unknown: true, unknownReason: "unexaminable", unknownDetail: "lockfile: nested flow mapping in a resolution \u2014 refused rather than flattened" });
});
