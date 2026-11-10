// Collects sorted unique finding ids from vendor-scan.json files under a directory (bin/advisory-index.mjs idsFromReports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsFromReports } from '../advisory-index.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'idsFromReports-'));
}

test('returns empty array for empty directory', () => {
  const dir = makeDir();
  try {
    assert.deepEqual(idsFromReports(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array for non-existent directory', () => {
  const dir = join(makeDir(), 'no-such-dir');
  assert.deepEqual(idsFromReports(dir), []);
});

test('extracts single finding id from vendor-scan.json', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ findings: [{ id: 'abc123' }] }));
    assert.deepEqual(idsFromReports(dir), ['abc123']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extracts multiple finding ids and sorts them', () => {
  const dir = makeDir();
  try {
    const findings = Array.from({ length: 5 }, (_, i) => ({ id: `id-${i}` }));
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ findings }));
    const expected = findings.map(f => f.id).sort();
    assert.deepEqual(idsFromReports(dir), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates repeated finding ids', () => {
  const dir = makeDir();
  try {
    const findings = Array.from({ length: 3 }, () => ({ id: 'dup-id' }));
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ findings }));
    assert.deepEqual(idsFromReports(dir), ['dup-id']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores findings without id property', () => {
  const dir = makeDir();
  try {
    const findings = [{ id: 'valid' }, { name: 'no-id' }, null, { id: null }, { id: '' }];
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ findings }));
    assert.deepEqual(idsFromReports(dir), ['valid']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles vendor-scan.json with no findings key', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ summary: 'ok' }));
    assert.deepEqual(idsFromReports(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores invalid JSON in vendor-scan.json', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'vendor-scan.json'), 'not valid json');
    assert.deepEqual(idsFromReports(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collects ids from nested subdirectories', () => {
  const dir = makeDir();
  try {
    const sub = join(dir, 'sub1', 'sub2');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'vendor-scan.json'), JSON.stringify({ findings: [{ id: 'nested-id' }] }));
    writeFileSync(join(dir, 'vendor-scan.json'), JSON.stringify({ findings: [{ id: 'top-id' }] }));
    assert.deepEqual(idsFromReports(dir), ['nested-id', 'top-id']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores files that are not vendor-scan.json', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ findings: [{ id: 'should-ignore' }] }));
    writeFileSync(join(dir, 'vendor-scan.txt'), JSON.stringify({ findings: [{ id: 'should-ignore' }] }));
    assert.deepEqual(idsFromReports(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
