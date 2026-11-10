// Extracts package names, URLs, domains, and digests from npm lockfiles (monitor/observables.mjs extractNpmLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNpmLock } from '../observables.mjs';

test('parses v2 lockfile with packages and counts provenance', () => {
  const text = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      '': { name: 'root' },
      'node_modules/left': { name: 'left', resolved: 'https://x.com/a.tgz', integrity: 'sha512-abc' },
      'node_modules/right': { name: 'right', resolved: 'file:../local', integrity: 'sha256-def' }
    }
  });
  const r = extractNpmLock(text, 'lock.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "left", where: "lock.json", tier: "declared" }, { type: "url", value: "https://x.com/a.tgz", where: "lock.json", tier: "declared" }, { type: "domain", value: "x.com", where: "lock.json", tier: "declared" }, { type: "sha512", value: "abc", where: "lock.json", tier: "declared" }, { type: "package", value: "right", where: "lock.json", tier: "declared" }, { type: "sha256", value: "def", where: "lock.json", tier: "declared" }], provenance: { packages: 2, withOrigin: 1, withDigest: 2, canOrigin: true, canDigest: true }, note: "lockfileVersion 2" });
});

test('parses v1 lockfile with nested dependencies', () => {
  const text = JSON.stringify({
    lockfileVersion: 1,
    dependencies: {
      a: { resolved: 'https://a.com/a.tgz', integrity: 'sha1-aaa', dependencies: { b: { resolved: 'https://b.com/b.tgz', integrity: 'sha256-bbb' } } },
      c: { resolved: 'link:../c', integrity: 'sha512-ccc' }
    }
  });
  const r = extractNpmLock(text, 'lock.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "a", where: "lock.json", tier: "declared" }, { type: "url", value: "https://a.com/a.tgz", where: "lock.json", tier: "declared" }, { type: "domain", value: "a.com", where: "lock.json", tier: "declared" }, { type: "sha1", value: "aaa", where: "lock.json", tier: "declared" }, { type: "package", value: "b", where: "lock.json", tier: "declared" }, { type: "url", value: "https://b.com/b.tgz", where: "lock.json", tier: "declared" }, { type: "domain", value: "b.com", where: "lock.json", tier: "declared" }, { type: "sha256", value: "bbb", where: "lock.json", tier: "declared" }, { type: "package", value: "c", where: "lock.json", tier: "declared" }, { type: "sha512", value: "ccc", where: "lock.json", tier: "declared" }], provenance: { packages: 3, withOrigin: 2, withDigest: 3, canOrigin: true, canDigest: true }, note: "lockfileVersion 1" });
});

test('returns unknown for unparseable JSON', () => {
  const r = extractNpmLock('not json', 'lock.json');
  assert.deepEqual(r, { unknown: true, unknownReason: "unparseable", unknownDetail: "lock.json: Unexpected token 'o', \"not json\" is not valid JSON" });
});

test('returns unknown for lockfile with neither packages nor dependencies', () => {
  const text = JSON.stringify({ lockfileVersion: 3 });
  const r = extractNpmLock(text, 'lock.json');
  assert.deepEqual(r, { unknown: true, unknownReason: "unstated", unknownDetail: "lock.json: lockfileVersion 3 has neither packages{} nor dependencies{} \u2014 this is not a tree with no dependencies, it is a shape this extractor does not read" });
});

test('skips non-object nodes in packages', () => {
  const text = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      'node_modules/good': { name: 'good', resolved: 'https://g.com/g.tgz', integrity: 'sha512-ggg' },
      'node_modules/bad': 'string-node',
      'node_modules/null': null
    }
  });
  const r = extractNpmLock(text, 'lock.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "good", where: "lock.json", tier: "declared" }, { type: "url", value: "https://g.com/g.tgz", where: "lock.json", tier: "declared" }, { type: "domain", value: "g.com", where: "lock.json", tier: "declared" }, { type: "sha512", value: "ggg", where: "lock.json", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 1, canOrigin: true, canDigest: true }, note: "lockfileVersion 2" });
});

test('handles missing lockfileVersion as unstated', () => {
  const text = JSON.stringify({
    packages: {
      'node_modules/x': { name: 'x', resolved: 'https://x.com/x.tgz', integrity: 'sha256-xxx' }
    }
  });
  const r = extractNpmLock(text, 'lock.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "x", where: "lock.json", tier: "declared" }, { type: "url", value: "https://x.com/x.tgz", where: "lock.json", tier: "declared" }, { type: "domain", value: "x.com", where: "lock.json", tier: "declared" }, { type: "sha256", value: "xxx", where: "lock.json", tier: "declared" }], provenance: { packages: 1, withOrigin: 1, withDigest: 1, canOrigin: true, canDigest: true }, note: "lockfileVersion unstated" });
});

test('counts origin only for non-local resolved URLs', () => {
  const text = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      'node_modules/remote': { name: 'remote', resolved: 'https://remote.com/r.tgz', integrity: 'sha512-rrr' },
      'node_modules/local': { name: 'local', resolved: 'file:../local', integrity: 'sha256-lll' },
      'node_modules/portal': { name: 'portal', resolved: 'portal:../portal', integrity: 'sha1-ppp' }
    }
  });
  const r = extractNpmLock(text, 'lock.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "remote", where: "lock.json", tier: "declared" }, { type: "url", value: "https://remote.com/r.tgz", where: "lock.json", tier: "declared" }, { type: "domain", value: "remote.com", where: "lock.json", tier: "declared" }, { type: "sha512", value: "rrr", where: "lock.json", tier: "declared" }, { type: "package", value: "local", where: "lock.json", tier: "declared" }, { type: "sha256", value: "lll", where: "lock.json", tier: "declared" }, { type: "package", value: "portal", where: "lock.json", tier: "declared" }, { type: "sha1", value: "ppp", where: "lock.json", tier: "declared" }], provenance: { packages: 3, withOrigin: 1, withDigest: 3, canOrigin: true, canDigest: true }, note: "lockfileVersion 2" });
});

test('handles empty integrity string as no digest', () => {
  const text = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      'node_modules/e': { name: 'e', resolved: 'https://e.com/e.tgz', integrity: '' },
      'node_modules/f': { name: 'f', resolved: 'https://f.com/f.tgz', integrity: 'sha512-fff' }
    }
  });
  const r = extractNpmLock(text, 'lock.json');
  assert.deepEqual(r, { observables: [{ type: "package", value: "e", where: "lock.json", tier: "declared" }, { type: "url", value: "https://e.com/e.tgz", where: "lock.json", tier: "declared" }, { type: "domain", value: "e.com", where: "lock.json", tier: "declared" }, { type: "package", value: "f", where: "lock.json", tier: "declared" }, { type: "url", value: "https://f.com/f.tgz", where: "lock.json", tier: "declared" }, { type: "domain", value: "f.com", where: "lock.json", tier: "declared" }, { type: "sha512", value: "fff", where: "lock.json", tier: "declared" }], provenance: { packages: 2, withOrigin: 2, withDigest: 1, canOrigin: true, canDigest: true }, note: "lockfileVersion 2" });
});
