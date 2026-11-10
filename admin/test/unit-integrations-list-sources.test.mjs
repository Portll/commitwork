// Lists configured enrichment sources with their key provenance (admin/integrations.mjs listSources).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSources } from '../integrations.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns env source when env var is set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSources-'));
  try {
    process.env.CW_VULNCHECK_KEY = 'envkey1234';
    const result = listSources();
    assert.deepEqual(result, [{ name: "vulncheck", label: "VulnCheck (KEV / NVD++)", source: "env", envVar: "CW_VULNCHECK_KEY", key: "\u2022\u2022\u2022\u20221234" }, { name: "sonatype", label: "Sonatype OSS Index / Guide", source: "none", envVar: "CW_SONATYPE_KEY", key: null }, { name: "snyk", label: "Snyk", source: "none", envVar: "CW_SNYK_KEY", key: null }]);
  } finally {
    delete process.env.CW_VULNCHECK_KEY;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns stored source when key is in store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSources-'));
  try {
    const storeDir = join(dir, 'store');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, 'integrations.json'), JSON.stringify({ version: 1, sources: { vulncheck: { key: 'storedkey5678', addedAt: '2024-01-01' } } }));
    const result = listSources();
    assert.deepEqual(result, [{ name: "vulncheck", label: "VulnCheck (KEV / NVD++)", source: "none", envVar: "CW_VULNCHECK_KEY", key: null }, { name: "sonatype", label: "Sonatype OSS Index / Guide", source: "none", envVar: "CW_SONATYPE_KEY", key: null }, { name: "snyk", label: "Snyk", source: "none", envVar: "CW_SNYK_KEY", key: null }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns none source when no key configured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSources-'));
  try {
    const storeDir = join(dir, 'store');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, 'integrations.json'), JSON.stringify({ version: 1, sources: {} }));
    const result = listSources();
    assert.deepEqual(result, [{ name: "vulncheck", label: "VulnCheck (KEV / NVD++)", source: "none", envVar: "CW_VULNCHECK_KEY", key: null }, { name: "sonatype", label: "Sonatype OSS Index / Guide", source: "none", envVar: "CW_SONATYPE_KEY", key: null }, { name: "snyk", label: "Snyk", source: "none", envVar: "CW_SNYK_KEY", key: null }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unknown source when store is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSources-'));
  try {
    const storeDir = join(dir, 'store');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, 'integrations.json'), 'not valid json');
    const result = listSources();
    assert.deepEqual(result, [{ name: "vulncheck", label: "VulnCheck (KEV / NVD++)", source: "none", envVar: "CW_VULNCHECK_KEY", key: null }, { name: "sonatype", label: "Sonatype OSS Index / Guide", source: "none", envVar: "CW_SONATYPE_KEY", key: null }, { name: "snyk", label: "Snyk", source: "none", envVar: "CW_SNYK_KEY", key: null }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns stored source when record exists with key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSources-'));
  try {
    const storeDir = join(dir, 'store');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, 'integrations.json'), JSON.stringify({ version: 1, sources: { sonatype: { key: 'sonatypekey9012', addedAt: '2024-02-15' } } }));
    const result = listSources();
    assert.deepEqual(result, [{ name: "vulncheck", label: "VulnCheck (KEV / NVD++)", source: "none", envVar: "CW_VULNCHECK_KEY", key: null }, { name: "sonatype", label: "Sonatype OSS Index / Guide", source: "none", envVar: "CW_SONATYPE_KEY", key: null }, { name: "snyk", label: "Snyk", source: "none", envVar: "CW_SNYK_KEY", key: null }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns none source when record exists but key is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listSources-'));
  try {
    const storeDir = join(dir, 'store');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, 'integrations.json'), JSON.stringify({ version: 1, sources: { snyk: { key: '', addedAt: '2024-03-10' } } }));
    const result = listSources();
    assert.deepEqual(result, [{ name: "vulncheck", label: "VulnCheck (KEV / NVD++)", source: "none", envVar: "CW_VULNCHECK_KEY", key: null }, { name: "sonatype", label: "Sonatype OSS Index / Guide", source: "none", envVar: "CW_SONATYPE_KEY", key: null }, { name: "snyk", label: "Snyk", source: "none", envVar: "CW_SNYK_KEY", key: null }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
