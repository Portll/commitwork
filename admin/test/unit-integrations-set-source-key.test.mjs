// Stores a source API key in the integrations store (admin/integrations.mjs setSourceKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSourceKey } from '../integrations.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'setSourceKey-'));
const storePath = join(dir, 'store.json');

try {
  process.env.CW_INTEGRATIONS_STORE = storePath;

  test('stores a known source key and returns name and addedAt', () => {
    const result = setSourceKey('vulncheck', '  abc123  ');
    assert.equal(result.name, 'vulncheck');
    assert.match(result.addedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const raw = readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.sources.vulncheck.key, 'abc123');
    assert.equal(parsed.sources.vulncheck.addedAt, result.addedAt);
  });

  test('rejects an unknown source name', () => {
    assert.throws(() => setSourceKey('unknown', 'key'), /unknown integration source 'unknown'/);
  });

  test('rejects an empty key', () => {
    assert.throws(() => setSourceKey('vulncheck', ''), /key must not be empty/);
  });

  test('rejects a whitespace-only key', () => {
    assert.throws(() => setSourceKey('vulncheck', '   '), /key must not be empty/);
  });

  test('rejects a null key', () => {
    assert.throws(() => setSourceKey('vulncheck', null), /key must not be empty/);
  });

  test('rejects a non-string key that trims to empty', () => {
    assert.throws(() => setSourceKey('vulncheck', 0), /key must not be empty/);
  });

  test('stores a key for sonatype source', () => {
    const result = setSourceKey('sonatype', 'son-key-1');
    assert.equal(result.name, 'sonatype');
    const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(parsed.sources.sonatype.key, 'son-key-1');
  });

  test('stores a key for snyk source', () => {
    const result = setSourceKey('snyk', 'snyk-key-1');
    assert.equal(result.name, 'snyk');
    const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(parsed.sources.snyk.key, 'snyk-key-1');
  });

  test('overwrites an existing key for the same source', () => {
    setSourceKey('vulncheck', 'first-key');
    const result = setSourceKey('vulncheck', 'second-key');
    assert.equal(result.name, 'vulncheck');
    const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(parsed.sources.vulncheck.key, 'second-key');
  });

  test('fails when the store file is corrupt', () => {
    const corruptPath = join(dir, 'corrupt.json');
    writeFileSync(corruptPath, 'not valid json{{{');
    process.env.CW_INTEGRATIONS_STORE = corruptPath;
    assert.throws(() => setSourceKey('vulncheck', 'key'), /not valid JSON/);
    process.env.CW_INTEGRATIONS_STORE = storePath;
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
