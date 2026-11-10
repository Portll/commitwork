// Path of the newest sbom-syft.json for a repo across name-sorted batches (monitor/observables.mjs findSbom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSbom } from '../observables.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function placeSbom(reportsDir, batch, repo) {
  mkdirSync(join(reportsDir, batch, repo), { recursive: true });
  const p = join(reportsDir, batch, repo, 'sbom-syft.json');
  writeFileSync(p, '{}');
  return p;
}

test('returns null when the reports directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    assert.equal(findSbom(join(dir, 'no-such-dir'), 'repo'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows the read error when the reports path is a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    const reportsFile = join(dir, 'reports');
    writeFileSync(reportsFile, 'not a directory');
    assert.throws(() => findSbom(reportsFile, 'repo'), {
      name: 'Error',
      code: 'ENOTDIR',
      message: `ENOTDIR: not a directory, scandir '${reportsFile}'`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the reports directory has no batches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    const reportsDir = join(dir, 'reports');
    mkdirSync(reportsDir, { recursive: true });
    assert.equal(findSbom(reportsDir, 'repo'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when no batch contains the sbom file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    const reportsDir = join(dir, 'reports');
    mkdirSync(join(reportsDir, 'b1', 'repo'), { recursive: true });
    mkdirSync(join(reportsDir, 'b2', 'repo'), { recursive: true });
    assert.equal(findSbom(reportsDir, 'repo'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when only another repo has an sbom file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    const reportsDir = join(dir, 'reports');
    placeSbom(reportsDir, 'b1', 'other');
    assert.equal(findSbom(reportsDir, 'repo'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the only sbom path when exactly one batch has it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    const reportsDir = join(dir, 'reports');
    const p = placeSbom(reportsDir, 'b1', 'repo');
    assert.equal(findSbom(reportsDir, 'repo'), p);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the second path when two batches have the sbom', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    const reportsDir = join(dir, 'reports');
    placeSbom(reportsDir, 'b1', 'repo');
    const p2 = placeSbom(reportsDir, 'b2', 'repo');
    assert.equal(findSbom(reportsDir, 'repo'), p2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the third path when three batches have the sbom', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    const reportsDir = join(dir, 'reports');
    placeSbom(reportsDir, 'b1', 'repo');
    placeSbom(reportsDir, 'b2', 'repo');
    const p3 = placeSbom(reportsDir, 'b3', 'repo');
    assert.equal(findSbom(reportsDir, 'repo'), p3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orders batches by string so b9 comes after b10', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    const reportsDir = join(dir, 'reports');
    const p9 = placeSbom(reportsDir, 'b9', 'repo');
    placeSbom(reportsDir, 'b10', 'repo');
    assert.equal(findSbom(reportsDir, 'repo'), p9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to an earlier batch when the latest batch has no sbom', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findSbom-'));
  try {
    const reportsDir = join(dir, 'reports');
    const p1 = placeSbom(reportsDir, 'b1', 'repo');
    mkdirSync(join(reportsDir, 'b2', 'repo'), { recursive: true });
    assert.equal(findSbom(reportsDir, 'repo'), p1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
