// bin/test/comment-suggest-units.test.mjs — case tests for asFacts, suggestAll.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asFacts, suggestAll } from '../comment-suggest.mjs';

test('returns null when fewer than two fact lines', () => {
  const block = ['// fact: only one here (expiry: never, prev: not built)'];
  assert.equal(asFacts(block), null);
});

test('returns null when first line is not a fact', () => {
  const block = [
    '// some prose line',
    '// fact: one (expiry: never, prev: not built)',
    '// fact: two (expiry: never, prev: not built)',
  ];
  assert.equal(asFacts(block), null);
});

test('returns entries for two fact lines with trailers', () => {
  const block = [
    '// fact: first claim (expiry: never, prev: not built)',
    '// fact: second claim (expiry: never, prev: not built)',
  ];
  const result = asFacts(block);
  assert.deepEqual(result, [
    'first claim (expiry: never, prev: not built)',
    'second claim (expiry: never, prev: not built)',
  ]);
});

test('appends continuation lines to the open entry', () => {
  const block = [
    '// fact: first claim',
    '// continued text here',
    '// (expiry: never, prev: not built)',
    '// fact: second claim (expiry: never, prev: not built)',
  ];
  const result = asFacts(block);
  assert.deepEqual(result, [
    'first claim continued text here (expiry: never, prev: not built)',
    'second claim (expiry: never, prev: not built)',
  ]);
});

test('returns null for empty block', () => {
  assert.equal(asFacts([]), null);
});

test('handles three fact entries', () => {
  const block = [
    '// fact: a (expiry: never, prev: not built)',
    '// fact: b (expiry: never, prev: not built)',
    '// fact: c (expiry: never, prev: not built)',
  ];
  const result = asFacts(block);
  assert.deepEqual(result, [
    'a (expiry: never, prev: not built)',
    'b (expiry: never, prev: not built)',
    'c (expiry: never, prev: not built)',
  ]);
});

test('returns empty array for empty files list', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-'));
  try {
    assert.deepEqual(suggestAll(root, []), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips files that cannot be read', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-'));
  try {
    const res = suggestAll(root, ['does-not-exist.mjs']);
    assert.deepEqual(res, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns empty array when file has no comment runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-'));
  try {
    writeFileSync(join(root, 'a.mjs'), 'export const x = 1;\n');
    const res = suggestAll(root, ['a.mjs']);
    assert.deepEqual(res, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns empty array when comment run is not over MAX_RUN', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-'));
  try {
    const src = '// short comment\nexport const x = 1;\n';
    writeFileSync(join(root, 'b.mjs'), src);
    const res = suggestAll(root, ['b.mjs']);
    assert.deepEqual(res, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns suggestions for files with over-long comment runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-'));
  try {
    const lines = [];
    for (let i = 0; i < 10; i++) lines.push(`// fact: line ${i} because it matters (expiry: never, prev: not built)`);
    lines.push('export const x = 1;');
    writeFileSync(join(root, 'c.mjs'), lines.join('\n') + '\n');
    const res = suggestAll(root, ['c.mjs']);
    assert.ok(Array.isArray(res));
    assert.ok(res.length >= 1);
    assert.equal(res[0].file, 'c.mjs');
    assert.equal(res[0].id, 'c.mjs#0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('aggregates suggestions across multiple files', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-'));
  try {
    const mk = (name) => {
      const lines = [];
      for (let i = 0; i < 10; i++) lines.push(`// fact: ${name} line ${i} because it matters (expiry: never, prev: not built)`);
      lines.push('export const x = 1;');
      writeFileSync(join(root, name), lines.join('\n') + '\n');
    };
    mk('f1.mjs');
    mk('f2.mjs');
    const res = suggestAll(root, ['f1.mjs', 'f2.mjs']);
    assert.ok(res.length >= 2);
    const files = res.map((s) => s.file);
    assert.ok(files.includes('f1.mjs'));
    assert.ok(files.includes('f2.mjs'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
