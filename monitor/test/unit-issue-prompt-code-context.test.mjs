// numbered source window around an anchor line (monitor/issue-prompt.mjs codeContext).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeContext } from '../issue-prompt.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = (count) => Array.from({ length: count }, (_, i) => `line${i + 1}`).join('\n');

const rows = (first, last, anchor) =>
  Array.from({ length: last - first + 1 }, (_, i) => first + i)
    .map((n) => `${n}${n === anchor ? ' >>' : '  '} line${n}`)
    .join('\n');

const at = (dir, file, line) => codeContext({ anchor: { file, line } }, { root: dir });

function inTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'codeContext-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns null when the issue is absent or has no anchor', () => {
  assert.equal(codeContext(null), null);
  assert.equal(codeContext(undefined), null);
  assert.equal(codeContext({}), null);
  assert.equal(codeContext({ anchor: null }), null);
});

test('returns null when the anchor file is not a non-empty string', () => {
  inTempDir((dir) => {
    assert.equal(at(dir, 123, 1), null);
    assert.equal(at(dir, '', 1), null);
    assert.equal(at(dir, undefined, 1), null);
  });
});

test('returns null for a line that is not an integer even when the file exists', () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, 'a.js'), 'a\nb\nc');
    assert.equal(at(dir, 'a.js', 1.5), null);
    assert.equal(at(dir, 'a.js', '1'), null);
    assert.equal(at(dir, 'a.js', undefined), null);
  });
});

test('returns null for a line below 1 even when the file exists', () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, 'a.js'), 'a\nb\nc');
    assert.equal(at(dir, 'a.js', 0), null);
    assert.equal(at(dir, 'a.js', -1), null);
  });
});

test('returns null when the file is missing or the path is a directory', () => {
  inTempDir((dir) => {
    mkdirSync(join(dir, 'sub'));
    assert.equal(at(dir, 'missing.js', 1), null);
    assert.equal(at(dir, 'sub', 1), null);
  });
});

test('accepts line 1 and marks the first row of the file', () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, 'a.js'), 'a\nb\nc');
    assert.deepEqual(at(dir, 'a.js', 1), { file: 'a.js', excerpt: '1 >> a\n2   b\n3   c' });
  });
});

test('keeps the relative file name and shows the empty row after a trailing newline', () => {
  inTempDir((dir) => {
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'src', 'deep', 'a.js'), 'a\nb\n');
    assert.deepEqual(at(dir, 'src/deep/a.js', 2), {
      file: 'src/deep/a.js',
      excerpt: '1   a\n2 >> b\n3   ',
    });
  });
});

test('shows twenty rows on each side of an anchor in the middle of a long file', () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, 'a.js'), source(60));
    assert.deepEqual(at(dir, 'a.js', 30), { file: 'a.js', excerpt: rows(10, 50, 30) });
  });
});

test('starts at row 1 through line 21 and at row 2 for line 22', () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, 'a.js'), source(60));
    assert.deepEqual(at(dir, 'a.js', 20), { file: 'a.js', excerpt: rows(1, 40, 20) });
    assert.deepEqual(at(dir, 'a.js', 21), { file: 'a.js', excerpt: rows(1, 41, 21) });
    assert.deepEqual(at(dir, 'a.js', 22), { file: 'a.js', excerpt: rows(2, 42, 22) });
  });
});

test('stops at the last row of the file and has an empty excerpt past the window', () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, 'a.js'), source(60));
    assert.deepEqual(at(dir, 'a.js', 39), { file: 'a.js', excerpt: rows(19, 59, 39) });
    assert.deepEqual(at(dir, 'a.js', 40), { file: 'a.js', excerpt: rows(20, 60, 40) });
    assert.deepEqual(at(dir, 'a.js', 41), { file: 'a.js', excerpt: rows(21, 60, 41) });
    assert.deepEqual(at(dir, 'a.js', 61), { file: 'a.js', excerpt: rows(41, 60, 61) });
    assert.deepEqual(at(dir, 'a.js', 81), { file: 'a.js', excerpt: '' });
  });
});
