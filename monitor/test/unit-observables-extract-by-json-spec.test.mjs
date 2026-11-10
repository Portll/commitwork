// Extracts package, URL, domain, and digest observables from JSON text per a spec (monitor/observables.mjs extractByJsonSpec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractByJsonSpec } from '../observables.mjs';

test('returns unknown when no spec arrays are present in the parsed JSON', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: [], digest: [] };
  const text = JSON.stringify({ other: [] });
  const r = extractByJsonSpec(spec, text, 'test.json');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "test.json: none of packages is an array \u2014 this is a shape the declared spec does not describe, not a lockfile with no packages" });
});

test('skips non-object nodes in the array', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: [], digest: [] };
  const text = JSON.stringify({ packages: [null, 42, { name: 'pkg' }] });
  const r = extractByJsonSpec(spec, text, 'test.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "pkg", where: "test.json", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('skips object nodes with a falsy name', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: [], digest: [] };
  const text = JSON.stringify({ packages: [{ name: '' }, { name: 'real' }] });
  const r = extractByJsonSpec(spec, text, 'test.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "real", where: "test.json", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('counts each named package once in provenance', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: [], digest: [] };
  const text = JSON.stringify({ packages: [{ name: 'a' }, { name: 'b' }] });
  const r = extractByJsonSpec(spec, text, 'test.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "a", where: "test.json", tier: "declared" }, { type: "package", value: "b", where: "test.json", tier: "declared" }], provenance: { packages: 2, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('records origin URL and domain for a valid http URL', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: ['url'], digest: [] };
  const text = JSON.stringify({ packages: [{ name: 'pkg', url: 'https://example.com/pkg' }] });
  const r = extractByJsonSpec(spec, text, 'test.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "pkg", where: "test.json", tier: "declared" }, { type: "url", value: "https://example.com/pkg", where: "test.json", tier: "declared" }, { type: "domain", value: "example.com", where: "test.json", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('ignores non-string origin values', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: ['url'], digest: [] };
  const text = JSON.stringify({ packages: [{ name: 'pkg', url: 123 }] });
  const r = extractByJsonSpec(spec, text, 'test.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "pkg", where: "test.json", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('records digest value when it is a non-empty string', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: [], digest: [{ path: 'integrity', algo: 'sha512' }] };
  const text = JSON.stringify({ packages: [{ name: 'pkg', integrity: 'abc123' }] });
  const r = extractByJsonSpec(spec, text, 'test.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "pkg", where: "test.json", tier: "declared" }, { type: "sha512", value: "abc123", where: "test.json", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 1, canOrigin: true, canDigest: true } });
});

test('ignores empty-string digest values', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: [], digest: [{ path: 'integrity', algo: 'sha512' }] };
  const text = JSON.stringify({ packages: [{ name: 'pkg', integrity: '   ' }] });
  const r = extractByJsonSpec(spec, text, 'test.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "pkg", where: "test.json", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('ignores non-string digest values', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: [], digest: [{ path: 'integrity', algo: 'sha512' }] };
  const text = JSON.stringify({ packages: [{ name: 'pkg', integrity: 42 }] });
  const r = extractByJsonSpec(spec, text, 'test.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "pkg", where: "test.json", tier: "declared" }], provenance: { packages: 1, withOrigin: 0, withDigest: 0, canOrigin: true, canDigest: true } });
});

test('returns unknown for unparseable JSON', () => {
  const spec = { arrays: ['packages'], name: 'name', origin: [], digest: [] };
  const r = extractByJsonSpec(spec, 'not json', 'test.json');
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "test.json: Unexpected token 'o', \"not json\" is not valid JSON" });
});
