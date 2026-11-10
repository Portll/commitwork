// Appends a versioned, hash-chained envelope line to <dir>/<gate>.jsonl (bin/lib/verdict-journal-core.mjs journal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journal } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDirs(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'journal-'));
  const envDir = mkdtempSync(join(tmpdir(), 'journal-'));
  const saved = process.env.CW_VERDICT_DIR;
  process.env.CW_VERDICT_DIR = envDir;
  try {
    fn(dir, envDir);
  } finally {
    if (saved === undefined) delete process.env.CW_VERDICT_DIR;
    else process.env.CW_VERDICT_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
    rmSync(envDir, { recursive: true, force: true });
  }
}

const line = (fields) => `${JSON.stringify(fields)}\n`;

test('writes a genesis line with v 1, the gate, the pid and the given session', () => {
  withDirs((dir) => {
    const r = journal('build', { msg: 'ok' }, { dir, session: 's1' });
    assert.deepEqual(r, { ok: true, path: join(dir, 'build.jsonl') });
    const text = readFileSync(join(dir, 'build.jsonl'), 'utf8');
    const { at } = JSON.parse(text);
    assert.equal(text, line({ v: 1, gate: 'build', at, pid: process.pid, session: 's1', msg: 'ok', prev: 'genesis' }));
  });
});

test('a record at field replaces the timestamp and the session defaults to null', () => {
  withDirs((dir) => {
    journal('gate', { at: '2020-01-01T00:00:00.000Z' }, { dir });
    assert.equal(
      readFileSync(join(dir, 'gate.jsonl'), 'utf8'),
      line({ v: 1, gate: 'gate', at: '2020-01-01T00:00:00.000Z', pid: process.pid, session: null, prev: 'genesis' }),
    );
  });
});

test('record fields override v and gate in the line but not the file name', () => {
  withDirs((dir) => {
    const r = journal('check', { v: 99, gate: 'other' }, { dir });
    assert.deepEqual(r, { ok: true, path: join(dir, 'check.jsonl') });
    const text = readFileSync(join(dir, 'check.jsonl'), 'utf8');
    const { at } = JSON.parse(text);
    assert.equal(text, line({ v: 99, gate: 'other', at, pid: process.pid, session: null, prev: 'genesis' }));
  });
});

test('a prev field in the record is replaced by the computed genesis prev', () => {
  withDirs((dir) => {
    journal('gate', { prev: 'forged' }, { dir });
    const text = readFileSync(join(dir, 'gate.jsonl'), 'utf8');
    const { at } = JSON.parse(text);
    assert.equal(text, line({ v: 1, gate: 'gate', at, pid: process.pid, session: null, prev: 'genesis' }));
  });
});

test('a second append chains to the first line instead of genesis', () => {
  withDirs((dir) => {
    journal('test', { n: 1 }, { dir });
    const r = journal('test', { n: 2 }, { dir });
    assert.deepEqual(r, { ok: true, path: join(dir, 'test.jsonl') });
    const [first, second, rest] = readFileSync(join(dir, 'test.jsonl'), 'utf8').split('\n');
    assert.equal(rest, '');
    assert.equal(JSON.parse(first).prev, 'genesis');
    const parsed = JSON.parse(second);
    assert.notEqual(parsed.prev, 'genesis');
    assert.deepEqual(parsed, { v: 1, gate: 'test', at: parsed.at, pid: process.pid, session: null, n: 2, prev: parsed.prev });
  });
});

test('falls back to CW_VERDICT_DIR when no dir option is given', () => {
  withDirs((dir, envDir) => {
    const r = journal('lint', { msg: 'x' });
    assert.deepEqual(r, { ok: true, path: join(envDir, 'lint.jsonl') });
    const text = readFileSync(join(envDir, 'lint.jsonl'), 'utf8');
    const { at } = JSON.parse(text);
    assert.equal(text, line({ v: 1, gate: 'lint', at, pid: process.pid, session: null, msg: 'x', prev: 'genesis' }));
    assert.deepEqual(readdirSync(dir), []);
  });
});

test('an explicit dir wins over CW_VERDICT_DIR and leaves that directory untouched', () => {
  withDirs((dir, envDir) => {
    const r = journal('unit', { x: 0 }, { dir });
    assert.deepEqual(r, { ok: true, path: join(dir, 'unit.jsonl') });
    assert.deepEqual(readdirSync(envDir), []);
    const text = readFileSync(join(dir, 'unit.jsonl'), 'utf8');
    const { at } = JSON.parse(text);
    assert.equal(text, line({ v: 1, gate: 'unit', at, pid: process.pid, session: null, x: 0, prev: 'genesis' }));
  });
});
