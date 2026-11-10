// The release name scope built from the three on-disk scope documents, or null when no manifest exists (bin/lib/release-names-head-scan.mjs loadDiskScope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDiskScope } from '../lib/release-names-head-scan.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withScopeDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'loadDiskScope-'));
  const paths = {
    manifest: join(dir, 'release-redactions.json'),
    publish: join(dir, 'publish-redactions.json'),
    identity: join(dir, 'repo-identities.json'),
  };
  process.env.CW_RELEASE_REDACTIONS = paths.manifest;
  process.env.CW_PUBLISH_REDACTIONS = paths.publish;
  process.env.CW_REPO_IDENTITIES = paths.identity;
  try {
    fn(paths);
  } finally {
    delete process.env.CW_RELEASE_REDACTIONS;
    delete process.env.CW_PUBLISH_REDACTIONS;
    delete process.env.CW_REPO_IDENTITIES;
    rmSync(dir, { recursive: true, force: true });
  }
};

const unreadable = (what, path, code) => `release-redactions: the ${what} is unreadable at ${path} (${code}) \u2014 `
  + 'refusing to scan with part of the name scope missing, which would report clean over it';
const invalid = (what, path) => `release-redactions: the ${what} at ${path} is not valid JSON `
  + `(Unexpected token 'o', "not json" is not valid JSON)`;

test('returns null when the release manifest is absent even though the other documents exist', () => {
  withScopeDir((p) => {
    writeFileSync(p.publish, JSON.stringify({ publish: {} }));
    writeFileSync(p.identity, JSON.stringify({ identities: {} }));
    const r = loadDiskScope();
    assert.equal(r, null);
  });
});

test('returns null when none of the three scope documents exist', () => {
  withScopeDir(() => {
    const r = loadDiskScope();
    assert.equal(r, null);
  });
});

test('passes all three parsed documents to buildScope, which rejects a manifest without names', () => {
  withScopeDir((p) => {
    writeFileSync(p.manifest, JSON.stringify({ release: {} }));
    writeFileSync(p.publish, JSON.stringify({ publish: {} }));
    writeFileSync(p.identity, JSON.stringify({ identities: {} }));
    assert.throws(() => loadDiskScope(), {
      name: 'Error',
      message: 'release-scope: the release manifest has no names[] \u2014 refusing to build a scope '
        + 'that would report clean over names it never loaded',
    });
  });
});

test('throws a not-valid-JSON error naming the release manifest when it does not parse', () => {
  withScopeDir((p) => {
    writeFileSync(p.manifest, 'not json');
    writeFileSync(p.publish, JSON.stringify({ publish: {} }));
    writeFileSync(p.identity, JSON.stringify({ identities: {} }));
    assert.throws(() => loadDiskScope(), { name: 'Error', message: invalid('release manifest', p.manifest) });
  });
});

test('throws an unreadable error when the release manifest path is a directory', () => {
  withScopeDir((p) => {
    mkdirSync(p.manifest);
    writeFileSync(p.publish, JSON.stringify({ publish: {} }));
    writeFileSync(p.identity, JSON.stringify({ identities: {} }));
    assert.throws(() => loadDiskScope(), { name: 'Error', message: unreadable('release manifest', p.manifest, 'EISDIR') });
  });
});

test('throws a not-valid-JSON error naming the publish map when it does not parse', () => {
  withScopeDir((p) => {
    writeFileSync(p.manifest, JSON.stringify({ release: {} }));
    writeFileSync(p.publish, 'not json');
    writeFileSync(p.identity, JSON.stringify({ identities: {} }));
    assert.throws(() => loadDiskScope(), { name: 'Error', message: invalid('publish map', p.publish) });
  });
});

test('throws an unreadable ENOENT error when the manifest exists but the publish map is missing', () => {
  withScopeDir((p) => {
    writeFileSync(p.manifest, JSON.stringify({ release: {} }));
    writeFileSync(p.identity, JSON.stringify({ identities: {} }));
    assert.throws(() => loadDiskScope(), { name: 'Error', message: unreadable('publish map', p.publish, 'ENOENT') });
  });
});

test('throws a not-valid-JSON error naming the identity register when it does not parse', () => {
  withScopeDir((p) => {
    writeFileSync(p.manifest, JSON.stringify({ release: {} }));
    writeFileSync(p.publish, JSON.stringify({ publish: {} }));
    writeFileSync(p.identity, 'not json');
    assert.throws(() => loadDiskScope(), { name: 'Error', message: invalid('identity register', p.identity) });
  });
});

test('throws an unreadable ENOENT error when the identity register is missing', () => {
  withScopeDir((p) => {
    writeFileSync(p.manifest, JSON.stringify({ release: {} }));
    writeFileSync(p.publish, JSON.stringify({ publish: {} }));
    assert.throws(() => loadDiskScope(), { name: 'Error', message: unreadable('identity register', p.identity, 'ENOENT') });
  });
});
