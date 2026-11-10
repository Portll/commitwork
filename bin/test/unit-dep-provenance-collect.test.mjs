// Aggregates lockfile packages into a provenance inventory (bin/dep-provenance.mjs collect).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../dep-provenance.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns no-subject when no lockfiles exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  try {
    const r = collect(dir);
    assert.deepEqual(r, { ran: false, reason: "no-subject", detail: "no yarn.lock or package-lock.json in the tree", packages: {}, counts: {}, lockfiles: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when all lockfiles fail to parse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  try {
    writeFileSync(join(dir, 'yarn.lock'), 'not valid');
    const r = collect(dir);
    assert.deepEqual(r, { ran: true, packages: {}, counts: {}, lockfiles: [{ lockfile: "yarn.lock", packages: 0 }], vocabulary: { registry: "resolved from a package registry \u2014 the ordinary case, and the only one advisories describe", git: "resolved from a git remote \u2014 no registry mediates it, so no registry advisory applies and no registry revocation reaches it", file: "resolved from a local path \u2014 outside every scanner in this fleet", archive: "resolved from a URL to a tarball \u2014 pinned to a host, not to a registry identity", unknown: "the lockfile stated no resolution this parser recognises \u2014 not the same as \"registry\"" }, note: "INVENTORY, not findings. A git-resolved dependency is an ordinary choice; the event is a dependency MOVING off a registry between slices, which only a comparison can see." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('records conflict when same package has different resolutions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  try {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    writeFileSync(join(dir, 'a', 'yarn.lock'), 'lodash@^4.0.0:\n  version "4.17.21"\n  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"\n  integrity sha512-abc\n');
    writeFileSync(join(dir, 'b', 'yarn.lock'), 'lodash@^4.0.0:\n  version "4.17.20"\n  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz"\n  integrity sha512-def\n');
    const r = collect(dir);
    assert.deepEqual(r, { ran: true, packages: { lodash: { resolution: "registry", target: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz", lockfile: "a/yarn.lock" } }, counts: { registry: 1 }, lockfiles: [{ lockfile: "a/yarn.lock", packages: 1 }, { lockfile: "b/yarn.lock", packages: 1 }], vocabulary: { registry: "resolved from a package registry \u2014 the ordinary case, and the only one advisories describe", git: "resolved from a git remote \u2014 no registry mediates it, so no registry advisory applies and no registry revocation reaches it", file: "resolved from a local path \u2014 outside every scanner in this fleet", archive: "resolved from a URL to a tarball \u2014 pinned to a host, not to a registry identity", unknown: "the lockfile stated no resolution this parser recognises \u2014 not the same as \"registry\"" }, note: "INVENTORY, not findings. A git-resolved dependency is an ordinary choice; the event is a dependency MOVING off a registry between slices, which only a comparison can see." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps first lockfile entry when same resolution appears twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  try {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    writeFileSync(join(dir, 'a', 'yarn.lock'), 'lodash@^4.0.0:\n  version "4.17.21"\n  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"\n  integrity sha512-abc\n');
    writeFileSync(join(dir, 'b', 'yarn.lock'), 'lodash@^4.0.0:\n  version "4.17.21"\n  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"\n  integrity sha512-abc\n');
    const r = collect(dir);
    assert.deepEqual(r, { ran: true, packages: { lodash: { resolution: "registry", target: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz", lockfile: "a/yarn.lock" } }, counts: { registry: 1 }, lockfiles: [{ lockfile: "a/yarn.lock", packages: 1 }, { lockfile: "b/yarn.lock", packages: 1 }], vocabulary: { registry: "resolved from a package registry \u2014 the ordinary case, and the only one advisories describe", git: "resolved from a git remote \u2014 no registry mediates it, so no registry advisory applies and no registry revocation reaches it", file: "resolved from a local path \u2014 outside every scanner in this fleet", archive: "resolved from a URL to a tarball \u2014 pinned to a host, not to a registry identity", unknown: "the lockfile stated no resolution this parser recognises \u2014 not the same as \"registry\"" }, note: "INVENTORY, not findings. A git-resolved dependency is an ordinary choice; the event is a dependency MOVING off a registry between slices, which only a comparison can see." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts resolutions correctly across multiple packages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  try {
    writeFileSync(join(dir, 'yarn.lock'), 'lodash@^4.0.0:\n  version "4.17.21"\n  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"\n  integrity sha512-abc\nreact@^18.0.0:\n  version "18.2.0"\n  resolved "https://registry.npmjs.org/react/-/react-18.2.0.tgz"\n  integrity sha512-def\n');
    const r = collect(dir);
    assert.deepEqual(r, { ran: true, packages: { lodash: { resolution: "registry", target: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz", lockfile: "yarn.lock" }, react: { resolution: "registry", target: "https://registry.npmjs.org/react/-/react-18.2.0.tgz", lockfile: "yarn.lock" } }, counts: { registry: 2 }, lockfiles: [{ lockfile: "yarn.lock", packages: 2 }], vocabulary: { registry: "resolved from a package registry \u2014 the ordinary case, and the only one advisories describe", git: "resolved from a git remote \u2014 no registry mediates it, so no registry advisory applies and no registry revocation reaches it", file: "resolved from a local path \u2014 outside every scanner in this fleet", archive: "resolved from a URL to a tarball \u2014 pinned to a host, not to a registry identity", unknown: "the lockfile stated no resolution this parser recognises \u2014 not the same as \"registry\"" }, note: "INVENTORY, not findings. A git-resolved dependency is an ordinary choice; the event is a dependency MOVING off a registry between slices, which only a comparison can see." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles package-lock.json format', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  try {
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
      name: 'test',
      lockfileVersion: 3,
      packages: {
        'node_modules/lodash': {
          version: '4.17.21',
          resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          integrity: 'sha512-abc'
        }
      }
    }));
    const r = collect(dir);
    assert.deepEqual(r, { ran: true, packages: { lodash: { resolution: "registry", target: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz", lockfile: "package-lock.json" } }, counts: { registry: 1 }, lockfiles: [{ lockfile: "package-lock.json", packages: 1 }], vocabulary: { registry: "resolved from a package registry \u2014 the ordinary case, and the only one advisories describe", git: "resolved from a git remote \u2014 no registry mediates it, so no registry advisory applies and no registry revocation reaches it", file: "resolved from a local path \u2014 outside every scanner in this fleet", archive: "resolved from a URL to a tarball \u2014 pinned to a host, not to a registry identity", unknown: "the lockfile stated no resolution this parser recognises \u2014 not the same as \"registry\"" }, note: "INVENTORY, not findings. A git-resolved dependency is an ordinary choice; the event is a dependency MOVING off a registry between slices, which only a comparison can see." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks ran as true when at least one lockfile parses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  try {
    writeFileSync(join(dir, 'yarn.lock'), 'lodash@^4.0.0:\n  version "4.17.21"\n  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"\n  integrity sha512-abc\n');
    const r = collect(dir);
    assert.deepEqual(r, { ran: true, packages: { lodash: { resolution: "registry", target: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz", lockfile: "yarn.lock" } }, counts: { registry: 1 }, lockfiles: [{ lockfile: "yarn.lock", packages: 1 }], vocabulary: { registry: "resolved from a package registry \u2014 the ordinary case, and the only one advisories describe", git: "resolved from a git remote \u2014 no registry mediates it, so no registry advisory applies and no registry revocation reaches it", file: "resolved from a local path \u2014 outside every scanner in this fleet", archive: "resolved from a URL to a tarball \u2014 pinned to a host, not to a registry identity", unknown: "the lockfile stated no resolution this parser recognises \u2014 not the same as \"registry\"" }, note: "INVENTORY, not findings. A git-resolved dependency is an ordinary choice; the event is a dependency MOVING off a registry between slices, which only a comparison can see." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes unreadable array when a lockfile fails to read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  try {
    writeFileSync(join(dir, 'yarn.lock'), 'lodash@^4.0.0:\n  version "4.17.21"\n  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"\n  integrity sha512-abc\n');
    writeFileSync(join(dir, 'package-lock.json'), 'not json');
    const r = collect(dir);
    assert.deepEqual(r, { ran: true, packages: { lodash: { resolution: "registry", target: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz", lockfile: "yarn.lock" } }, counts: { registry: 1 }, lockfiles: [{ lockfile: "yarn.lock", packages: 1 }], unreadable: [{ lockfile: "package-lock.json", error: "Unexpected token 'o', \"not json\" is not valid JSON" }], vocabulary: { registry: "resolved from a package registry \u2014 the ordinary case, and the only one advisories describe", git: "resolved from a git remote \u2014 no registry mediates it, so no registry advisory applies and no registry revocation reaches it", file: "resolved from a local path \u2014 outside every scanner in this fleet", archive: "resolved from a URL to a tarball \u2014 pinned to a host, not to a registry identity", unknown: "the lockfile stated no resolution this parser recognises \u2014 not the same as \"registry\"" }, note: "INVENTORY, not findings. A git-resolved dependency is an ordinary choice; the event is a dependency MOVING off a registry between slices, which only a comparison can see." });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
