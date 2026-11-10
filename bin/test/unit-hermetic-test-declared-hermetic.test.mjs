// Resolves the hermetic test config for a repo path from the registry (bin/hermetic-test.mjs declaredHermetic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaredHermetic } from '../hermetic-test.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the registry file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredHermetic-'));
  try {
    const regPath = join(dir, 'registry.json');
    const repoPath = join(dir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    const r = declaredHermetic(repoPath, { CW_REGISTRY: regPath });
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the hermetic test config when the project path matches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredHermetic-'));
  try {
    const regPath = join(dir, 'registry.json');
    const repoPath = join(dir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    const reg = { projects: [{ name: 'myproj', path: repoPath, hermeticTest: { cmd: 'cargo test' } }] };
    writeFileSync(regPath, JSON.stringify(reg));
    const r = declaredHermetic(repoPath, { CW_REGISTRY: regPath });
    assert.deepEqual(r, { name: "myproj", cmd: "cargo test" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when no project path matches the repo path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredHermetic-'));
  try {
    const regPath = join(dir, 'registry.json');
    const repoPath = join(dir, 'repo');
    const otherPath = join(dir, 'other');
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(otherPath, { recursive: true });
    const reg = { projects: [{ name: 'myproj', path: otherPath, hermeticTest: { cmd: 'cargo test' } }] };
    writeFileSync(regPath, JSON.stringify(reg));
    const r = declaredHermetic(repoPath, { CW_REGISTRY: regPath });
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the matching project has no hermeticTest property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredHermetic-'));
  try {
    const regPath = join(dir, 'registry.json');
    const repoPath = join(dir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    const reg = { projects: [{ name: 'myproj', path: repoPath }] };
    writeFileSync(regPath, JSON.stringify(reg));
    const r = declaredHermetic(repoPath, { CW_REGISTRY: regPath });
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the registry has no projects array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredHermetic-'));
  try {
    const regPath = join(dir, 'registry.json');
    const repoPath = join(dir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    const reg = {};
    writeFileSync(regPath, JSON.stringify(reg));
    const r = declaredHermetic(repoPath, { CW_REGISTRY: regPath });
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when a project entry is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredHermetic-'));
  try {
    const regPath = join(dir, 'registry.json');
    const repoPath = join(dir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    const reg = { projects: [null, { name: 'myproj', path: repoPath, hermeticTest: { cmd: 'cargo test' } }] };
    writeFileSync(regPath, JSON.stringify(reg));
    const r = declaredHermetic(repoPath, { CW_REGISTRY: regPath });
    assert.deepEqual(r, { name: "myproj", cmd: "cargo test" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when a project path is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'declaredHermetic-'));
  try {
    const regPath = join(dir, 'registry.json');
    const repoPath = join(dir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    const reg = { projects: [{ name: 'myproj', path: 123, hermeticTest: { cmd: 'cargo test' } }] };
    writeFileSync(regPath, JSON.stringify(reg));
    const r = declaredHermetic(repoPath, { CW_REGISTRY: regPath });
    assert.deepEqual(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
