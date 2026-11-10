// Lists all .md files under a directory, sorted (bin/cite-reach.mjs docsUnder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docsUnder } from '../cite-reach.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array for an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docsUnder-'));
  try {
    assert.deepEqual(docsUnder(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a single markdown file at the top level', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docsUnder-'));
  try {
    writeFileSync(join(dir, 'readme.md'), 'x');
    assert.deepEqual(docsUnder(dir), [join(dir, 'readme.md')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-markdown files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docsUnder-'));
  try {
    writeFileSync(join(dir, 'notes.txt'), 'x');
    writeFileSync(join(dir, 'data.json'), 'x');
    assert.deepEqual(docsUnder(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes markdown files in nested subdirectories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docsUnder-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'deep.md'), 'x');
    assert.deepEqual(docsUnder(dir), [join(sub, 'deep.md')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches markdown files with uppercase extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docsUnder-'));
  try {
    writeFileSync(join(dir, 'UPPER.MD'), 'x');
    assert.deepEqual(docsUnder(dir), [join(dir, 'UPPER.MD')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores files with .md in the middle of the name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docsUnder-'));
  try {
    writeFileSync(join(dir, 'file.md.txt'), 'x');
    assert.deepEqual(docsUnder(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns results sorted lexicographically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docsUnder-'));
  try {
    writeFileSync(join(dir, 'b.md'), 'x');
    writeFileSync(join(dir, 'a.md'), 'x');
    writeFileSync(join(dir, 'c.md'), 'x');
    assert.deepEqual(docsUnder(dir), [
      join(dir, 'a.md'),
      join(dir, 'b.md'),
      join(dir, 'c.md')
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes directories even if named like markdown files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docsUnder-'));
  try {
    const fakeMdDir = join(dir, 'fake.md');
    mkdirSync(fakeMdDir);
    writeFileSync(join(fakeMdDir, 'inner.md'), 'x');
    assert.deepEqual(docsUnder(dir), [join(fakeMdDir, 'inner.md')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
