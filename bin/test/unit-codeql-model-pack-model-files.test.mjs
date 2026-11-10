// Maps a repo's CodeQL model YAML files to their text, filtered to the lane's library pack. (bin/codeql-model-pack.mjs modelFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelFiles } from '../codeql-model-pack.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('throws for unknown language', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelFiles-'));
  try {
    assert.throws(() => modelFiles(dir, 'repo', 'cobol'), /unknown CodeQL language cobol/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when repo directory is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelFiles-'));
  try {
    const result = modelFiles(dir, 'missing-repo', 'javascript');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when no yaml files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelFiles-'));
  try {
    const repoDir = join(dir, 'repo');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'readme.txt'), 'hello');
    const result = modelFiles(dir, 'repo', 'javascript');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns matching yaml file with correct name and text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelFiles-'));
  try {
    const repoDir = join(dir, 'repo');
    mkdirSync(repoDir, { recursive: true });
    const content = "name: 'codeql/javascript-all', 'm'";
    writeFileSync(join(repoDir, 'model.yaml'), content);
    const result = modelFiles(dir, 'repo', 'javascript');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out yaml files that do not match the library pack', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelFiles-'));
  try {
    const repoDir = join(dir, 'repo');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'other.yaml'), "name: 'codeql/java-all', 'm'");
    writeFileSync(join(repoDir, 'match.yaml'), "name: 'codeql/javascript-all', 'm'");
    const result = modelFiles(dir, 'repo', 'javascript');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-yaml files in the repo directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelFiles-'));
  try {
    const repoDir = join(dir, 'repo');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'script.js'), 'console.log(1)');
    writeFileSync(join(repoDir, 'model.yml'), "name: 'codeql/javascript-all', 'm'");
    const result = modelFiles(dir, 'repo', 'javascript');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('supports javascript-typescript language mapping to javascript library', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelFiles-'));
  try {
    const repoDir = join(dir, 'repo');
    mkdirSync(repoDir, { recursive: true });
    const content = "name: 'codeql/javascript-all', 'm'";
    writeFileSync(join(repoDir, 'model.yaml'), content);
    const result = modelFiles(dir, 'repo', 'javascript-typescript');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('supports java language mapping to java library', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modelFiles-'));
  try {
    const repoDir = join(dir, 'repo');
    mkdirSync(repoDir, { recursive: true });
    const content = "name: 'codeql/java-all', 'm'";
    writeFileSync(join(repoDir, 'model.yaml'), content);
    const result = modelFiles(dir, 'repo', 'java');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
