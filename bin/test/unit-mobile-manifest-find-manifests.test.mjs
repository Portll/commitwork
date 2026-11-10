// Lists AndroidManifest.xml and Info.plist paths found under a directory tree (bin/mobile-manifest.mjs findManifests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findManifests } from '../mobile-manifest.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'findManifests-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a root path that does not exist yields no manifests', () => {
  withDir((dir) => {
    assert.deepEqual(findManifests(join(dir, 'no-such-dir')), []);
  });
});

test('a root path that is a file yields no manifests even when named AndroidManifest.xml', () => {
  withDir((dir) => {
    const f = join(dir, 'AndroidManifest.xml');
    writeFileSync(f, '<manifest/>');
    assert.deepEqual(findManifests(f), []);
  });
});

test('an empty directory yields no manifests', () => {
  withDir((dir) => {
    assert.deepEqual(findManifests(dir), []);
  });
});

test('an AndroidManifest.xml in the root is reported with kind android', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'AndroidManifest.xml'), '<manifest/>');
    assert.deepEqual(findManifests(dir), [{ path: join(dir, 'AndroidManifest.xml'), kind: 'android' }]);
  });
});

test('an Info.plist in the root is reported with kind ios', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'Info.plist'), '<plist/>');
    assert.deepEqual(findManifests(dir), [{ path: join(dir, 'Info.plist'), kind: 'ios' }]);
  });
});

test('files with other names are not reported', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'README.md'), 'x');
    writeFileSync(join(dir, 'Info.plist.bak'), 'x');
    assert.deepEqual(findManifests(dir), []);
  });
});

test('both manifest kinds in one directory are listed in name order', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'Info.plist'), '<plist/>');
    writeFileSync(join(dir, 'AndroidManifest.xml'), '<manifest/>');
    assert.deepEqual(findManifests(dir), [
      { path: join(dir, 'AndroidManifest.xml'), kind: 'android' },
      { path: join(dir, 'Info.plist'), kind: 'ios' },
    ]);
  });
});

test('skip-list and dot directories are not descended into but other directories are', () => {
  withDir((dir) => {
    for (const d of ['node_modules', '.hidden', 'app']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'node_modules', 'AndroidManifest.xml'), '<manifest/>');
    writeFileSync(join(dir, '.hidden', 'Info.plist'), '<plist/>');
    writeFileSync(join(dir, 'app', 'AndroidManifest.xml'), '<manifest/>');
    assert.deepEqual(findManifests(dir), [{ path: join(dir, 'app', 'AndroidManifest.xml'), kind: 'android' }]);
  });
});

test('the default depth limit reaches eight levels down but not nine', () => {
  withDir((dir) => {
    const deep8 = join(dir, ...Array.from({ length: 8 }, (_, i) => `d${i + 1}`));
    const deep9 = join(deep8, 'd9');
    mkdirSync(deep9, { recursive: true });
    writeFileSync(join(deep8, 'AndroidManifest.xml'), '<manifest/>');
    writeFileSync(join(deep9, 'Info.plist'), '<plist/>');
    assert.deepEqual(findManifests(dir), [{ path: join(deep8, 'AndroidManifest.xml'), kind: 'android' }]);
  });
});

test('maxDepth 0 scans the root but none of its subdirectories', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'AndroidManifest.xml'), '<manifest/>');
    writeFileSync(join(dir, 'sub', 'Info.plist'), '<plist/>');
    assert.deepEqual(findManifests(dir, { maxDepth: 0 }), [{ path: join(dir, 'AndroidManifest.xml'), kind: 'android' }]);
  });
});
