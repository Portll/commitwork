// Per-subdirectory dependency lock verdicts for a repository tree (monitor/preflight-build.mjs classifyTree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTree } from '../preflight-build.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const withTree = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyTree-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const put = (root, rel, text = 'x\n') => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const voidAtRoot = (code) => ({
  dir: '.',
  ecosystems: [],
  unreadable: `${code} \u2014 this subtree's state is UNKNOWN, not clean`,
});

const goBlind = {
  eco: 'go',
  state: 'blind',
  lockMissing: 'go.sum',
  lockSource: null,
  buildable: true,
  why: 'go.sum is the checksum database the vulnerability scanners resolve module versions through',
};
const goOk = { eco: 'go', state: 'ok', lockMissing: null, lockSource: 'repo', buildable: true, why: null };
const mavenOk = { eco: 'jvm-maven', state: 'ok', lockMissing: null, lockSource: 'repo', buildable: false, why: null };
const nodeBlind = {
  eco: 'node',
  state: 'blind',
  lockMissing: 'package-lock.json',
  lockSource: null,
  buildable: true,
  why: 'without a lockfile the resolved tree does not exist on disk, so osv/npm audit have no versions to match advisories against',
};

const SKIPPED = [
  'node_modules', 'vendor', '.git', 'target', 'dist', 'build', '.venv', 'venv',
  'fixtures', '__fixtures__', 'testdata', 'test', 'tests', 'spec', 'example', 'examples',
];

test('a missing root path returns an empty array with no unreadable entry', () => withTree((dir) => {
  assert.deepEqual(classifyTree(join(dir, 'missing')), []);
}));

test('a root path that is a file is reported as an ENOTDIR void at dot', () => withTree((dir) => {
  put(dir, 'plain.txt');
  assert.deepEqual(classifyTree(join(dir, 'plain.txt')), [voidAtRoot('ENOTDIR')]);
}));

test('a read failure that carries no error code is reported with the word error', () => {
  const root = { get href() { throw new Error('no code'); } };
  assert.deepEqual(classifyTree(root), [voidAtRoot('error')]);
});

test('depth zero returns an empty array without reading the path', () => withTree((dir) => {
  put(dir, 'a/go.mod');
  put(dir, 'plain.txt');
  assert.deepEqual(classifyTree(dir, { depth: 0 }), []);
  assert.deepEqual(classifyTree(join(dir, 'plain.txt'), { depth: 0 }), []);
}));

test('depth one reports direct children and stops before grandchildren', () => withTree((dir) => {
  put(dir, 'a/go.mod');
  put(dir, 'a/b/go.mod');
  assert.deepEqual(classifyTree(dir, { depth: 1 }), [{ dir: 'a', ecosystems: [goBlind] }]);
}));

test('the default depth reports two levels and an explicit depth of three reports one more', () => withTree((dir) => {
  put(dir, 'a/go.mod');
  put(dir, 'a/go.sum');
  put(dir, 'a/b/go.mod');
  put(dir, 'a/b/c/go.mod');
  put(dir, 'a/b/c/d/go.mod');
  const two = [{ dir: 'a', ecosystems: [goOk] }, { dir: 'a/b', ecosystems: [goBlind] }];
  assert.deepEqual(classifyTree(dir), two);
  assert.deepEqual(classifyTree(dir, { depth: 3 }), [...two, { dir: 'a/b/c', ecosystems: [goBlind] }]);
}));

test('hidden and skip-listed directories are neither reported nor descended into', () => withTree((dir) => {
  for (const name of [...SKIPPED, '.hidden']) {
    put(dir, `${name}/go.mod`);
    put(dir, `${name}/inner/go.mod`);
    put(dir, `pkg/${name}/go.mod`);
  }
  assert.deepEqual(classifyTree(dir), []);
}));

test('plain files and the manifest of the root itself produce no entries', () => withTree((dir) => {
  put(dir, 'go.mod');
  put(dir, 'notes.txt');
  assert.deepEqual(classifyTree(dir), []);
}));

test('a child package.json with no dependencies gets no entry but its subtree is still walked', () => withTree((dir) => {
  put(dir, 'app/package.json', '{}');
  put(dir, 'app/svc/package.json', JSON.stringify({ dependencies: { lodash: '1.0.0' } }));
  assert.deepEqual(classifyTree(dir), [{ dir: 'app/svc', ecosystems: [nodeBlind] }]);
}));

test('sibling directories keep their own verdicts and one directory can hold several ecosystems', () => withTree((dir) => {
  put(dir, 'locked/go.mod');
  put(dir, 'locked/go.sum');
  put(dir, 'mixed/go.mod');
  put(dir, 'mixed/pom.xml');
  put(dir, 'vendors.d/go.mod');
  const r = classifyTree(dir).sort((x, y) => (x.dir < y.dir ? -1 : 1));
  assert.deepEqual(r, [
    { dir: 'locked', ecosystems: [goOk] },
    { dir: 'mixed', ecosystems: [goBlind, mavenOk] },
    { dir: 'vendors.d', ecosystems: [goBlind] },
  ]);
}));
