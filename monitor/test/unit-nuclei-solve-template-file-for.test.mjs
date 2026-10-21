// Resolves the on-disk path of a nuclei template from a record (monitor/nuclei-solve.mjs templateFileFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateFileFor } from '../nuclei-solve.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the joined path when the relative template exists under the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    const rel = 'cves/cve-2024-0001.yaml';
    const root = join(dir, 'templates');
    const target = join(root, rel);
    mkdirSync(join(root, 'cves'), { recursive: true });
    writeFileSync(target, 'x');
    const rec = { template: rel };
    assert.equal(templateFileFor(rec, root), target);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to the absolute template-path when the relative path is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    const abs = join(dir, 'abs.yaml');
    writeFileSync(abs, 'x');
    const rec = { template: 'missing/rel.yaml', 'template-path': abs };
    assert.equal(templateFileFor(rec, join(dir, 'root')), abs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when neither the relative path nor the absolute path exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    const rec = { template: 'nope/rel.yaml', 'template-path': join(dir, 'nope-abs.yaml') };
    assert.equal(templateFileFor(rec, join(dir, 'root')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the record is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    assert.equal(templateFileFor(null, join(dir, 'root')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the record is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    assert.equal(templateFileFor(undefined, join(dir, 'root')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the record has no template and no template-path keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    assert.equal(templateFileFor({}, join(dir, 'root')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the template value is an empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    const rec = { template: '' };
    assert.equal(templateFileFor(rec, join(dir, 'root')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the template value is whitespace only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    const rec = { template: '   ' };
    assert.equal(templateFileFor(rec, join(dir, 'root')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the absolute template-path directly when the relative path is absolute and exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    const abs = join(dir, 'direct.yaml');
    writeFileSync(abs, 'x');
    const rec = { template: abs, 'template-path': abs };
    assert.equal(templateFileFor(rec, join(dir, 'root')), abs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prefers the relative path over the absolute path when both exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'templateFileFor-'));
  try {
    const root = join(dir, 'root');
    const rel = 'rel.yaml';
    const relPath = join(root, rel);
    const abs = join(dir, 'abs.yaml');
    mkdirSync(root, { recursive: true });
    writeFileSync(relPath, 'x');
    writeFileSync(abs, 'x');
    const rec = { template: rel, 'template-path': abs };
    assert.equal(templateFileFor(rec, root), relPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
