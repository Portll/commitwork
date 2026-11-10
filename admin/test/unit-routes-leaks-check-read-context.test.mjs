// Builds a numbered, capped excerpt around a matched line (admin/routes/leaks-check-readContext).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readContext } from '../routes/leaks-check.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok false with ENOENT message when file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readContext-'));
  try {
    const res = readContext(join(dir, 'missing.txt'), 1);
    assert.deepEqual(res, { ok: false, error: 'file no longer present in the working tree' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true with excerpt and matched line for a valid file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readContext-'));
  try {
    const p = join(dir, 'a.txt');
    writeFileSync(p, 'l1\nl2\nl3\nl4\nl5');
    const res = readContext(p, 3);
    assert.equal(res.ok, true);
    assert.equal(res.matched, 'l3');
    assert.equal(res.totalLines, 5);
    assert.equal(res.excerpt, '    1| l1\n    2| l2\n    3| l3\n    4| l4\n    5| l5');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clamps line number to 1 when input is 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readContext-'));
  try {
    const p = join(dir, 'b.txt');
    writeFileSync(p, 'a\nb\nc');
    const res = readContext(p, 0);
    assert.equal(res.matched, 'a');
    assert.equal(res.totalLines, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clamps line number to last line when input exceeds total', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readContext-'));
  try {
    const p = join(dir, 'c.txt');
    writeFileSync(p, 'a\nb\nc');
    const res = readContext(p, 99);
    assert.equal(res.matched, 'c');
    assert.equal(res.totalLines, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('truncates lines longer than 400 chars with ellipsis marker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readContext-'));
  try {
    const p = join(dir, 'd.txt');
    const longLine = 'x'.repeat(401);
    writeFileSync(p, `short\n${longLine}\nend`);
    const res = readContext(p, 2);
    assert.equal(res.ok, true);
    assert.equal(res.matched, longLine);
    const expectedLine = `${'x'.repeat(400)}\u2026 [truncated]`;
    assert.ok(res.excerpt.includes(expectedLine));
    assert.ok(res.excerpt.includes('    2| '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not truncate lines exactly 400 chars long', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readContext-'));
  try {
    const p = join(dir, 'e.txt');
    const exactLine = 'y'.repeat(400);
    writeFileSync(p, `s\n${exactLine}\ne`);
    const res = readContext(p, 2);
    assert.equal(res.matched, exactLine);
    assert.ok(res.excerpt.includes(`    2| ${exactLine}`));
    assert.ok(!res.excerpt.includes('[truncated]'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles file with single line and line 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readContext-'));
  try {
    const p = join(dir, 'f.txt');
    writeFileSync(p, 'only');
    const res = readContext(p, 1);
    assert.equal(res.ok, true);
    assert.equal(res.matched, 'only');
    assert.equal(res.totalLines, 1);
    assert.equal(res.excerpt, '    1| only');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles empty file with line 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readContext-'));
  try {
    const p = join(dir, 'g.txt');
    writeFileSync(p, '');
    const res = readContext(p, 1);
    assert.equal(res.ok, true);
    assert.equal(res.matched, '');
    assert.equal(res.totalLines, 1);
    assert.equal(res.excerpt, '    1| ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
