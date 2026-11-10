// Appends a timestamped JSON line to verify.jsonl under cfg.cache (bin/lib/lane-reuse.mjs journal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journal } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AT = '2026-01-01T00:00:00.000Z';
process.env.CW_NOW = AT;

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'journal-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('creates a missing nested cache directory and writes one timestamped line', () => {
  withDir((dir) => {
    const cache = join(dir, 'a', 'b');
    const r = journal({ cache }, { id: 1 });
    assert.deepEqual(r, { ok: true });
    assert.equal(readFileSync(join(cache, 'verify.jsonl'), 'utf8'), `{"at":"${AT}","id":1}\n`);
  });
});

test('appends after existing content when the cache directory already exists', () => {
  withDir((dir) => {
    const cache = join(dir, 'cache');
    mkdirSync(cache);
    writeFileSync(join(cache, 'verify.jsonl'), 'old\n');
    const r = journal({ cache }, { id: 2 });
    assert.deepEqual(r, { ok: true });
    assert.equal(readFileSync(join(cache, 'verify.jsonl'), 'utf8'), `old\n{"at":"${AT}","id":2}\n`);
  });
});

test('two calls write two lines in order', () => {
  withDir((dir) => {
    const cache = join(dir, 'cache');
    assert.deepEqual(journal({ cache }, { n: 'x'.repeat(3) }), { ok: true });
    assert.deepEqual(journal({ cache }, { n: 'y'.repeat(2) }), { ok: true });
    assert.equal(
      readFileSync(join(cache, 'verify.jsonl'), 'utf8'),
      `{"at":"${AT}","n":"xxx"}\n{"at":"${AT}","n":"yy"}\n`,
    );
  });
});

test('a row field named at overrides the timestamp but keeps its first position', () => {
  withDir((dir) => {
    const cache = join(dir, 'cache');
    const r = journal({ cache }, { id: 3, at: 'manual' });
    assert.deepEqual(r, { ok: true });
    assert.equal(readFileSync(join(cache, 'verify.jsonl'), 'utf8'), '{"at":"manual","id":3}\n');
  });
});

test('an undefined row writes only the timestamp', () => {
  withDir((dir) => {
    const cache = join(dir, 'cache');
    const r = journal({ cache }, undefined);
    assert.deepEqual(r, { ok: true });
    assert.equal(readFileSync(join(cache, 'verify.jsonl'), 'utf8'), `{"at":"${AT}"}\n`);
  });
});

test('reports the error code when verify.jsonl is a directory', () => {
  withDir((dir) => {
    const cache = join(dir, 'cache');
    mkdirSync(join(cache, 'verify.jsonl'), { recursive: true });
    const r = journal({ cache }, { id: 4 });
    assert.deepEqual(r, { ok: false, error: 'EISDIR' });
  });
});

test('reports the error code when the cache path is null', () => {
  const r = journal({ cache: null }, { id: 5 });
  assert.deepEqual(r, { ok: false, error: 'ERR_INVALID_ARG_TYPE' });
});

test('reports the message when cfg is undefined', () => {
  const r = journal(undefined, { id: 6 });
  assert.deepEqual(r, { ok: false, error: "Cannot read properties of undefined (reading 'cache')" });
});

test('keeps only the first line of a multi-line error message', () => {
  const cfg = { get cache() { throw new Error('first\nsecond'); } };
  const r = journal(cfg, { id: 7 });
  assert.deepEqual(r, { ok: false, error: 'first' });
});

test('stringifies a thrown non-error value', () => {
  const cfg = { get cache() { throw 'plain'; } };
  const r = journal(cfg, { id: 8 });
  assert.deepEqual(r, { ok: false, error: 'plain' });
});
