// Runs a callback on the locked launchlist state and saves it when the result is ok (lib/launchlist.mjs withState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withState } from '../launchlist.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = 'CW_LAUNCHLIST_DIR';

function inTemp(run) {
  const dir = mkdtempSync(join(tmpdir(), 'withState-'));
  const prev = process.env[KEY];
  process.env[KEY] = dir;
  try {
    run(dir);
  } finally {
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an ok result is returned and the new state is saved with two-space indentation', () => {
  inTemp((dir) => {
    const r = withState((s) => { s.items.a = 1; return { ok: true, n: 7 }; });
    assert.deepEqual(r, { ok: true, n: 7 });
    const expected = ['{', '  "version": 1,', '  "ticks": {},', '  "items": {', '    "a": 1', '  },', '  "log": []', '}', ''].join('\n');
    assert.equal(readFileSync(join(dir, 'state.json'), 'utf8'), expected);
  });
});

test('an existing state file is loaded, changed by the callback and saved back', () => {
  inTemp((dir) => {
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify({ version: 3, ticks: { t1: 'done' }, items: {}, log: [] }));
    const r = withState((s) => { s.items.k = { n: 2 }; s.log.push({ at: 'x' }); return { ok: true, seen: s.ticks.t1 }; });
    assert.deepEqual(r, { ok: true, seen: 'done' });
    const saved = { version: 3, ticks: { t1: 'done' }, items: { k: { n: 2 } }, log: [{ at: 'x' }] };
    assert.equal(readFileSync(path, 'utf8'), `${JSON.stringify(saved, null, 2)}\n`);
  });
});

test('a result with ok false is returned and no state file is written', () => {
  inTemp((dir) => {
    let seen;
    const r = withState((s) => { seen = structuredClone(s); s.items.a = 1; return { ok: false, why: 'no' }; });
    assert.deepEqual(r, { ok: false, why: 'no' });
    assert.deepEqual(seen, { version: 1, ticks: {}, items: {}, log: [] });
    assert.equal(existsSync(join(dir, 'state.json')), false);
  });
});

test('a null result is returned as null and leaves an existing state file untouched', () => {
  inTemp((dir) => {
    const path = join(dir, 'state.json');
    const raw = JSON.stringify({ version: 1, ticks: {}, items: { a: 1 }, log: [] });
    writeFileSync(path, raw);
    const r = withState((s) => { s.items.b = 2; return null; });
    assert.equal(r, null);
    assert.equal(readFileSync(path, 'utf8'), raw);
  });
});

test('a state file holding JSON null is treated as an empty state', () => {
  inTemp((dir) => {
    const path = join(dir, 'state.json');
    writeFileSync(path, 'null');
    const r = withState((s) => { s.log.push('first'); return { ok: true }; });
    assert.deepEqual(r, { ok: true });
    const expected = ['{', '  "version": 1,', '  "ticks": {},', '  "items": {},', '  "log": [', '    "first"', '  ]', '}', ''].join('\n');
    assert.equal(readFileSync(path, 'utf8'), expected);
  });
});

test('a missing launchlist directory is created before the state is saved', () => {
  inTemp((dir) => {
    const nested = join(dir, 'a', 'b');
    process.env[KEY] = nested;
    const r = withState((s) => { s.ticks.go = true; return { ok: true }; });
    assert.deepEqual(r, { ok: true });
    const expected = ['{', '  "version": 1,', '  "ticks": {', '    "go": true', '  },', '  "items": {},', '  "log": []', '}', ''].join('\n');
    assert.equal(readFileSync(join(nested, 'state.json'), 'utf8'), expected);
  });
});

test('a state file missing ticks or a log array throws and the lock is released for the next call', () => {
  inTemp((dir) => {
    const path = join(dir, 'state.json');
    const expected = { name: 'Error', message: `launchlist: ${path} is missing ticks/items/log` };
    writeFileSync(path, JSON.stringify({ items: {}, log: [] }));
    assert.throws(() => withState(() => ({ ok: true })), expected);
    writeFileSync(path, JSON.stringify({ ticks: {}, items: {}, log: {} }));
    assert.throws(() => withState(() => ({ ok: true })), expected);
    writeFileSync(path, JSON.stringify({ ticks: {}, items: {}, log: [] }));
    assert.deepEqual(withState((s) => ({ ok: false, ticks: s.ticks })), { ok: false, ticks: {} });
  });
});

test('a state file that is not valid JSON throws with the parser message', () => {
  inTemp((dir) => {
    const path = join(dir, 'state.json');
    const raw = '{"version": 1,';
    writeFileSync(path, raw);
    let parseMessage;
    try { JSON.parse(raw); } catch (e) { parseMessage = e.message; }
    assert.throws(() => withState(() => ({ ok: true })), { name: 'Error', message: `launchlist: ${path} is not valid JSON: ${parseMessage}` });
  });
});

test('a nested call made while the store lock is held is refused as busy', () => {
  inTemp((dir) => {
    let inner;
    const r = withState(() => { inner = withState(() => ({ ok: true })); return { ok: false }; });
    assert.deepEqual(r, { ok: false });
    assert.deepEqual(Object.keys(inner), ['ok', 'refused', 'error']);
    assert.equal(inner.ok, false);
    assert.equal(inner.refused, 'busy');
    assert.match(inner.error, /^launchlist store is locked by another writer \(.*\)$/);
    assert.equal(existsSync(join(dir, 'state.json')), false);
  });
});
