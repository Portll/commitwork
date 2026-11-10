// Resolves the on-disk keg directory for a package row (monitor/update-vulns.mjs kegPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kegPath } from '../update-vulns.mjs';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'kegPath-'));
  try {
    fn(join(dir, 'prefix'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function unknownFor(name, root) {
  return {
    unknown: true,
    unknownReason: 'no-subject',
    unknownDetail: `no installed directory for ${name} under ${root} \u2014 nothing to examine, which is not the same as nothing found`,
  };
}

test('returns the newest installed version directory for a formula', () => {
  withDir((prefix) => {
    const root = join(prefix, 'Cellar', 'git');
    mkdirSync(join(root, '2.40.0'), { recursive: true });
    mkdirSync(join(root, '2.41.0'), { recursive: true });
    const row = { name: 'git', installed: '2.40.0, 2.41.0', kind: 'formula' };
    const result = kegPath(row, { prefix });
    assert.deepEqual(result, { path: join(root, '2.41.0'), version: '2.41.0' });
  });
});

test('falls back to an older version when the newest directory is missing', () => {
  withDir((prefix) => {
    const root = join(prefix, 'Cellar', 'git');
    mkdirSync(join(root, '2.40.0'), { recursive: true });
    const row = { name: 'git', installed: '2.40.0, 2.41.0', kind: 'formula' };
    const result = kegPath(row, { prefix });
    assert.deepEqual(result, { path: join(root, '2.40.0'), version: '2.40.0' });
  });
});

test('returns the only installed version directory when one exists', () => {
  withDir((prefix) => {
    const root = join(prefix, 'Cellar', 'curl');
    mkdirSync(join(root, '8.5.0'), { recursive: true });
    const row = { name: 'curl', installed: '8.5.0', kind: 'formula' };
    const result = kegPath(row, { prefix });
    assert.deepEqual(result, { path: join(root, '8.5.0'), version: '8.5.0' });
  });
});

test('returns the newest installed version directory under Caskroom for a cask', () => {
  withDir((prefix) => {
    const root = join(prefix, 'Caskroom', 'firefox');
    mkdirSync(join(root, '128.0'), { recursive: true });
    mkdirSync(join(root, '129.0'), { recursive: true });
    const row = { name: 'firefox', installed: '128.0, 129.0', kind: 'cask' };
    const result = kegPath(row, { prefix });
    assert.deepEqual(result, { path: join(root, '129.0'), version: '129.0' });
  });
});

test('returns unknown for a formula whose directory exists only under Caskroom', () => {
  withDir((prefix) => {
    mkdirSync(join(prefix, 'Caskroom', 'git', '2.40.0'), { recursive: true });
    const row = { name: 'git', installed: '2.40.0', kind: 'formula' };
    const result = kegPath(row, { prefix });
    assert.deepEqual(result, unknownFor('git', join(prefix, 'Cellar', 'git')));
  });
});

test('returns unknown when no installed version directory exists for a cask', () => {
  withDir((prefix) => {
    const row = { name: 'firefox', installed: '128.0', kind: 'cask' };
    const result = kegPath(row, { prefix });
    assert.deepEqual(result, unknownFor('firefox', join(prefix, 'Caskroom', 'firefox')));
  });
});

test('uses the leaf of a namespaced formula name for the directory', () => {
  withDir((prefix) => {
    const root = join(prefix, 'Cellar', 'ruby');
    mkdirSync(join(root, '3.3.0'), { recursive: true });
    const row = { name: 'brewsci/ruby', installed: '3.3.0', kind: 'formula' };
    const result = kegPath(row, { prefix });
    assert.deepEqual(result, { path: join(root, '3.3.0'), version: '3.3.0' });
  });
});

test('returns unknown when installed is empty and no directory exists', () => {
  withDir((prefix) => {
    const row = { name: 'git', installed: '', kind: 'formula' };
    const result = kegPath(row, { prefix });
    assert.deepEqual(result, unknownFor('git', join(prefix, 'Cellar', 'git')));
  });
});
