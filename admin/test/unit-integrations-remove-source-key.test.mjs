// Remove a source key from the integrations store (admin/integrations.mjs removeSourceKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeSourceKey } from '../integrations.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'removeSourceKey-'));
  const storeDir = join(dir, 'store');
  mkdirSync(storeDir, { recursive: true });
  const storePath = join(storeDir, 'integrations.json');
  return { dir, storePath };
}

test('removes an existing source key and returns removed true', () => {
  const { dir, storePath } = setup();
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, sources: { vulncheck: 'abc123' } }));
    process.env.CW_INTEGRATIONS_STORE = storePath;
    const result = removeSourceKey('vulncheck');
    assert.deepEqual(result, { name: 'vulncheck', removed: true });
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(saved.sources.vulncheck, undefined);
  } finally {
    delete process.env.CW_INTEGRATIONS_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns removed false when the source key is absent', () => {
  const { dir, storePath } = setup();
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, sources: { sonatype: 'xyz' } }));
    process.env.CW_INTEGRATIONS_STORE = storePath;
    const result = removeSourceKey('vulncheck');
    assert.deepEqual(result, { name: 'vulncheck', removed: false });
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(saved.sources.sonatype, 'xyz');
    assert.equal(saved.sources.vulncheck, undefined);
  } finally {
    delete process.env.CW_INTEGRATIONS_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws for an unknown source name', () => {
  const { dir, storePath } = setup();
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, sources: {} }));
    process.env.CW_INTEGRATIONS_STORE = storePath;
    assert.throws(() => removeSourceKey('bogus'), /unknown integration source 'bogus'/);
  } finally {
    delete process.env.CW_INTEGRATIONS_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles an empty store when the file is absent', () => {
  const { dir, storePath } = setup();
  try {
    process.env.CW_INTEGRATIONS_STORE = storePath;
    const result = removeSourceKey('snyk');
    assert.deepEqual(result, { name: 'snyk', removed: false });
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.deepEqual(saved, { version: 1, sources: {} });
  } finally {
    delete process.env.CW_INTEGRATIONS_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removes snyk key from a store with multiple sources', () => {
  const { dir, storePath } = setup();
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, sources: { vulncheck: 'a', sonatype: 'b', snyk: 'c' } }));
    process.env.CW_INTEGRATIONS_STORE = storePath;
    const result = removeSourceKey('snyk');
    assert.deepEqual(result, { name: 'snyk', removed: true });
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(saved.sources.vulncheck, 'a');
    assert.equal(saved.sources.sonatype, 'b');
    assert.equal(saved.sources.snyk, undefined);
  } finally {
    delete process.env.CW_INTEGRATIONS_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removes sonatype key and preserves other sources', () => {
  const { dir, storePath } = setup();
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, sources: { sonatype: 'key1', vulncheck: 'key2' } }));
    process.env.CW_INTEGRATIONS_STORE = storePath;
    const result = removeSourceKey('sonatype');
    assert.deepEqual(result, { name: 'sonatype', removed: true });
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(saved.sources.sonatype, undefined);
    assert.equal(saved.sources.vulncheck, 'key2');
  } finally {
    delete process.env.CW_INTEGRATIONS_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});
