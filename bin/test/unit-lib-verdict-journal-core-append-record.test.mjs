// Appends a hash-linked record to a journal under a write lock (bin/lib/verdict-journal-core.mjs appendRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRecord } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const lineHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'appendRecord-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a symbol path fails before locking and reports the conversion error message', () => {
  assert.deepEqual(appendRecord(Symbol('ledger'), { v: 1 }), {
    ok: false,
    error: 'Cannot convert a Symbol value to a string',
  });
});

test('a path whose string conversion throws a coded value reports only that code', () => {
  const path = { toString() { throw { code: 'ELOCKPATH', message: 'path rejected' }; } };
  assert.deepEqual(appendRecord(path, { v: 1 }), { ok: false, error: 'ELOCKPATH' });
});

test('a path whose string conversion throws a bare string reports that string', () => {
  const path = { toString() { throw 'path rejected'; } };
  assert.deepEqual(appendRecord(path, { v: 1 }), { ok: false, error: 'path rejected' });
});

test('a first record on a missing journal is written with a genesis link', () => {
  withDir((dir) => {
    const filePath = join(dir, 'gate.jsonl');
    const env = { v: 1, gate: 'gate', n: 1 };
    assert.deepEqual(appendRecord(filePath, env), { ok: true, path: filePath });
    assert.equal(readFileSync(filePath, 'utf8'), `${JSON.stringify({ ...env, prev: 'genesis' })}\n`);
  });
});

test('a journal exactly at the size limit is extended and links to the hash of its last line', () => {
  withDir((dir) => {
    const filePath = join(dir, 'gate.jsonl');
    const first = JSON.stringify({ v: 1, gate: 'gate', n: 1, prev: 'genesis' });
    writeFileSync(filePath, `${first}\n`);
    const env = { v: 1, gate: 'gate', n: 2 };
    const r = appendRecord(filePath, env, { maxBytes: Buffer.byteLength(`${first}\n`) });
    assert.deepEqual(r, { ok: true, path: filePath });
    assert.equal(
      readFileSync(filePath, 'utf8'),
      `${first}\n${JSON.stringify({ ...env, prev: lineHash(first) })}\n`,
    );
    assert.equal(existsSync(`${filePath}.1`), false);
  });
});

test('a journal one byte over the size limit is rotated and the new record links to the rotated tail', () => {
  withDir((dir) => {
    const filePath = join(dir, 'gate.jsonl');
    const first = JSON.stringify({ v: 1, gate: 'gate', n: 1, prev: 'genesis' });
    writeFileSync(filePath, `${first}\n`);
    const env = { v: 1, gate: 'gate', n: 2 };
    const r = appendRecord(filePath, env, { maxBytes: Buffer.byteLength(`${first}\n`) - 1 });
    assert.deepEqual(r, { ok: true, path: filePath });
    assert.equal(
      readFileSync(filePath, 'utf8'),
      `${JSON.stringify({ ...env, prev: `rotation:${lineHash(first)}` })}\n`,
    );
    assert.equal(readFileSync(`${filePath}.1`, 'utf8'), `${first}\n`);
  });
});

test('a lock already held by another writer is reported as ledger busy and nothing is appended', () => {
  withDir((dir) => {
    const filePath = join(dir, 'gate.jsonl');
    writeFileSync(`${filePath}.lock`, JSON.stringify({ label: 'other writer' }));
    const r = appendRecord(filePath, { v: 1, gate: 'gate', n: 1 });
    const prefix = `ledger busy: ${filePath}.lock held for `;
    assert.deepEqual(Object.keys(r), ['ok', 'error']);
    assert.equal(r.ok, false);
    assert.equal(r.error.slice(0, prefix.length), prefix);
    assert.equal(existsSync(filePath), false);
  });
});
