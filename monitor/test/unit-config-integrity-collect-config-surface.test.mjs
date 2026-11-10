// Sorted sha256 fingerprints of config files and symlink states, plus unreadable targets (monitor/config-integrity.mjs collectConfigSurface).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectConfigSurface } from '../config-integrity.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'collectConfigSurface-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('an empty target list yields no items and no unknowns', () => {
  withDir((dir) => {
    const r = collectConfigSurface({ home: dir, targets: [] });
    assert.deepEqual(r, { items: [], unknowns: [] });
  });
});

test('a config file is recorded with its byte size and the sha256 of its text', () => {
  withDir((dir) => {
    const p = join(dir, 'settings.json');
    const text = 'x'.repeat(5) + '\u00e9';
    writeFileSync(p, text);
    const r = collectConfigSurface({ home: dir, targets: [{ path: p, kind: 'config' }] });
    assert.deepEqual(r, { items: [{ id: p, kind: 'config', size: 7, sha256: sha(text) }], unknowns: [] });
  });
});

test('a symlink target is recorded as link followed by its raw link text', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'real'));
    const link = join(dir, 'link');
    symlinkSync('real', link);
    const r = collectConfigSurface({ home: dir, targets: [{ path: link, kind: 'symlink' }] });
    assert.deepEqual(r, { items: [{ id: link, kind: 'symlink', value: 'link:real', sha256: sha('link:real') }], unknowns: [] });
  });
});

test('a real directory where a symlink was expected is recorded as not-a-link directory', () => {
  withDir((dir) => {
    const d = join(dir, 'store');
    mkdirSync(d);
    const r = collectConfigSurface({ home: dir, targets: [{ path: d, kind: 'symlink' }] });
    const value = 'not-a-link:directory';
    assert.deepEqual(r, { items: [{ id: d, kind: 'symlink', value, sha256: sha(value) }], unknowns: [] });
  });
});

test('a regular file where a symlink was expected is recorded as not-a-link file', () => {
  withDir((dir) => {
    const f = join(dir, 'verdicts');
    writeFileSync(f, 'abc');
    const r = collectConfigSurface({ home: dir, targets: [{ path: f, kind: 'symlink' }] });
    const value = 'not-a-link:file';
    assert.deepEqual(r, { items: [{ id: f, kind: 'symlink', value, sha256: sha(value) }], unknowns: [] });
  });
});

test('a missing config file is skipped without an unknown', () => {
  withDir((dir) => {
    const r = collectConfigSurface({ home: dir, targets: [{ path: join(dir, 'missing.json'), kind: 'config' }] });
    assert.deepEqual(r, { items: [], unknowns: [] });
  });
});

test('a missing symlink is skipped without an unknown', () => {
  withDir((dir) => {
    const r = collectConfigSurface({ home: dir, targets: [{ path: join(dir, 'missing-link'), kind: 'symlink' }] });
    assert.deepEqual(r, { items: [], unknowns: [] });
  });
});

test('targets that fail with an error other than ENOENT are reported as unknowns in input order', () => {
  withDir((dir) => {
    const f = join(dir, 'plain.txt');
    writeFileSync(f, 'p');
    const cfg = join(f, 'x');
    const lnk = join(f, 'y');
    const r = collectConfigSurface({ home: dir, targets: [{ path: cfg, kind: 'config' }, { path: lnk, kind: 'symlink' }] });
    assert.deepEqual(r.items, []);
    assert.deepEqual(r.unknowns.map((u) => u.id), [cfg, lnk]);
  });
});

test('items are sorted by id in ascending order', () => {
  withDir((dir) => {
    const pb = join(dir, 'b.json');
    const pa = join(dir, 'a.json');
    writeFileSync(pb, 'bb');
    writeFileSync(pa, 'a');
    const r = collectConfigSurface({ home: dir, targets: [{ path: pb, kind: 'config' }, { path: pa, kind: 'config' }] });
    assert.deepEqual(r, {
      items: [
        { id: pa, kind: 'config', size: 1, sha256: sha('a') },
        { id: pb, kind: 'config', size: 2, sha256: sha('bb') },
      ],
      unknowns: [],
    });
  });
});

test('items with equal ids keep their collection order', () => {
  withDir((dir) => {
    const p = join(dir, 'same.json');
    writeFileSync(p, 'x');
    const r = collectConfigSurface({ home: dir, targets: [{ path: p, kind: 'config' }, { path: p, kind: 'symlink' }] });
    assert.deepEqual(r, {
      items: [
        { id: p, kind: 'config', size: 1, sha256: sha('x') },
        { id: p, kind: 'symlink', value: 'not-a-link:file', sha256: sha('not-a-link:file') },
      ],
      unknowns: [],
    });
  });
});
