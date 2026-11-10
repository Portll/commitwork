// The parsed feature charter and its flag table, memoised by path, mtime and size (lib/feature-charter.mjs loadFlagTable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFlagTable } from '../feature-charter.mjs';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'loadFlagTable-'));
  const prev = process.env.CW_FC_CHARTER;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.CW_FC_CHARTER;
    else process.env.CW_FC_CHARTER = prev;
    rmSync(dir, { recursive: true, force: true });
  }
};
const load = (p) => {
  process.env.CW_FC_CHARTER = p;
  return loadFlagTable();
};
const parseMessage = (src) => {
  try { JSON.parse(src); } catch (e) { return e.message; }
  return null;
};
const simple = (id, label) => ({ experimentalFlags: { [id]: { label, why: 'W' } } });
const entry = (id, label) => ({ id, label, why: 'W', groups: [], keys: {} });
const okResult = (p, id, label) => ({ ok: true, path: p, charter: simple(id, label), flags: new Map([[id, entry(id, label)]]) });

test('a missing charter file is reported unreadable with the ENOENT code', () => {
  withDir((dir) => {
    const p = join(dir, 'missing.json');
    assert.deepEqual(load(p), { ok: false, path: p, error: `feature charter unreadable at ${p} (ENOENT)` });
  });
});

test('a charter path under a plain file is reported unreadable with the ENOTDIR code', () => {
  withDir((dir) => {
    const f = join(dir, 'plain.txt');
    writeFileSync(f, 'x');
    const p = join(f, 'charter.json');
    assert.deepEqual(load(p), { ok: false, path: p, error: `feature charter unreadable at ${p} (ENOTDIR)` });
  });
});

test('a valid charter with one flag returns ok with the charter and its flag table', () => {
  withDir((dir) => {
    const p = join(dir, 'charter.json');
    writeFileSync(p, JSON.stringify(simple('my-flag', 'L')));
    assert.deepEqual(load(p), okResult(p, 'my-flag', 'L'));
  });
});

test('a flagged ring-outward group adds its keys and views to the flag entry', () => {
  withDir((dir) => {
    const p = join(dir, 'groups.json');
    const charter = {
      experimentalFlags: { 'beta-x': { label: 'Beta', why: 'try', views: ['pv'] } },
      groups: [
        { id: 'g1', flag: 'beta-x', experimental: true, class: 'ring-outward', surface: 'cli', keys: ['k1', 'k2'], views: ['gv'] },
        { id: 'g2' },
      ],
    };
    writeFileSync(p, JSON.stringify(charter));
    const flag = {
      id: 'beta-x',
      label: 'Beta',
      why: 'try',
      groups: [{ id: 'g1', surface: 'cli', keys: ['k1', 'k2'], views: ['gv'] }],
      keys: { view: ['pv', 'gv'], cli: ['k1', 'k2'] },
    };
    assert.deepEqual(load(p), { ok: true, path: p, charter, flags: new Map([['beta-x', flag]]) });
  });
});

test('a charter that is not valid JSON is reported unusable with the parse error', () => {
  withDir((dir) => {
    const p = join(dir, 'bad.json');
    const src = '{ not json';
    writeFileSync(p, src);
    assert.deepEqual(load(p), { ok: false, path: p, error: `feature charter at ${p} is unusable: ${parseMessage(src)}` });
  });
});

test('a charter whose experimentalFlags is an array is reported unusable with the flag table error', () => {
  withDir((dir) => {
    const p = join(dir, 'arr.json');
    writeFileSync(p, JSON.stringify({ experimentalFlags: [] }));
    const msg = 'feature-charter: experimentalFlags must be an object of {id: {label, why}}';
    assert.deepEqual(load(p), { ok: false, path: p, error: `feature charter at ${p} is unusable: ${msg}` });
  });
});

test('a second load of an unchanged charter returns the very same memoised object', () => {
  withDir((dir) => {
    const p = join(dir, 'memo.json');
    writeFileSync(p, JSON.stringify(simple('memo-flag', 'M')));
    const r1 = load(p);
    const r2 = load(p);
    assert.equal(r2, r1);
    assert.deepEqual(r1, okResult(p, 'memo-flag', 'M'));
  });
});

test('rewriting the charter with a different size makes the next load read the new content', () => {
  withDir((dir) => {
    const p = join(dir, 'change.json');
    writeFileSync(p, JSON.stringify(simple('v1-flag', 'V1')));
    const r1 = load(p);
    assert.deepEqual(r1, okResult(p, 'v1-flag', 'V1'));
    writeFileSync(p, JSON.stringify(simple('v2-flag', 'V22')));
    const r2 = load(p);
    assert.deepEqual(r2, okResult(p, 'v2-flag', 'V22'));
  });
});

test('a different path with the same mtime and size is read fresh instead of reusing the memo', () => {
  withDir((dir) => {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    writeFileSync(a, JSON.stringify(simple('link-flag', 'K')));
    symlinkSync(a, b);
    const ra = load(a);
    assert.deepEqual(ra, okResult(a, 'link-flag', 'K'));
    const rb = load(b);
    assert.deepEqual(rb, okResult(b, 'link-flag', 'K'));
  });
});
