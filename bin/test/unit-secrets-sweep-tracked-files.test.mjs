// Splits NUL-terminated git ls-files output into tracked paths (bin/secrets-sweep.mjs trackedFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackedFiles } from '../secrets-sweep.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const emptyBlob = createHash('sha1').update('blob 0\0').digest();

function entry(name) {
  const n = Buffer.byteLength(name);
  const buf = Buffer.alloc((62 + n + 8) & ~7);
  buf.writeUInt32BE(0o100644, 24);
  emptyBlob.copy(buf, 40);
  buf.writeUInt16BE(n, 60);
  buf.write(name, 62);
  return buf;
}

function makeRepo(dir, names) {
  const git = join(dir, '.git');
  mkdirSync(join(git, 'objects'), { recursive: true });
  mkdirSync(join(git, 'refs', 'heads'), { recursive: true });
  mkdirSync(join(git, 'refs', 'tags'), { recursive: true });
  writeFileSync(join(git, 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(git, 'config'), '[core]\n\trepositoryformatversion = 0\n\tbare = false\n');
  if (names) {
    const head = Buffer.alloc(12);
    head.write('DIRC', 0);
    head.writeUInt32BE(2, 4);
    head.writeUInt32BE(names.length, 8);
    const body = Buffer.concat([head, ...names.map(entry)]);
    const sum = createHash('sha1').update(body).digest();
    writeFileSync(join(git, 'index'), Buffer.concat([body, sum]));
  }
}

function inTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'trackedFiles-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('A repository with no index file lists no tracked files', () => {
  inTmp((dir) => {
    makeRepo(dir, null);
    assert.deepEqual(trackedFiles(dir), []);
  });
});

test('An index with zero entries lists no tracked files', () => {
  inTmp((dir) => {
    makeRepo(dir, []);
    assert.deepEqual(trackedFiles(dir), []);
  });
});

test('A single index entry comes back as one path without its NUL terminator', () => {
  inTmp((dir) => {
    makeRepo(dir, ['a.txt']);
    assert.deepEqual(trackedFiles(dir), ['a.txt']);
  });
});

test('Several entries come back in index order including paths in subdirectories', () => {
  inTmp((dir) => {
    makeRepo(dir, ['a.txt', 'b.txt', 'sub/c.txt']);
    assert.deepEqual(trackedFiles(dir), ['a.txt', 'b.txt', 'sub/c.txt']);
  });
});

test('Paths with spaces and newlines stay whole because entries are split on NUL only', () => {
  inTmp((dir) => {
    makeRepo(dir, ['line\nbreak.txt', 'my file.txt']);
    assert.deepEqual(trackedFiles(dir), ['line\nbreak.txt', 'my file.txt']);
  });
});

test('Three hundred entries are all returned in order', () => {
  inTmp((dir) => {
    const names = Array.from({ length: 300 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
    makeRepo(dir, names);
    assert.deepEqual(trackedFiles(dir), names);
  });
});

test('A directory that is not a git repository makes it throw', () => {
  inTmp((dir) => {
    assert.throws(() => trackedFiles(dir), { name: 'Error', message: /git/ });
  });
});
