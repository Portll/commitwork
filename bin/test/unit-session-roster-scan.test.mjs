// Records peer-header session bindings into the roster and reports what the scan saw (bin/session-roster.mjs scan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../session-roster.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const reader = (bindings, files = [], unreadable = []) => () => ({ bindings, files, unreadable });
const rows = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const strip = (recs) => recs.map(({ tree, ...rest }) => rest);
const T = '2024-01-01T00:00:00.000Z';
const N = '2024-03-01T00:00:00.000Z';

test('stamps a binding with its own timestamp rather than the scan clock', () => {
  withDir((dir) => {
    const path = join(dir, 'sessions.jsonl');
    const r = scan({ path, now: N, read: reader([{ name: 'a1', pid: 123, at: T }], ['h'], ['u']), live: new Set() });
    assert.deepEqual(strip(r.added), [{ name: 'a1', pid: '123', at: T, via: 'peer-header' }]);
    assert.equal(r.scanned, 1);
    assert.deepEqual(r.files, ['h']);
    assert.deepEqual(r.unreadable, ['u']);
    assert.deepEqual(strip(rows(path)), strip(r.added));
  });
});

test('falls back to the scan clock when a binding has a missing or empty timestamp', () => {
  withDir((dir) => {
    const path = join(dir, 'sessions.jsonl');
    const read = reader([{ name: 'f6', pid: 1 }, { name: 'g7', pid: 2, at: '' }]);
    const r = scan({ path, now: N, read, live: new Set() });
    assert.deepEqual(strip(r.added), [
      { name: 'f6', pid: '1', at: N, via: 'peer-header' },
      { name: 'g7', pid: '2', at: N, via: 'peer-header' },
    ]);
    assert.equal(r.scanned, 2);
    assert.deepEqual(strip(rows(path)), strip(r.added));
  });
});

test('normalises prefixed names and keeps a zero pid but omits a missing one', () => {
  withDir((dir) => {
    const path = join(dir, 'sessions.jsonl');
    const read = reader([
      { name: 'cw-B2', pid: null, at: T },
      { name: 'commitwork-9z', pid: 0, at: T },
      { name: 'cwq1', at: T },
    ]);
    const r = scan({ path, now: N, read, live: new Set() });
    assert.deepEqual(strip(r.added), [
      { name: 'b2', at: T, via: 'peer-header' },
      { name: '9z', pid: '0', at: T, via: 'peer-header' },
      { name: 'q1', at: T, via: 'peer-header' },
    ]);
    assert.deepEqual(strip(rows(path)), strip(r.added));
  });
});

test('records an identical binding only once and adds nothing on a rescan', () => {
  withDir((dir) => {
    const path = join(dir, 'sessions.jsonl');
    const b = { name: 'c3', pid: 42, at: T };
    const first = scan({ path, now: N, read: reader([b, b]), live: new Set() });
    assert.equal(first.scanned, 2);
    assert.deepEqual(strip(first.added), [{ name: 'c3', pid: '42', at: T, via: 'peer-header' }]);
    const before = readFileSync(path, 'utf8');
    const second = scan({ path, now: N, read: reader([b]), live: new Set() });
    assert.deepEqual(second.added, []);
    assert.equal(second.scanned, 1);
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.deepEqual(strip(rows(path)), [{ name: 'c3', pid: '42', at: T, via: 'peer-header' }]);
  });
});

test('passes cwd and a non-empty dir through to the reader and drops an empty dir', () => {
  withDir((dir) => {
    const path = join(dir, 'sessions.jsonl');
    const seen = [];
    const read = (a) => { seen.push(a); return { bindings: [], files: [], unreadable: [] }; };
    scan({ path, cwd: '/w', dir: '/d', read, live: new Set() });
    scan({ path, cwd: '/w', dir: '', read, live: new Set() });
    assert.deepEqual(seen, [{ cwd: '/w', dir: '/d' }, { cwd: '/w' }]);
  });
});

test('returns an empty result echoing the files when nothing is bound', () => {
  withDir((dir) => {
    const path = join(dir, 'sessions.jsonl');
    const read = () => ({ bindings: [], files: ['f1'], unreadable: [] });
    const r = scan({ path, now: N, read, live: [] });
    assert.deepEqual(r, { added: [], scanned: 0, files: ['f1'], unreadable: [], collisions: [] });
    assert.equal(existsSync(path), false);
  });
});

test('rejects a binding whose name is not a two-character session id', () => {
  withDir((dir) => {
    const path = join(dir, 'sessions.jsonl');
    assert.throws(() => scan({ path, now: N, read: reader([{ name: 'x', pid: 1, at: T }]), live: new Set() }),
      { name: 'Error', message: 'not a session name: x' });
    assert.throws(() => scan({ path, now: N, read: reader([{ name: 'abc', pid: 1, at: T }]), live: new Set() }),
      { name: 'Error', message: 'not a session name: abc' });
    assert.equal(existsSync(path), false);
  });
});

test('hands the supplied live set to collisions instead of probing live pids', () => {
  withDir((dir) => {
    const path = join(dir, 'sessions.jsonl');
    const trap = () => { throw new TypeError('live set consulted'); };
    const live = new Proxy({}, { get: trap, has: trap, getPrototypeOf: trap, ownKeys: trap });
    const read = reader([
      { name: 'e5', pid: 9000001, at: T, file: 'h1' },
      { name: 'e5', pid: 9000002, at: T, file: 'h2' },
    ]);
    assert.throws(() => scan({ path, now: N, read, live }), { name: 'TypeError', message: 'live set consulted' });
    assert.deepEqual(strip(rows(path)), [
      { name: 'e5', pid: '9000001', at: T, via: 'peer-header' },
      { name: 'e5', pid: '9000002', at: T, via: 'peer-header' },
    ]);
  });
});
