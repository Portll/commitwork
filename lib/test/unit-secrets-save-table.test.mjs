// Atomically writes a table as two-space-indented JSON to a 0600 file and returns its path (lib/secrets.mjs saveTable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveTable } from '../secrets.mjs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'saveTable-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('saving into an existing directory returns the path and writes two-space JSON', () => {
  withDir((dir) => {
    const file = join(dir, 'secrets.json');
    const r = saveTable({ key: 'value' }, file);
    assert.equal(r, file);
    assert.equal(readFileSync(file, 'utf8'), '{\n  "key": "value"\n}\n');
  });
});

test('missing parent directories are created before the file is written', () => {
  withDir((dir) => {
    const file = join(dir, 'a', 'b', 'c', 'secrets.json');
    const r = saveTable({ x: 2 }, file);
    assert.equal(r, file);
    assert.equal(readFileSync(file, 'utf8'), '{\n  "x": 2\n}\n');
  });
});

test('an already existing parent directory is accepted without error', () => {
  withDir((dir) => {
    const sub = join(dir, 'present');
    mkdirSync(sub);
    const file = join(sub, 'secrets.json');
    assert.equal(saveTable({ ok: true }, file), file);
    assert.equal(readFileSync(file, 'utf8'), '{\n  "ok": true\n}\n');
  });
});

test('nested objects and arrays are indented two spaces per level', () => {
  withDir((dir) => {
    const file = join(dir, 'secrets.json');
    saveTable({ a: { b: [1] } }, file);
    assert.equal(readFileSync(file, 'utf8'), '{\n  "a": {\n    "b": [\n      1\n    ]\n  }\n}\n');
  });
});

test('an empty object is written as braces followed by a newline', () => {
  withDir((dir) => {
    const file = join(dir, 'secrets.json');
    assert.equal(saveTable({}, file), file);
    assert.equal(readFileSync(file, 'utf8'), '{}\n');
  });
});

test('an array table is written one element per indented line', () => {
  withDir((dir) => {
    const file = join(dir, 'secrets.json');
    saveTable([1, 2, 3], file);
    assert.equal(readFileSync(file, 'utf8'), '[\n  1,\n  2,\n  3\n]\n');
  });
});

test('the written file has mode 0600 and no temporary file is left behind', () => {
  withDir((dir) => {
    const file = join(dir, 'secrets.json');
    saveTable({ perm: true }, file);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir), ['secrets.json']);
  });
});

test('an existing file is replaced with the new content and tightened to mode 0600', () => {
  withDir((dir) => {
    const file = join(dir, 'secrets.json');
    writeFileSync(file, 'old content', { mode: 0o644 });
    assert.equal(saveTable({ fresh: true }, file), file);
    assert.equal(readFileSync(file, 'utf8'), '{\n  "fresh": true\n}\n');
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });
});

test('without a file argument the path comes from CW_SECRETS_FILE at call time', () => {
  withDir((dir) => {
    const prev = process.env.CW_SECRETS_FILE;
    const file = join(dir, 'env', 'table.json');
    process.env.CW_SECRETS_FILE = file;
    try {
      const r = saveTable({ n: 'v'.repeat(3) }, undefined);
      assert.equal(r, file);
      assert.equal(readFileSync(file, 'utf8'), '{\n  "n": "vvv"\n}\n');
    } finally {
      if (prev === undefined) delete process.env.CW_SECRETS_FILE;
      else process.env.CW_SECRETS_FILE = prev;
    }
  });
});
