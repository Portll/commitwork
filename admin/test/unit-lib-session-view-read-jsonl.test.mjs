// Reads a JSONL file, returning parsed rows or a status object (admin/lib/session-view.mjs readJsonl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonl } from '../lib/session-view.mjs';

test('returns ok true absent true rows empty when file is missing', () => {
  const fakeReadFile = (path, enc) => {
    const err = new Error('no file');
    err.code = 'ENOENT';
    throw err;
  };
  const result = readJsonl('/nonexistent/file.jsonl', { readFile: fakeReadFile });
  assert.deepEqual(result, { ok: true, absent: true, rows: [] });
});

test('returns ok false with error code when read fails with non-ENOENT error', () => {
  const fakeReadFile = (path, enc) => {
    const err = new Error('permission denied');
    err.code = 'EACCES';
    throw err;
  };
  const result = readJsonl('/protected/file.jsonl', { readFile: fakeReadFile });
  assert.equal(result.ok, false);
  assert.equal(result.why, '/protected/file.jsonl: EACCES');
  assert.deepEqual(result.rows, []);
});

test('returns ok false with error message when read fails with no code', () => {
  const fakeReadFile = (path, enc) => {
    throw new Error('something broke');
  };
  const result = readJsonl('/some/file.jsonl', { readFile: fakeReadFile });
  assert.equal(result.ok, false);
  assert.equal(result.why, "/some/file.jsonl: Error: something broke");
  assert.deepEqual(result.rows, []);
});

test('parses valid JSON lines and skips empty lines', () => {
  const content = '{"a":1}\n\n{"b":2}\n   \n{"c":3}\n';
  const fakeReadFile = (path, enc) => content;
  const result = readJsonl('/data.jsonl', { readFile: fakeReadFile });
  assert.equal(result.ok, true);
  assert.equal(result.absent, false);
  assert.deepEqual(result.rows, [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test('skips lines that are not valid JSON', () => {
  const content = '{"valid":true}\nnot json at all\n{"also":true}\n';
  const fakeReadFile = (path, enc) => content;
  const result = readJsonl('/mixed.jsonl', { readFile: fakeReadFile });
  assert.equal(result.ok, true);
  assert.equal(result.absent, false);
  assert.deepEqual(result.rows, [{ valid: true }, { also: true }]);
});

test('returns empty rows when file content is empty string', () => {
  const fakeReadFile = (path, enc) => '';
  const result = readJsonl('/empty.jsonl', { readFile: fakeReadFile });
  assert.equal(result.ok, true);
  assert.equal(result.absent, false);
  assert.deepEqual(result.rows, []);
});

test('returns empty rows when file content is only whitespace lines', () => {
  const content = '\n   \n\t\n  \n';
  const fakeReadFile = (path, enc) => content;
  const result = readJsonl('/ws.jsonl', { readFile: fakeReadFile });
  assert.equal(result.ok, true);
  assert.equal(result.absent, false);
  assert.deepEqual(result.rows, []);
});

test('handles multiple valid JSON objects on separate lines', () => {
  const n = 5;
  const lines = Array.from({ length: n }, (_, i) => JSON.stringify({ idx: i }));
  const content = lines.join('\n') + '\n';
  const fakeReadFile = (path, enc) => content;
  const result = readJsonl('/multi.jsonl', { readFile: fakeReadFile });
  assert.equal(result.ok, true);
  assert.equal(result.absent, false);
  assert.equal(result.rows.length, n);
  for (let i = 0; i < n; i++) {
    assert.deepEqual(result.rows[i], { idx: i });
  }
});
