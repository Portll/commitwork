// The real path, size and nanosecond times of the executable a tool name resolves to on PATH (bin/lib/lane-reuse.mjs binaryIdentity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binaryIdentity } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync, symlinkSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'binaryIdentity-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeTool(binDir, body, mode) {
  mkdirSync(binDir, { recursive: true });
  const p = join(binDir, 'mytool');
  writeFileSync(p, body);
  chmodSync(p, mode);
  return p;
}

function identityOf(p, size) {
  const real = realpathSync(p);
  const st = statSync(real, { bigint: true });
  return { path: real, size, mtimeNs: String(st.mtimeNs), ctimeNs: String(st.ctimeNs) };
}

test('An executable file in the only PATH directory is identified by real path, size and nanosecond times', () => {
  withDir((dir) => {
    const binDir = join(dir, 'bin');
    const exe = makeTool(binDir, '#!/bin/sh\necho hi\n', 0o755);
    const r = binaryIdentity('mytool', { PATH: binDir });
    assert.deepEqual(r, identityOf(exe, '18'));
  });
});

test('A missing PATH variable yields null', () => {
  withDir(() => {
    assert.equal(binaryIdentity('mytool', {}), null);
  });
});

test('An empty PATH variable yields null', () => {
  withDir(() => {
    assert.equal(binaryIdentity('mytool', { PATH: '' }), null);
  });
});

test('A PATH directory that does not exist is skipped and a later directory supplies the tool', () => {
  withDir((dir) => {
    const missing = join(dir, 'does-not-exist');
    const binDir = join(dir, 'bin2');
    const exe = makeTool(binDir, '#!/bin/sh\n', 0o755);
    const r = binaryIdentity('mytool', { PATH: missing + delimiter + binDir });
    assert.deepEqual(r, identityOf(exe, '10'));
  });
});

test('A PATH entry that is a regular file is skipped and a later directory supplies the tool', () => {
  withDir((dir) => {
    const fakeDir = join(dir, 'fake');
    writeFileSync(fakeDir, 'not a dir');
    const binDir = join(dir, 'bin');
    const exe = makeTool(binDir, '#!/bin/sh\n', 0o755);
    const r = binaryIdentity('mytool', { PATH: fakeDir + delimiter + binDir });
    assert.deepEqual(r, identityOf(exe, '10'));
  });
});

test('A symlink loop in an earlier PATH directory stops the search with null', () => {
  withDir((dir) => {
    const loopDir = join(dir, 'loop');
    mkdirSync(loopDir);
    symlinkSync('mytool', join(loopDir, 'mytool'));
    const binDir = join(dir, 'bin');
    makeTool(binDir, '#!/bin/sh\n', 0o755);
    const r = binaryIdentity('mytool', { PATH: loopDir + delimiter + binDir });
    assert.equal(r, null);
  });
});

test('A directory named like the tool is not accepted and yields null', () => {
  withDir((dir) => {
    const binDir = join(dir, 'bin');
    mkdirSync(join(binDir, 'mytool'), { recursive: true });
    chmodSync(join(binDir, 'mytool'), 0o755);
    assert.equal(binaryIdentity('mytool', { PATH: binDir }), null);
  });
});

test('A non-executable file is skipped in favour of an executable one in a later directory', () => {
  withDir((dir) => {
    const firstDir = join(dir, 'first');
    makeTool(firstDir, 'plain text file\n', 0o644);
    const secondDir = join(dir, 'second');
    const exe = makeTool(secondDir, '#!/bin/sh\nexit 0\n', 0o755);
    const r = binaryIdentity('mytool', { PATH: firstDir + delimiter + secondDir });
    assert.deepEqual(r, identityOf(exe, '17'));
  });
});

test('A tool absent from every PATH directory yields null', () => {
  withDir((dir) => {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    assert.equal(binaryIdentity('nonexistent-tool', { PATH: binDir }), null);
  });
});
