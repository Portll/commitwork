// List of repo directories found under a reports root or its sweep- batch dirs (monitor/artifact-anomaly.mjs discoverRepoDirs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverRepoDirs } from '../artifact-anomaly.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'discoverRepoDirs-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('returns an empty array when the reports directory does not exist', () => {
  withTmp((dir) => {
    assert.deepEqual(discoverRepoDirs(join(dir, 'missing')), []);
  });
});

test('returns an empty array when the reports path is a file', () => {
  withTmp((dir) => {
    writeFileSync(join(dir, 'f'), 'x');
    assert.deepEqual(discoverRepoDirs(join(dir, 'f')), []);
  });
});

test('lists plain subdirectories with an empty batch and skips dot entries and files', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(join(dir, 'file.txt'), 'x');
    mkdirSync(join(dir, 'history'));
    mkdirSync(join(dir, 'repo1'));
    assert.deepEqual(discoverRepoDirs(dir), [
      { repo: 'history', dir: join(dir, 'history'), batch: '' },
      { repo: 'repo1', dir: join(dir, 'repo1'), batch: '' },
    ]);
  });
});

test('treats a directory named sweep without a dash as a plain repo', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'sweep', 'inner'), { recursive: true });
    assert.deepEqual(discoverRepoDirs(dir), [
      { repo: 'sweep', dir: join(dir, 'sweep'), batch: '' },
    ]);
  });
});

test('expands a sweep batch directory into its repo subdirectories and skips files in it', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'sweep-b', 'repo2'), { recursive: true });
    mkdirSync(join(dir, 'sweep-b', 'repo1'), { recursive: true });
    writeFileSync(join(dir, 'sweep-b', 'notes.txt'), 'x');
    assert.deepEqual(discoverRepoDirs(dir), [
      { repo: 'repo1', dir: join(dir, 'sweep-b', 'repo1'), batch: 'sweep-b' },
      { repo: 'repo2', dir: join(dir, 'sweep-b', 'repo2'), batch: 'sweep-b' },
    ]);
  });
});

test('skips dot entries and the history directory inside a sweep batch', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'sweep-a', '.hidden'), { recursive: true });
    mkdirSync(join(dir, 'sweep-a', 'history'), { recursive: true });
    mkdirSync(join(dir, 'sweep-a', 'repo1'), { recursive: true });
    assert.deepEqual(discoverRepoDirs(dir), [
      { repo: 'repo1', dir: join(dir, 'sweep-a', 'repo1'), batch: 'sweep-a' },
    ]);
  });
});

test('keeps sweep entries whose names only contain history', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'sweep-a', 'history2'), { recursive: true });
    mkdirSync(join(dir, 'sweep-a', 'ahistory'), { recursive: true });
    assert.deepEqual(discoverRepoDirs(dir), [
      { repo: 'ahistory', dir: join(dir, 'sweep-a', 'ahistory'), batch: 'sweep-a' },
      { repo: 'history2', dir: join(dir, 'sweep-a', 'history2'), batch: 'sweep-a' },
    ]);
  });
});

test('returns an empty array for a sweep batch holding only a dot directory and history', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'sweep-empty', '.hidden'), { recursive: true });
    mkdirSync(join(dir, 'sweep-empty', 'history'), { recursive: true });
    assert.deepEqual(discoverRepoDirs(dir), []);
  });
});

test('combines plain repos and sweep batches in sorted name order and skips a sweep- file', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'zeta'));
    mkdirSync(join(dir, 'alpha'));
    mkdirSync(join(dir, 'sweep-x', 'inner'), { recursive: true });
    writeFileSync(join(dir, 'sweep-file'), 'x');
    assert.deepEqual(discoverRepoDirs(dir), [
      { repo: 'alpha', dir: join(dir, 'alpha'), batch: '' },
      { repo: 'inner', dir: join(dir, 'sweep-x', 'inner'), batch: 'sweep-x' },
      { repo: 'zeta', dir: join(dir, 'zeta'), batch: '' },
    ]);
  });
});

test('accepts a single batch directory and lists its history subdirectory as a plain repo', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'sweep-a', 'repo1'), { recursive: true });
    mkdirSync(join(dir, 'sweep-a', 'history'), { recursive: true });
    assert.deepEqual(discoverRepoDirs(join(dir, 'sweep-a')), [
      { repo: 'history', dir: join(dir, 'sweep-a', 'history'), batch: '' },
      { repo: 'repo1', dir: join(dir, 'sweep-a', 'repo1'), batch: '' },
    ]);
  });
});
