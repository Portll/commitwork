// bin/test/cite-reach-units.test.mjs — case tests for docsUnder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docsUnder } from '../cite-reach.mjs';

test('returns empty array for empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cite-'));
  try {
    assert.deepEqual(docsUnder(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finds markdown files in root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cite-'));
  try {
    writeFileSync(join(dir, 'a.md'), 'x');
    writeFileSync(join(dir, 'b.txt'), 'x');
    const res = docsUnder(dir);
    assert.equal(res.length, 1);
    assert.equal(res[0], join(dir, 'a.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finds markdown files in nested directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cite-'));
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'root.md'), 'x');
    writeFileSync(join(dir, 'sub', 'deep.md'), 'x');
    const res = docsUnder(dir);
    assert.equal(res.length, 2);
    assert.deepEqual(res, [join(dir, 'root.md'), join(dir, 'sub', 'deep.md')].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-markdown files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cite-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'x');
    writeFileSync(join(dir, 'b.js'), 'x');
    writeFileSync(join(dir, 'c.json'), 'x');
    assert.deepEqual(docsUnder(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches .md case-insensitively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cite-'));
  try {
    writeFileSync(join(dir, 'a.MD'), 'x');
    writeFileSync(join(dir, 'b.Md'), 'x');
    const res = docsUnder(dir);
    assert.equal(res.length, 2);
    assert.deepEqual(res, [join(dir, 'a.MD'), join(dir, 'b.Md')].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns sorted paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cite-'));
  try {
    writeFileSync(join(dir, 'z.md'), 'x');
    writeFileSync(join(dir, 'a.md'), 'x');
    writeFileSync(join(dir, 'm.md'), 'x');
    const res = docsUnder(dir);
    assert.deepEqual(res, [join(dir, 'a.md'), join(dir, 'm.md'), join(dir, 'z.md')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
