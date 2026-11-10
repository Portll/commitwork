// Copies cached outputs into a report directory, checks their hashes and writes a reuse marker (bin/lib/lane-reuse.mjs restore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restore } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

const withDirs = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-'));
  try {
    const src = join(dir, 'src');
    const rep = join(dir, 'rep');
    mkdirSync(src);
    mkdirSync(rep);
    fn(src, rep);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const hitFor = (src, files, hashes) => ({ dir: src, entry: { files, hashes, key: 'k1', storedAt: '2024-01-01', reportDir: src } });

test('A file restored into an empty report directory yields a marker with reused true', () => {
  withDirs((src, rep) => {
    writeFileSync(join(src, 'a.txt'), 'hello');
    const r = restore(hitFor(src, ['a.txt'], { 'a.txt': sha('hello') }), { id: 'c1' }, rep);
    assert.deepEqual(r, { check: 'c1', reused: true, key: 'k1', scannedAt: '2024-01-01', from: src, files: ['a.txt'] });
    assert.equal(readFileSync(join(rep, 'a.txt'), 'utf8'), 'hello');
  });
});

test('The marker file is written as two-space indented JSON with a trailing newline', () => {
  withDirs((src, rep) => {
    writeFileSync(join(src, 'a.txt'), 'data');
    restore(hitFor(src, ['a.txt'], { 'a.txt': sha('data') }), { id: 'c1' }, rep);
    const expected = `${JSON.stringify({ check: 'c1', reused: true, key: 'k1', scannedAt: '2024-01-01', from: src, files: ['a.txt'] }, null, 2)}\n`;
    assert.equal(readFileSync(join(rep, 'reuse-c1.json'), 'utf8'), expected);
  });
});

test('An existing file at the destination is replaced by the cached copy', () => {
  withDirs((src, rep) => {
    writeFileSync(join(src, 'a.txt'), 'new-content');
    writeFileSync(join(rep, 'a.txt'), 'old-content');
    const r = restore(hitFor(src, ['a.txt'], { 'a.txt': sha('new-content') }), { id: 'c1' }, rep);
    assert.deepEqual(r, { check: 'c1', reused: true, key: 'k1', scannedAt: '2024-01-01', from: src, files: ['a.txt'] });
    assert.equal(readFileSync(join(rep, 'a.txt'), 'utf8'), 'new-content');
  });
});

test('A hash mismatch throws and removes the copied file', () => {
  withDirs((src, rep) => {
    writeFileSync(join(src, 'a.txt'), 'hello');
    const hit = hitFor(src, ['a.txt'], { 'a.txt': sha('different') });
    assert.throws(() => restore(hit, { id: 'c1' }, rep), { name: 'Error', message: 'cached output a.txt changed while it was restored' });
    assert.deepEqual(readdirSync(rep), []);
  });
});

test('A mismatch on the second file also removes the first restored file', () => {
  withDirs((src, rep) => {
    writeFileSync(join(src, 'a.txt'), 'one');
    writeFileSync(join(src, 'b.txt'), 'two');
    const hit = hitFor(src, ['a.txt', 'b.txt'], { 'a.txt': sha('one'), 'b.txt': sha('one') });
    assert.throws(() => restore(hit, { id: 'c1' }, rep), { name: 'Error', message: 'cached output b.txt changed while it was restored' });
    assert.deepEqual(readdirSync(rep), []);
  });
});

test('A missing cached file rethrows the copy error after cleanup of the never-created destination', () => {
  withDirs((src, rep) => {
    const hit = hitFor(src, ['gone.txt'], { 'gone.txt': sha('x') });
    assert.throws(() => restore(hit, { id: 'c1' }, rep), {
      name: 'Error',
      code: 'ENOENT',
      syscall: 'copyfile',
      message: `ENOENT: no such file or directory, copyfile '${join(src, 'gone.txt')}' -> '${join(rep, 'gone.txt')}'`,
    });
    assert.deepEqual(readdirSync(rep), []);
  });
});

test('Unsafe characters in the check id are replaced with underscores in the marker name', () => {
  withDirs((src, rep) => {
    const body = 'x'.repeat(64);
    writeFileSync(join(src, 'a.txt'), body);
    const r = restore(hitFor(src, ['a.txt'], { 'a.txt': sha(body) }), { id: 'a/b c' }, rep);
    assert.deepEqual(r, { check: 'a/b c', reused: true, key: 'k1', scannedAt: '2024-01-01', from: src, files: ['a.txt'] });
    assert.deepEqual(JSON.parse(readFileSync(join(rep, 'reuse-a_b_c.json'), 'utf8')), r);
  });
});

test('An empty file list writes only the marker', () => {
  withDirs((src, rep) => {
    const r = restore(hitFor(src, [], {}), { id: 'c2' }, rep);
    assert.deepEqual(r, { check: 'c2', reused: true, key: 'k1', scannedAt: '2024-01-01', from: src, files: [] });
    assert.equal(existsSync(join(rep, 'reuse-c2.json')), true);
    assert.equal(readFileSync(join(rep, 'reuse-c2.json'), 'utf8'), `${JSON.stringify(r, null, 2)}\n`);
  });
});
