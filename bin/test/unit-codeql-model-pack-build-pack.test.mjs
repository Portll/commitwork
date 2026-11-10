// Builds a CodeQL model pack directory with qlpack.yml and model files (bin/codeql-model-pack.mjs buildPack).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPack } from '../codeql-model-pack.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when files array is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildPack-'));
  try {
    const result = buildPack([], 'my-repo', 'javascript', dir);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns pack object with correct name, dir, and file names for one file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildPack-'));
  try {
    const files = [{ name: 'model.yml', text: 'key: value' }];
    const result = buildPack(files, 'my-repo', 'javascript', dir);
    assert.deepEqual(result, {
      name: 'commitwork-models/my-repo-javascript',
      dir: join(dir, 'my-repo-javascript'),
      files: ['model.yml'],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes qlpack.yml with library true and correct extension target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildPack-'));
  try {
    const files = [{ name: 'model.yml', text: 'key: value' }];
    buildPack(files, 'my-repo', 'javascript', dir);
    const qlpackPath = join(dir, 'my-repo-javascript', 'qlpack.yml');
    const content = readFileSync(qlpackPath, 'utf8');
    const expected = [
      'name: commitwork-models/my-repo-javascript',
      'version: 0.0.1',
      'library: true',
      'extensionTargets:',
      '  codeql/javascript-all: "*"',
      'dataExtensions:',
      '  - models/*.yml',
      '',
    ].join('\n');
    assert.equal(content, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes model files with their text content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildPack-'));
  try {
    const files = [
      { name: 'a.yml', text: 'alpha' },
      { name: 'b.yml', text: 'beta' },
    ];
    buildPack(files, 'my-repo', 'javascript', dir);
    const aPath = join(dir, 'my-repo-javascript', 'models', 'a.yml');
    const bPath = join(dir, 'my-repo-javascript', 'models', 'b.yml');
    assert.equal(readFileSync(aPath, 'utf8'), 'alpha');
    assert.equal(readFileSync(bPath, 'utf8'), 'beta');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('slugs repo and language names for the pack name and directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildPack-'));
  try {
    const files = [{ name: 'm.yml', text: 'x' }];
    const result = buildPack(files, 'My Repo!', 'javascript-typescript', dir);
    assert.equal(result.name, 'commitwork-models/my-repo-javascript');
    assert.equal(result.dir, join(dir, 'my-repo-javascript'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the correct library mapping for python language', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildPack-'));
  try {
    const files = [{ name: 'm.yml', text: 'x' }];
    const result = buildPack(files, 'repo', 'python', dir);
    assert.equal(result.name, 'commitwork-models/repo-python');
    const qlpackContent = readFileSync(join(dir, 'repo-python', 'qlpack.yml'), 'utf8');
    assert.equal(qlpackContent.includes('codeql/python-all: "*"'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple files and returns all their names in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildPack-'));
  try {
    const files = Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.yml`, text: `t${i}` }));
    const result = buildPack(files, 'r', 'java', dir);
    assert.deepEqual(result.files, ['f0.yml', 'f1.yml', 'f2.yml']);
    assert.equal(result.name, 'commitwork-models/r-java');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
