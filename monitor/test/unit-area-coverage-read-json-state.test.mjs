// Classifies a JSON state file as parsed, absent, unreadable, or unparseable (monitor/area-coverage.mjs readJsonState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonState } from '../area-coverage.mjs';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'readJsonState-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a file holding a JSON object returns ok true with the parsed object', () => {
  withDir((dir) => {
    const p = join(dir, 'state.json');
    writeFileSync(p, '{"a":1}');
    assert.deepEqual(readJsonState(p), { ok: true, value: { a: 1 } });
  });
});

test('a file holding the JSON literal null returns ok true with value null', () => {
  withDir((dir) => {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    assert.deepEqual(readJsonState(p), { ok: true, value: null });
  });
});

test('a file holding a generated JSON array returns ok true with that array', () => {
  withDir((dir) => {
    const p = join(dir, 'arr.json');
    const arr = Array.from({ length: 5 }, (_, i) => i);
    writeFileSync(p, JSON.stringify(arr));
    assert.deepEqual(readJsonState(p), { ok: true, value: [0, 1, 2, 3, 4] });
  });
});

test('a path that does not exist returns ok false with reason absent', () => {
  withDir((dir) => {
    const p = join(dir, 'missing.json');
    assert.deepEqual(readJsonState(p), { ok: false, reason: 'absent' });
  });
});

test('a path that is a directory returns unreadable with detail EISDIR', () => {
  withDir((dir) => {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    assert.deepEqual(readJsonState(sub), { ok: false, reason: 'unreadable', detail: 'EISDIR' });
  });
});

test('a path below a regular file returns unreadable with detail ENOTDIR', () => {
  withDir((dir) => {
    const f = join(dir, 'plain.json');
    writeFileSync(f, '{}');
    const p = join(f, 'inner.json');
    assert.deepEqual(readJsonState(p), { ok: false, reason: 'unreadable', detail: 'ENOTDIR' });
  });
});

test('a file without read permission returns unreadable with detail EACCES', () => {
  withDir((dir) => {
    const p = join(dir, 'locked.json');
    writeFileSync(p, '{}');
    chmodSync(p, 0o000);
    try {
      assert.deepEqual(readJsonState(p), { ok: false, reason: 'unreadable', detail: 'EACCES' });
    } finally {
      chmodSync(p, 0o644);
    }
  });
});

test('a file holding text that is not JSON returns unparseable with the parser message', () => {
  withDir((dir) => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    assert.deepEqual(readJsonState(p), {
      ok: false,
      reason: 'unparseable',
      detail: `Unexpected token 'o', "not json" is not valid JSON`,
    });
  });
});

test('an empty file returns unparseable with the end of input message', () => {
  withDir((dir) => {
    const p = join(dir, 'empty.json');
    writeFileSync(p, '');
    assert.deepEqual(readJsonState(p), {
      ok: false,
      reason: 'unparseable',
      detail: 'Unexpected end of JSON input',
    });
  });
});
