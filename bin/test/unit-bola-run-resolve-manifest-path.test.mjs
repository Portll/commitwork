// Resolves the BOLA manifest file path and its source (bin/bola-run.mjs resolveManifestPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveManifestPath } from '../bola-run.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('uses flag when provided and CW_BOLA_MANIFEST is not set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveManifestPath-'));
  const prevEnv = process.env.CW_BOLA_MANIFEST;
  delete process.env.CW_BOLA_MANIFEST;
  try {
    const explicitFile = join(dir, 'flag-manifest.json');
    writeFileSync(explicitFile, '{}');
    const result = resolveManifestPath(explicitFile);
    assert.deepEqual(result, { path: resolve(explicitFile), source: 'explicit' });
  } finally {
    if (prevEnv !== undefined) process.env.CW_BOLA_MANIFEST = prevEnv;
    else delete process.env.CW_BOLA_MANIFEST;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses CW_BOLA_MANIFEST when flag is not provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveManifestPath-'));
  const prevEnv = process.env.CW_BOLA_MANIFEST;
  try {
    const explicitFile = join(dir, 'env-manifest.json');
    writeFileSync(explicitFile, '{}');
    process.env.CW_BOLA_MANIFEST = explicitFile;
    const result = resolveManifestPath(undefined);
    assert.deepEqual(result, { path: resolve(explicitFile), source: 'explicit' });
  } finally {
    if (prevEnv !== undefined) process.env.CW_BOLA_MANIFEST = prevEnv;
    else delete process.env.CW_BOLA_MANIFEST;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prefers flag over CW_BOLA_MANIFEST when both are provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveManifestPath-'));
  const prevEnv = process.env.CW_BOLA_MANIFEST;
  try {
    const flagFile = join(dir, 'flag-manifest.json');
    const envFile = join(dir, 'env-manifest.json');
    writeFileSync(flagFile, '{}');
    writeFileSync(envFile, '{}');
    process.env.CW_BOLA_MANIFEST = envFile;
    const result = resolveManifestPath(flagFile);
    assert.deepEqual(result, { path: resolve(flagFile), source: 'explicit' });
  } finally {
    if (prevEnv !== undefined) process.env.CW_BOLA_MANIFEST = prevEnv;
    else delete process.env.CW_BOLA_MANIFEST;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns bundled manifest when flag matches bundled name', () => {
  const result = resolveManifestPath('example');
  assert.equal(result.source, 'bundled');
  assert.equal(result.path.endsWith('example.json'), true);
});

test('throws when flag is set but no matching manifest is found', () => {
  assert.throws(() => resolveManifestPath('nonexistent-manifest-name'), {
    name: 'Error',
    message: 'BOLA manifest not found: "nonexistent-manifest-name". Bundled: example; or pass a path.'
  });
});

test('returns repo-local bola.json when it exists in cwd and no flag or env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveManifestPath-'));
  const prevEnv = process.env.CW_BOLA_MANIFEST;
  const prevCwd = process.cwd();
  delete process.env.CW_BOLA_MANIFEST;
  try {
    writeFileSync(join(dir, 'bola.json'), '{}');
    process.chdir(dir);
    const result = resolveManifestPath(undefined);
    const expectedPath = resolve(process.cwd(), 'bola.json');
    assert.deepEqual(result, { path: expectedPath, source: 'repo-local' });
  } finally {
    process.chdir(prevCwd);
    if (prevEnv !== undefined) process.env.CW_BOLA_MANIFEST = prevEnv;
    else delete process.env.CW_BOLA_MANIFEST;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns repo-local commitwork.json when bola.json is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveManifestPath-'));
  const prevEnv = process.env.CW_BOLA_MANIFEST;
  const prevCwd = process.cwd();
  delete process.env.CW_BOLA_MANIFEST;
  try {
    writeFileSync(join(dir, 'commitwork.json'), '{}');
    process.chdir(dir);
    const result = resolveManifestPath(undefined);
    const expectedPath = resolve(process.cwd(), 'commitwork.json');
    assert.deepEqual(result, { path: expectedPath, source: 'repo-local' });
  } finally {
    process.chdir(prevCwd);
    if (prevEnv !== undefined) process.env.CW_BOLA_MANIFEST = prevEnv;
    else delete process.env.CW_BOLA_MANIFEST;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws with usage message when no manifest is found anywhere', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveManifestPath-'));
  const prevEnv = process.env.CW_BOLA_MANIFEST;
  const prevCwd = process.cwd();
  delete process.env.CW_BOLA_MANIFEST;
  try {
    process.chdir(dir);
    assert.throws(() => resolveManifestPath(undefined), {
      name: 'Error',
      message: 'no BOLA manifest. Use --manifest <path|name>, set CW_BOLA_MANIFEST, or add bola.json to the cwd. Bundled: example.'
    });
  } finally {
    process.chdir(prevCwd);
    if (prevEnv !== undefined) process.env.CW_BOLA_MANIFEST = prevEnv;
    else delete process.env.CW_BOLA_MANIFEST;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when flag is empty string and env is not set', () => {
  const prevEnv = process.env.CW_BOLA_MANIFEST;
  delete process.env.CW_BOLA_MANIFEST;
  try {
    assert.throws(() => resolveManifestPath(''), { name: "Error", message: "no BOLA manifest. Use --manifest <path|name>, set CW_BOLA_MANIFEST, or add bola.json to the cwd. Bundled: example." });
  } finally {
    if (prevEnv !== undefined) process.env.CW_BOLA_MANIFEST = prevEnv;
    else delete process.env.CW_BOLA_MANIFEST;
  }
});

test('throws when flag is empty string and env is set', () => {
  const prevEnv = process.env.CW_BOLA_MANIFEST;
  process.env.CW_BOLA_MANIFEST = 'some-manifest';
  try {
    assert.throws(() => resolveManifestPath(''), { name: "Error", message: "BOLA manifest not found: \"some-manifest\". Bundled: example; or pass a path." });
  } finally {
    if (prevEnv !== undefined) process.env.CW_BOLA_MANIFEST = prevEnv;
    else delete process.env.CW_BOLA_MANIFEST;
  }
});
