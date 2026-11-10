// Maps vulnerability IDs to fixed versions from a JSON snapshot (monitor/remediation-source.mjs osvFixedFromSnapshot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { osvFixedFromSnapshot } from '../remediation-source.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty string when the snapshot has no entry for the id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osvFixedFromSnapshot-'));
  try {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ other: '1.0.0' }));
    const f = osvFixedFromSnapshot(p);
    assert.equal(f('missing', 'pkg'), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the string value when the snapshot entry is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osvFixedFromSnapshot-'));
  try {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ id1: '2.0.0' }));
    const f = osvFixedFromSnapshot(p);
    assert.equal(f('id1', 'pkg'), "2.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the package-specific version when the entry is an object with that package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osvFixedFromSnapshot-'));
  try {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ id1: { pkgA: '3.1.0', '*': '9.9.9' } }));
    const f = osvFixedFromSnapshot(p);
    assert.equal(f('id1', 'pkgA'), "3.1.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the wildcard version when the entry has no package-specific key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osvFixedFromSnapshot-'));
  try {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ id1: { other: '3.1.0', '*': '9.9.9' } }));
    const f = osvFixedFromSnapshot(p);
    assert.equal(f('id1', 'pkgA'), "9.9.9");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty string when the entry object has neither the package nor a wildcard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osvFixedFromSnapshot-'));
  try {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ id1: { other: '3.1.0' } }));
    const f = osvFixedFromSnapshot(p);
    assert.equal(f('id1', 'pkgA'), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty string when the snapshot file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osvFixedFromSnapshot-'));
  try {
    const p = join(dir, 'nope.json');
    const f = osvFixedFromSnapshot(p);
    assert.equal(f('id1', 'pkgA'), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty string when the snapshot file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osvFixedFromSnapshot-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{not json');
    const f = osvFixedFromSnapshot(p);
    assert.equal(f('id1', 'pkgA'), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the package-specific version when the wildcard is an empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osvFixedFromSnapshot-'));
  try {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ id1: { pkgA: '3.1.0', '*': '' } }));
    const f = osvFixedFromSnapshot(p);
    assert.equal(f('id1', 'pkgA'), "3.1.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the wildcard version when the package key is an empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osvFixedFromSnapshot-'));
  try {
    const p = join(dir, 's.json');
    writeFileSync(p, JSON.stringify({ id1: { pkgA: '', '*': '9.9.9' } }));
    const f = osvFixedFromSnapshot(p);
    assert.equal(f('id1', 'pkgA'), "9.9.9");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
