// Writes the payload as two-space indented JSON plus newline to CW_UPDATES_OUT and returns that path (monitor/update-vulns.mjs writeUpdates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeUpdates } from '../update-vulns.mjs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function inTemp(parts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'writeUpdates-'));
  const prev = process.env.CW_UPDATES_OUT;
  const out = join(dir, ...parts);
  process.env.CW_UPDATES_OUT = out;
  try {
    fn(dir, out);
  } finally {
    if (prev === undefined) delete process.env.CW_UPDATES_OUT;
    else process.env.CW_UPDATES_OUT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns the configured path when its parent directory already exists', () => {
  inTemp(['reports', 'updates.json'], (dir, out) => {
    mkdirSync(join(dir, 'reports'));
    const result = writeUpdates({ a: 1 });
    assert.equal(result, out);
  });
});

test('creates missing nested parent directories and returns the configured path', () => {
  inTemp(['a', 'b', 'c', 'updates.json'], (dir, out) => {
    const result = writeUpdates({ b: 2 });
    assert.equal(result, out);
    const content = readFileSync(out, 'utf8');
    assert.equal(content, '{\n  "b": 2\n}\n');
  });
});

test('writes two keys with two-space indentation and a trailing newline', () => {
  inTemp(['reports', 'updates.json'], (dir, out) => {
    const result = writeUpdates({ x: 1, y: 2 });
    const content = readFileSync(result, 'utf8');
    assert.equal(content, '{\n  "x": 1,\n  "y": 2\n}\n');
  });
});

test('writes an empty object as braces and a newline', () => {
  inTemp(['reports', 'updates.json'], (dir, out) => {
    const result = writeUpdates({});
    const content = readFileSync(result, 'utf8');
    assert.equal(content, '{}\n');
  });
});

test('writes an array value with four-space indented elements', () => {
  inTemp(['reports', 'updates.json'], (dir, out) => {
    const result = writeUpdates({ items: [1, 2] });
    const content = readFileSync(result, 'utf8');
    assert.equal(content, '{\n  "items": [\n    1,\n    2\n  ]\n}\n');
  });
});

test('writes a nested object with indentation growing by two spaces per level', () => {
  inTemp(['reports', 'updates.json'], (dir, out) => {
    const result = writeUpdates({ outer: { inner: 'val' } });
    const content = readFileSync(result, 'utf8');
    assert.equal(content, '{\n  "outer": {\n    "inner": "val"\n  }\n}\n');
  });
});

test('writes a long string value unchanged', () => {
  inTemp(['reports', 'updates.json'], (dir, out) => {
    const s = 'x'.repeat(50);
    const result = writeUpdates({ s });
    const content = readFileSync(result, 'utf8');
    assert.equal(content, `{\n  "s": "${s}"\n}\n`);
  });
});

test('writes the word undefined when the payload is undefined', () => {
  inTemp(['reports', 'updates.json'], (dir, out) => {
    const result = writeUpdates(undefined);
    const content = readFileSync(result, 'utf8');
    assert.equal(content, 'undefined\n');
  });
});

test('throws a TypeError when the payload contains a BigInt', () => {
  inTemp(['reports', 'updates.json'], () => {
    assert.throws(() => writeUpdates({ n: 1n }), {
      name: 'TypeError',
      message: 'Do not know how to serialize a BigInt',
    });
  });
});

test('replaces the contents of an existing output file', () => {
  inTemp(['reports', 'updates.json'], (dir, out) => {
    mkdirSync(join(dir, 'reports'));
    writeFileSync(out, 'old\n');
    const result = writeUpdates({ v: 'new' });
    const content = readFileSync(result, 'utf8');
    assert.equal(content, '{\n  "v": "new"\n}\n');
  });
});
