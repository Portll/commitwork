// Parses a rollup file into its frozen head without body keys, memoized by file identity (monitor/rollup-head.mjs readRollupHead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRollupHead } from '../rollup-head.mjs';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'readRollupHead-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a missing file returns ok false with the ENOENT error from open', () => {
  withDir((dir) => {
    const input = join(dir, 'missing.json');
    const result = readRollupHead(input);
    assert.deepEqual(Object.keys(result), ['ok', 'error']);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ENOENT');
    assert.equal(result.error.syscall, 'open');
    assert.equal(result.error.path, input);
  });
});

test('an object rollup returns ok true with a deeply frozen head that drops the body keys', () => {
  withDir((dir) => {
    const input = join(dir, 'rollup.json');
    writeFileSync(input, JSON.stringify({ scannerFindings: [1], repos: { r: 1 }, allKeys: ['k'], a: 1, b: { c: [2] } }));
    const result = readRollupHead(input);
    assert.deepEqual(result, { ok: true, head: { a: 1, b: { c: [2] } } });
    assert.equal(Object.isFrozen(result.head), true);
    assert.equal(Object.isFrozen(result.head.b.c), true);
  });
});

test('a JSON null rollup returns ok true with a null head', () => {
  withDir((dir) => {
    const input = join(dir, 'rollup.json');
    writeFileSync(input, 'null');
    const result = readRollupHead(input);
    assert.deepEqual(result, { ok: true, head: null });
  });
});

test('a JSON array rollup returns ok true with the whole array as a frozen head', () => {
  withDir((dir) => {
    const input = join(dir, 'rollup.json');
    writeFileSync(input, JSON.stringify([1, 2, 3]));
    const result = readRollupHead(input);
    assert.deepEqual(result, { ok: true, head: [1, 2, 3] });
    assert.equal(Object.isFrozen(result.head), true);
  });
});

test('invalid JSON returns ok false with the SyntaxError from JSON.parse', () => {
  withDir((dir) => {
    const input = join(dir, 'rollup.json');
    writeFileSync(input, 'not json');
    const result = readRollupHead(input);
    assert.deepEqual(Object.keys(result), ['ok', 'error']);
    assert.equal(result.ok, false);
    assert.equal(result.error.name, 'SyntaxError');
    assert.equal(result.error.message, 'Unexpected token \'o\', "not json" is not valid JSON');
  });
});

test('a second read with unchanged inode, size and mtime returns the memoized result, not the new bytes', () => {
  withDir((dir) => {
    const input = join(dir, 'rollup.json');
    writeFileSync(input, '{"v":1}');
    utimesSync(input, 1000000, 1000000);
    readRollupHead(input);
    writeFileSync(input, '{"v":2}');
    utimesSync(input, 1000000, 1000000);
    const result = readRollupHead(input);
    assert.deepEqual(result, { ok: true, head: { v: 1 } });
  });
});

test('a second read after the file size changes re-parses the file', () => {
  withDir((dir) => {
    const input = join(dir, 'rollup.json');
    writeFileSync(input, '{"a":1}');
    readRollupHead(input);
    writeFileSync(input, '{"a":22}');
    const result = readRollupHead(input);
    assert.deepEqual(result, { ok: true, head: { a: 22 } });
  });
});

test('the memo holds 256 paths, so the oldest stays memoized after 255 newer reads', () => {
  withDir((dir) => {
    const input = join(dir, 'oldest.json');
    writeFileSync(input, '{"v":1}');
    utimesSync(input, 1000000, 1000000);
    readRollupHead(input);
    for (const i of Array.from({ length: 255 }, (_, n) => n)) {
      const other = join(dir, `other-${i}.json`);
      writeFileSync(other, String(i));
      readRollupHead(other);
    }
    writeFileSync(input, '{"v":2}');
    utimesSync(input, 1000000, 1000000);
    const result = readRollupHead(input);
    assert.deepEqual(result, { ok: true, head: { v: 1 } });
  });
});

test('the memo evicts the oldest path after 256 newer reads, so it is parsed again', () => {
  withDir((dir) => {
    const input = join(dir, 'oldest.json');
    writeFileSync(input, '{"v":1}');
    utimesSync(input, 1000000, 1000000);
    readRollupHead(input);
    for (const i of Array.from({ length: 256 }, (_, n) => n)) {
      const other = join(dir, `other-${i}.json`);
      writeFileSync(other, String(i));
      readRollupHead(other);
    }
    writeFileSync(input, '{"v":2}');
    utimesSync(input, 1000000, 1000000);
    const result = readRollupHead(input);
    assert.deepEqual(result, { ok: true, head: { v: 2 } });
  });
});
