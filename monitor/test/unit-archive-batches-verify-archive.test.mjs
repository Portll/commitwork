// Integrity report of a sealed archive checked against its embedded manifest (monitor/archive-batches.mjs verifyArchive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyArchive } from '../archive-batches.mjs';
import { packEntries, sealArchive, openArchive, sha256, KEY_LEN } from '../archive-container.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';

const KEY = Buffer.alloc(KEY_LEN, 7);
const MF = '__manifest__.json';
const h = (s) => sha256(Buffer.from(s));

const raw = (r) => {
  if (Buffer.isBuffer(r)) return r;
  if (Array.isArray(r)) return Buffer.concat(r.map((v) => Buffer.from(v)));
  return Buffer.from(Object.values(r).find((v) => v instanceof Uint8Array));
};

function build(files, decl, shift) {
  const pack = (frames) => raw(packEntries([
    ...(decl ? [{ path: MF, data: Buffer.from(JSON.stringify({ frames, entries: decl })) }] : []),
    ...Object.entries(files).map(([p, s]) => ({ path: p, data: Buffer.from(s) })),
  ]));
  const seal = (frames) => raw(sealArchive(pack(frames), KEY));
  let frames = openArchive(seal(0), KEY).frames;
  frames = openArchive(seal(frames), KEY).frames;
  const buf = seal(frames + shift);
  return { buf, frames, manifest: decl && { frames: frames + shift, entries: decl } };
}

function withArchive(files, decl, shift, check) {
  const dir = mkdtempSync(join(tmpdir(), 'verifyArchive-'));
  try {
    const a = build(files, decl, shift);
    const file = join(dir, 'batch.cwa');
    writeFileSync(file, a.buf);
    assert.equal(readFileSync(file).length, a.buf.length);
    check(file, a);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const report = (a, rest) => ({
  ok: false, manifest: a.manifest, frames: a.frames, missing: [], wrong: [], extra: [], bytes: a.buf.length, ...rest,
});

test('an archive whose files all match the manifest reports ok with no findings', () => {
  const decl = [{ path: 'a.txt', sha256: h('hello') }, { path: 'b.txt', sha256: h('world') }];
  withArchive({ 'a.txt': 'hello', 'b.txt': 'world' }, decl, 0, (file, a) => {
    assert.deepEqual(verifyArchive(file, KEY), report(a, { ok: true }));
  });
});

test('an archive holding only a manifest with no entries reports ok', () => {
  withArchive({}, [], 0, (file, a) => {
    assert.deepEqual(verifyArchive(file, KEY), report(a, { ok: true }));
  });
});

test('an archive without a manifest entry throws', () => {
  withArchive({ 'a.txt': 'hello' }, null, 0, (file) => {
    assert.throws(() => verifyArchive(file, KEY), { name: 'Error', message: 'archive carries no manifest' });
  });
});

test('a manifest declaring one frame more or one fewer than the archive throws', () => {
  for (const shift of [1, -1]) {
    withArchive({ 'a.txt': 'hello' }, [{ path: 'a.txt', sha256: h('hello') }], shift, (file, a) => {
      assert.throws(() => verifyArchive(file, KEY), {
        name: 'Error',
        message: `manifest declares ${a.frames + shift} frames, archive has ${a.frames}`,
      });
    });
  }
});

test('a declared file absent from the archive is reported missing and not ok', () => {
  const decl = [{ path: 'a.txt', sha256: h('hello') }, { path: 'b.txt', sha256: h('world') }];
  withArchive({ 'a.txt': 'hello' }, decl, 0, (file, a) => {
    assert.deepEqual(verifyArchive(file, KEY), report(a, { missing: ['b.txt'] }));
  });
});

test('a file whose hash differs from the manifest is reported wrong and not ok', () => {
  const decl = [{ path: 'a.txt', sha256: h('hello') }, { path: 'b.txt', sha256: h('world') }];
  withArchive({ 'a.txt': 'HELLO', 'b.txt': 'world' }, decl, 0, (file, a) => {
    assert.deepEqual(verifyArchive(file, KEY), report(a, { wrong: ['a.txt'] }));
  });
});

test('a file in the archive that the manifest does not declare is reported extra and not ok', () => {
  withArchive({ 'a.txt': 'hello', 'c.txt': 'extra' }, [{ path: 'a.txt', sha256: h('hello') }], 0, (file, a) => {
    assert.deepEqual(verifyArchive(file, KEY), report(a, { extra: ['c.txt'] }));
  });
});

test('missing, wrong and extra files are all reported together', () => {
  const decl = [{ path: 'a.txt', sha256: h('hello') }, { path: 'b.txt', sha256: h('world') }];
  withArchive({ 'a.txt': 'HELLO', 'c.txt': 'extra' }, decl, 0, (file, a) => {
    assert.deepEqual(verifyArchive(file, KEY), report(a, { missing: ['b.txt'], wrong: ['a.txt'], extra: ['c.txt'] }));
  });
});
