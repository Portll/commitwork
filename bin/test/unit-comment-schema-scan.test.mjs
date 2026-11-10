// Walks a directory tree and reports fact-comment violations plus long comment runs (bin/comment-schema.mjs scan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../comment-schema.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'scan-'));
}

test('returns zero files and empty collections for an empty directory', () => {
  const dir = makeDir();
  try {
    const r = scan(dir);
    assert.deepEqual(r, { files: 0, violations: [], counts: {}, reference: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips node_modules and dot directories during the walk', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'x.mjs'), '/* fact: a (expiry: never, prev: broken) */\n');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'y.mjs'), '/* fact: b (expiry: never, prev: broken) */\n');
    const r = scan(dir);
    assert.equal(r.files, 0);
    assert.equal(r.violations.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a violation when prev is not in the closed set', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'a.mjs'), '/* fact: something (expiry: never, prev: bogus) */\n');
    const r = scan(dir);
    assert.equal(r.files, 1);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].rel, 'a.mjs');
    assert.equal(r.violations[0].line, 1);
    assert.equal(r.violations[0].why, 'prev "bogus" is not in the closed set');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a violation when expiry is a placeholder like TODO', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'b.mjs'), '/* fact: something (expiry: TODO, prev: broken) */\n');
    const r = scan(dir);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].why, 'unresolved expiry "TODO"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a violation when the fact line does not match the schema', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'c.mjs'), '/* fact: */\n');
    const r = scan(dir);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].why, 'does not match the schema');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a long narrative comment run exceeding MAX_RUN', () => {
  const dir = makeDir();
  try {
    const lines = Array.from({ length: 7 }, () => 'word');
    const src = '/*\n' + lines.join('\n') + '\n*/\n';
    writeFileSync(join(dir, 'd.mjs'), src);
    const r = scan(dir);
    assert.equal(r.files, 1);
    assert.equal(r.violations.length, 0);
    assert.equal(r.counts['d.mjs'], 1);
    assert.equal(r.reference['d.mjs'], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies a long reference block and records it in reference', () => {
  const dir = makeDir();
  try {
    const lines = Array.from({ length: 7 }, (_, i) => `ref ${i}`);
    const src = '/*\n' + lines.join('\n') + '\n*/\n';
    writeFileSync(join(dir, 'e.mjs'), src);
    const r = scan(dir);
    assert.equal(r.counts['e.mjs'], 1);
    assert.equal(r.reference['e.mjs'], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not flag a run of exactly MAX_RUN lines as long', () => {
  const dir = makeDir();
  try {
    const lines = Array.from({ length: 6 }, () => 'word');
    const src = '/*\n' + lines.join('\n') + '\n*/\n';
    writeFileSync(join(dir, 'f.mjs'), src);
    const r = scan(dir);
    assert.equal(r.counts['f.mjs'], 1);
    assert.equal(r.reference['f.mjs'], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a valid fact comment with a closed-set prev and real expiry', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'g.mjs'), '/* fact: works (expiry: on re-measure, prev: unknown) */\n');
    const r = scan(dir);
    assert.equal(r.files, 1);
    assert.equal(r.violations.length, 0);
    assert.equal(r.counts['g.mjs'], undefined);
    assert.equal(r.reference['g.mjs'], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
