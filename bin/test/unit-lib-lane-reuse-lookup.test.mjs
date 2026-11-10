// Decides whether a stored lane result can be reused for a repository and input key (bin/lib/lane-reuse.mjs lookup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookup } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

function withCache(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'lookup-'));
  try {
    const repoPath = join(dir, 'repo');
    mkdirSync(repoPath);
    const cfg = { cache: join(dir, 'cache') };
    const check = { id: 'check1' };
    const d = join(cfg.cache, 'check1', `repo-${sha(resolve(repoPath)).slice(0, 12)}`);
    mkdirSync(d, { recursive: true });
    const base = { v: 2, check: 'check1', repo: resolve(repoPath), files: ['a.txt'], hashes: { 'a.txt': sha('data') }, result: { status: 'pass' }, key: 'k' };
    fn({ repoPath, cfg, check, d, base });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const putEntry = (d, entry) => writeFileSync(join(d, 'entry.json'), JSON.stringify(entry));

test('A missing entry file reports that there is no cached result', () => {
  withCache(({ repoPath, cfg, check }) => {
    assert.deepEqual(lookup(cfg, check, repoPath, 'k'), { hit: false, why: 'no cached result' });
  });
});

test('An entry file that is not JSON is reported as unreadable with the parse error', () => {
  withCache(({ repoPath, cfg, check, d }) => {
    writeFileSync(join(d, 'entry.json'), 'not json');
    assert.deepEqual(lookup(cfg, check, repoPath, 'k'),
      { hit: false, why: `cache entry unreadable (Unexpected token 'o', "not json" is not valid JSON)` });
  });
});

test('An entry with an older format version is not used', () => {
  withCache(({ repoPath, cfg, check, d, base }) => {
    writeFileSync(join(d, 'a.txt'), 'data');
    putEntry(d, { ...base, v: 1 });
    assert.deepEqual(lookup(cfg, check, repoPath, 'k'), { hit: false, why: 'cache entry not used: it has format 1, not 2' });
  });
});

test('An entry that lacks the report file the check needs is not used', () => {
  withCache(({ repoPath, cfg, d, base }) => {
    writeFileSync(join(d, 'a.txt'), 'data');
    putEntry(d, base);
    const check = { id: 'check1', report: { file: 'r.sarif' } };
    assert.deepEqual(lookup(cfg, check, repoPath, 'k'), { hit: false, why: 'cache entry not used: it does not hold r.sarif' });
  });
});

test('A different key reports that an input changed since the cached run', () => {
  withCache(({ repoPath, cfg, check, d, base }) => {
    writeFileSync(join(d, 'a.txt'), 'data');
    putEntry(d, base);
    assert.deepEqual(lookup(cfg, check, repoPath, 'other'), { hit: false, why: 'an input changed since the cached run' });
  });
});

test('A cached output file that is missing is reported as unreadable with its error code', () => {
  withCache(({ repoPath, cfg, check, d, base }) => {
    putEntry(d, base);
    assert.deepEqual(lookup(cfg, check, repoPath, 'k'), { hit: false, why: 'cached output a.txt unreadable (ENOENT)' });
  });
});

test('A cached output that is a directory is reported as not a regular file', () => {
  withCache(({ repoPath, cfg, check, d, base }) => {
    mkdirSync(join(d, 'a.txt'));
    putEntry(d, base);
    assert.deepEqual(lookup(cfg, check, repoPath, 'k'), { hit: false, why: 'cached output a.txt unreadable (not a regular file)' });
  });
});

test('A cached output whose content differs from its stored hash is reported as changed', () => {
  withCache(({ repoPath, cfg, check, d, base }) => {
    writeFileSync(join(d, 'a.txt'), 'datA');
    putEntry(d, base);
    assert.deepEqual(lookup(cfg, check, repoPath, 'k'), { hit: false, why: 'cached output a.txt changed after it was stored' });
  });
});

test('A later output that changed is reported after earlier outputs match', () => {
  withCache(({ repoPath, cfg, check, d, base }) => {
    writeFileSync(join(d, 'a.txt'), 'data');
    writeFileSync(join(d, 'b.txt'), 'B');
    putEntry(d, { ...base, files: ['a.txt', 'b.txt'], hashes: { 'a.txt': sha('data'), 'b.txt': sha('b') } });
    assert.deepEqual(lookup(cfg, check, repoPath, 'k'), { hit: false, why: 'cached output b.txt changed after it was stored' });
  });
});

test('A valid entry with the same key and intact outputs is a hit returning the entry and its directory', () => {
  withCache(({ repoPath, cfg, check, d, base }) => {
    writeFileSync(join(d, 'a.txt'), 'data');
    putEntry(d, base);
    assert.deepEqual(lookup(cfg, check, repoPath, 'k'), { hit: true, entry: base, dir: d });
  });
});
