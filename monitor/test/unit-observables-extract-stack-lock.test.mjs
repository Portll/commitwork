// Extracts package and sha256 observables from a stack.yaml.lock text (monitor/observables.mjs extractStackLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStackLock } from '../observables.mjs';

const sha = 'a'.repeat(64);
const where = 'stack.yaml.lock';

test('returns unknown when no packages block is present', () => {
  const r = extractStackLock('foo: bar\n', where);
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "stack.yaml.lock: no packages: block \u2014 not a stack.yaml.lock this reader knows" });
});

test('returns unknown when packages block has no hackage pins', () => {
  const r = extractStackLock('packages:\n  foo: bar\n', where);
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "stack.yaml.lock: a packages: block with no hackage: pins \u2014 snapshot-only lockfiles carry no package set to read" });
});

test('extracts one package and one sha256 observable', () => {
  const text = `packages:\n  foo:\n    hackage: mypkg-1.0.0@sha256:${sha}\n`;
  const r = extractStackLock(text, where);
  assert.deepEqual(r, { observables: [{ type: "package", value: "mypkg", where: "stack.yaml.lock", tier: "declared" }, { type: "sha256", value: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", where: "stack.yaml.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: false, canDigest: true } });
});

test('extracts multiple packages with distinct names', () => {
  const text = `packages:\n  a:\n    hackage: alpha-1.0.0@sha256:${sha}\n  b:\n    hackage: beta-2.1.0@sha256:${sha}\n`;
  const r = extractStackLock(text, where);
  assert.deepEqual(r, { observables: [{ type: "package", value: "alpha", where: "stack.yaml.lock", tier: "declared" }, { type: "sha256", value: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", where: "stack.yaml.lock", tier: "declared" }, { type: "package", value: "beta", where: "stack.yaml.lock", tier: "declared" }, { type: "sha256", value: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", where: "stack.yaml.lock", tier: "declared" }], provenance: { packages: 2, withOrigin: 0, withDigest: 2, canOrigin: false, canDigest: true } });
});

test('handles package name with hyphens and digits', () => {
  const text = `packages:\n  x:\n    hackage: my-pkg-1.2.3@sha256:${sha}\n`;
  const r = extractStackLock(text, where);
  assert.deepEqual(r, { observables: [{ type: "package", value: "my-pkg", where: "stack.yaml.lock", tier: "declared" }, { type: "sha256", value: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", where: "stack.yaml.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: false, canDigest: true } });
});

test('handles sha256 with mixed hex characters', () => {
  const mixedSha = '0123456789abcdef'.repeat(4);
  const text = `packages:\n  y:\n    hackage: zeta-0.9.0@sha256:${mixedSha}\n`;
  const r = extractStackLock(text, where);
  assert.deepEqual(r, { observables: [{ type: "package", value: "zeta", where: "stack.yaml.lock", tier: "declared" }, { type: "sha256", value: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", where: "stack.yaml.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: false, canDigest: true } });
});

test('handles version with dots and underscores', () => {
  const text = `packages:\n  w:\n    hackage: gamma-1.0.0_rc1@sha256:${sha}\n`;
  const r = extractStackLock(text, where);
  assert.deepEqual(r, { observables: [{ type: "package", value: "gamma", where: "stack.yaml.lock", tier: "declared" }, { type: "sha256", value: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", where: "stack.yaml.lock", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: false, canDigest: true } });
});

test('returns unknown for empty text', () => {
  const r = extractStackLock('', where);
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "stack.yaml.lock: no packages: block \u2014 not a stack.yaml.lock this reader knows" });
});
