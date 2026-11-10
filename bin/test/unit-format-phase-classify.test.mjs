// Per-file format verdict for declared staged files (bin/format-phase.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../format-phase.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'classify-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a declared file missing from the staged set is not-staged even when it has unstaged hunks', () => {
  withDir((dir) => {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'x\n');
    assert.deepEqual(classify([f], new Set(), new Set([f])), [{ file: f, verdict: 'not-staged' }]);
  });
});

test('a file with both staged and unstaged hunks is refused so another writer is not overwritten', () => {
  withDir((dir) => {
    const f = join(dir, 'b.txt');
    writeFileSync(f, 'x\n');
    assert.deepEqual(classify([f], new Set([f]), new Set([f])), [{
      file: f,
      verdict: 'refused',
      reason: 'staged AND unstaged hunks \u2014 a writer holds uncommitted work here; formatting would rewrite under them. Sequence with that session, or let them land first.',
    }]);
  });
});

test('a path under test/fixtures is refused but a path under mytest/fixtures is formatted', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'test', 'fixtures'), { recursive: true });
    mkdirSync(join(dir, 'mytest', 'fixtures'), { recursive: true });
    const fx = join(dir, 'test', 'fixtures', 'c.txt');
    const other = join(dir, 'mytest', 'fixtures', 'c.txt');
    writeFileSync(fx, 'x');
    writeFileSync(other, 'x');
    assert.deepEqual(classify([fx, other], new Set([fx, other]), new Set()), [
      { file: fx, verdict: 'refused', reason: 'test fixture \u2014 verbatim tool output; a cleaned byte changes what the test proves' },
      { file: other, verdict: 'needs-format' },
    ]);
  });
});

test('a path that cannot be read is refused with the error code in the reason', () => {
  withDir((dir) => {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    assert.deepEqual(classify([sub], new Set([sub]), new Set()), [{
      file: sub,
      verdict: 'refused',
      reason: 'unreadable (EISDIR) \u2014 refusing to classify what could not be read',
    }]);
  });
});

test('a read error without a code is reported as error in the reason', () => {
  withDir((dir) => {
    const f = join(dir, 'nocode.txt');
    writeFileSync(f, 'x\n');
    const reader = () => { throw new Error('boom'); };
    assert.deepEqual(classify([f], new Set([f]), new Set(), reader), [{
      file: f,
      verdict: 'refused',
      reason: 'unreadable (error) \u2014 refusing to classify what could not be read',
    }]);
  });
});

test('a zero byte within the first 8192 bytes marks the file binary but one at byte 8192 does not', () => {
  withDir((dir) => {
    const inside = join(dir, 'inside.dat');
    const outside = join(dir, 'outside.dat');
    writeFileSync(inside, Buffer.concat([Buffer.alloc(8191, 'a'), Buffer.alloc(1, 0)]));
    writeFileSync(outside, Buffer.concat([Buffer.alloc(8192, 'a'), Buffer.alloc(1, 0)]));
    assert.deepEqual(classify([inside, outside], new Set([inside, outside]), new Set()), [
      { file: inside, verdict: 'refused', reason: 'binary content' },
      { file: outside, verdict: 'needs-format' },
    ]);
  });
});

test('text needs format when it lacks a final newline or has extra trailing newlines, and is clean with exactly one', () => {
  withDir((dir) => {
    const none = join(dir, 'none.txt');
    const one = join(dir, 'one.txt');
    const two = join(dir, 'two.txt');
    writeFileSync(none, 'hello');
    writeFileSync(one, 'hello\n');
    writeFileSync(two, 'hello\n\n');
    assert.deepEqual(classify([none, one, two], new Set([none, one, two]), new Set()), [
      { file: none, verdict: 'needs-format' },
      { file: one, verdict: 'clean' },
      { file: two, verdict: 'needs-format' },
    ]);
  });
});

test('trailing spaces need format in plain text but are kept clean in markdown of any extension case', () => {
  withDir((dir) => {
    const txt = join(dir, 'f.txt');
    const md = join(dir, 'f.md');
    const upper = join(dir, 'g.MARKDOWN');
    for (const f of [txt, md, upper]) writeFileSync(f, 'line  \n');
    assert.deepEqual(classify([txt, md, upper], new Set([txt, md, upper]), new Set()), [
      { file: txt, verdict: 'needs-format' },
      { file: md, verdict: 'clean' },
      { file: upper, verdict: 'clean' },
    ]);
  });
});
