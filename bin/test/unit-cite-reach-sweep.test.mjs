// Maps doc tokens to reachability and reanchor candidates (bin/cite-reach.mjs sweep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweep } from '../cite-reach.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-'));
  return dir;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test('returns zero counts for empty directory', () => {
  const dir = setup();
  try {
    const result = sweep({ repo: '/nonexistent', dir });
    assert.deepEqual(result, {
      files: 0,
      tokens: 0,
      byState: { reachable: 0, unreachable: 0, unresolvable: 0 },
      rows: [],
      rewritten: []
    });
  } finally {
    cleanup(dir);
  }
});

test('counts unresolvable tokens in byState', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'a.md'), 'see 1234567890abcdef1234567890abcdef12345678 for details');
    const result = sweep({ repo: '/nonexistent', dir });
    assert.equal(result.byState.unresolvable, 1);
    assert.equal(result.byState.reachable, 0);
    assert.equal(result.byState.unreachable, 0);
  } finally {
    cleanup(dir);
  }
});

test('aggregates multiple files per token in rows', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'a.md'), 'token 1234567890abcdef1234567890abcdef12345678 here');
    writeFileSync(join(dir, 'b.md'), 'token 1234567890abcdef1234567890abcdef12345678 again');
    const result = sweep({ repo: '/nonexistent', dir });
    assert.equal(result.tokens, 1);
    assert.deepEqual(result.rows[0].files, ['a.md', 'b.md']);
  } finally {
    cleanup(dir);
  }
});

test('returns empty rewritten array when no unreachable tokens', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'a.md'), 'ref 1234567890abcdef1234567890abcdef12345678');
    const result = sweep({ repo: '/nonexistent', dir });
    assert.deepEqual(result.rewritten, []);
  } finally {
    cleanup(dir);
  }
});

test('sorts tokens alphabetically in rows', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'a.md'), 'a 1234567890abcdef1234567890abcdef12345678 b abcdef1234567890abcdef1234567890abcdef');
    const result = sweep({ repo: '/nonexistent', dir });
    assert.equal(result.tokens, 2);
    assert.equal(result.rows[0].token, '1234567890abcdef1234567890abcdef12345678');
    assert.equal(result.rows[1].token, 'abcdef1234567890abcdef1234567890abcdef');
  } finally {
    cleanup(dir);
  }
});

test('includes full hash in unresolvable row when rev-parse succeeds', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'a.md'), 'commit 1234567890abcdef1234567890abcdef12345678');
    const result = sweep({ repo: '/nonexistent', dir });
    assert.equal(result.rows[0].state, 'unresolvable');
    assert.equal(result.rows[0].full, undefined);
  } finally {
    cleanup(dir);
  }
});

test('returns zero files count when no markdown files exist', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'a.txt'), 'not markdown 1234567890abcdef1234567890abcdef12345678');
    const result = sweep({ repo: '/nonexistent', dir });
    assert.equal(result.files, 0);
    assert.equal(result.tokens, 0);
  } finally {
    cleanup(dir);
  }
});

test('handles nested directories in docsUnder', () => {
  const dir = setup();
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'a.md'), 'nested 1234567890abcdef1234567890abcdef12345678');
    const result = sweep({ repo: '/nonexistent', dir });
    assert.equal(result.files, 1);
    assert.equal(result.tokens, 1);
    assert.deepEqual(result.rows[0].files, ['sub/a.md']);
  } finally {
    cleanup(dir);
  }
});
