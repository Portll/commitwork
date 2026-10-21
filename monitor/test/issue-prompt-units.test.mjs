// monitor/test/issue-prompt-units.test.mjs — case tests for codeContext.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeContext } from '../issue-prompt.mjs';

test('returns null when issue is null', () => {
  assert.equal(codeContext(null), null);
});

test('returns null when anchor is missing', () => {
  assert.equal(codeContext({}), null);
});

test('returns null when anchor.file is not a string', () => {
  assert.equal(codeContext({ anchor: { file: 123, line: 1 } }), null);
});

test('returns null when anchor.file is empty string', () => {
  assert.equal(codeContext({ anchor: { file: '', line: 1 } }), null);
});

test('returns null when anchor.line is not an integer', () => {
  assert.equal(codeContext({ anchor: { file: 'a.js', line: 1.5 } }), null);
});

test('returns null when anchor.line is less than 1', () => {
  assert.equal(codeContext({ anchor: { file: 'a.js', line: 0 } }), null);
});

test('returns null when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
  try {
    const result = codeContext({ anchor: { file: 'nonexistent.js', line: 1 } }, { root: dir });
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns excerpt with marked line for existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
  try {
    const content = 'line1\nline2\nline3\nline4\nline5';
    writeFileSync(join(dir, 'test.js'), content);
    const result = codeContext({ anchor: { file: 'test.js', line: 3 } }, { root: dir });
    assert.equal(result.file, 'test.js');
    assert.ok(result.excerpt.includes('3 >> line3'));
    assert.ok(result.excerpt.includes('1   line1'));
    assert.ok(result.excerpt.includes('5   line5'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
