// Caches a lane's output files and result as an entry directory under cfg.cache (bin/lib/lane-reuse.mjs store).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const entryPath = (cache, id, name, repo) => join(cache, id, `${name}-${sha(resolve(repo)).slice(0, 12)}`);
const withBase = (fn) => {
  const base = mkdtempSync(join(tmpdir(), 'store-'));
  try { fn(base); } finally { rmSync(base, { recursive: true, force: true }); }
};
const setup = (base, files) => {
  const reportDir = join(base, 'report');
  mkdirSync(reportDir, { recursive: true });
  for (const [n, c] of Object.entries(files)) writeFileSync(join(reportDir, n), c);
  return { cfg: { cache: join(base, 'cache') }, repo: join(base, 'repo'), reportDir };
};

test('a fresh store links the matched output and writes entry.json without durationMs', () => withBase((base) => {
  const { cfg, repo, reportDir } = setup(base, { 'out.log': 'hello', 'skip.txt': 'no' });
  const dir = entryPath(cfg.cache, 'c1', 'repo', repo);
  process.env.CW_NOW = '2026-01-02T03:04:05.000Z';
  let r;
  try {
    r = store(cfg, { id: 'c1', reuse: { outputs: ['out.log'] } }, repo, 'k1', { durationMs: 5, status: 'pass' }, reportDir);
  } finally {
    delete process.env.CW_NOW;
  }
  assert.deepEqual(r, { ok: true, files: ['out.log'] });
  const expected = {
    v: 2, key: 'k1', check: 'c1', repo: resolve(repo), storedAt: '2026-01-02T03:04:05.000Z',
    reportDir: resolve(reportDir), result: { status: 'pass' }, files: ['out.log'], hashes: { 'out.log': sha('hello') },
  };
  assert.equal(readFileSync(join(dir, 'entry.json'), 'utf8'), `${JSON.stringify(expected, null, 2)}\n`);
  assert.equal(readFileSync(join(dir, 'out.log'), 'utf8'), 'hello');
  assert.deepEqual(readdirSync(dir).sort(), ['entry.json', 'out.log']);
  assert.equal(existsSync(`${dir}.tmp-${process.pid}`), false);
}));

test('a second store replaces the entry and removes the old directory', () => withBase((base) => {
  const { cfg, repo, reportDir } = setup(base, { 'a.log': 'one', 'b.log': 'two' });
  const check = { id: 'c2', reuse: { outputs: ['*.log'] } };
  assert.deepEqual(store(cfg, check, repo, 'k1', { durationMs: 1 }, reportDir), { ok: true, files: ['a.log', 'b.log'] });
  const second = join(base, 'second');
  mkdirSync(second);
  writeFileSync(join(second, 'b.log'), 'three');
  const r = store(cfg, check, repo, 'k2', { durationMs: 2 }, second);
  const dir = entryPath(cfg.cache, 'c2', 'repo', repo);
  assert.deepEqual(r, { ok: true, files: ['b.log'] });
  assert.deepEqual(readdirSync(dir).sort(), ['b.log', 'entry.json']);
  assert.equal(readFileSync(join(dir, 'b.log'), 'utf8'), 'three');
  assert.equal(JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')).key, 'k2');
  assert.equal(existsSync(`${dir}.old-${process.pid}`), false);
}));

test('a leftover tmp directory with files is cleared before storing', () => withBase((base) => {
  const { cfg, repo, reportDir } = setup(base, { 'out.log': 'x' });
  const dir = entryPath(cfg.cache, 'c3', 'repo', repo);
  const tmp = `${dir}.tmp-${process.pid}`;
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'stale.txt'), 'old');
  const r = store(cfg, { id: 'c3', reuse: { outputs: ['out.log'] } }, repo, 'k', {}, reportDir);
  assert.deepEqual(r, { ok: true, files: ['out.log'] });
  assert.deepEqual(readdirSync(dir).sort(), ['entry.json', 'out.log']);
  assert.equal(existsSync(tmp), false);
}));

test('a leftover old directory with files is cleared before storing', () => withBase((base) => {
  const { cfg, repo, reportDir } = setup(base, { 'out.log': 'x' });
  const dir = entryPath(cfg.cache, 'c4', 'repo', repo);
  const old = `${dir}.old-${process.pid}`;
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'stale.txt'), 'old');
  const r = store(cfg, { id: 'c4', reuse: { outputs: ['out.log'] } }, repo, 'k', {}, reportDir);
  assert.deepEqual(r, { ok: true, files: ['out.log'] });
  assert.deepEqual(readdirSync(dir).sort(), ['entry.json', 'out.log']);
  assert.equal(existsSync(old), false);
}));

test('a check without reuse settings returns the error and leaves no tmp directory', () => withBase((base) => {
  const { cfg, repo, reportDir } = setup(base, {});
  const dir = entryPath(cfg.cache, 'c5', 'repo', repo);
  const r = store(cfg, { id: 'c5' }, repo, 'k', {}, reportDir);
  assert.deepEqual(r, { ok: false, error: "lane result not cached: Cannot read properties of undefined (reading 'outputs')" });
  assert.equal(existsSync(`${dir}.tmp-${process.pid}`), false);
  assert.equal(existsSync(dir), false);
}));

test('a missing report directory stores an entry with no files', () => withBase((base) => {
  const cfg = { cache: join(base, 'cache') };
  const repo = join(base, 'repo');
  const missing = join(base, 'nope');
  const r = store(cfg, { id: 'c6', reuse: { outputs: ['out.log'] } }, repo, 'k', { durationMs: 3 }, missing);
  const dir = entryPath(cfg.cache, 'c6', 'repo', repo);
  assert.deepEqual(r, { ok: true, files: [] });
  assert.deepEqual(readdirSync(dir), ['entry.json']);
  const e = JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8'));
  assert.deepEqual([e.files, e.hashes, e.result, e.reportDir], [[], {}, {}, resolve(missing)]);
}));

test('glob outputs match sorted regular files and skip directories and absent names', () => withBase((base) => {
  const { cfg, repo, reportDir } = setup(base, { 'joern-2.log': 'b', 'joern-1.log': 'a', 'other.txt': 'c' });
  mkdirSync(join(reportDir, 'joern-d.log'));
  const r = store(cfg, { id: 'c7', reuse: { outputs: ['joern-*.log', 'missing.txt'] } }, repo, 'k', {}, reportDir);
  const dir = entryPath(cfg.cache, 'c7', 'repo', repo);
  assert.deepEqual(r, { ok: true, files: ['joern-1.log', 'joern-2.log'] });
  const e = JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8'));
  assert.deepEqual(e.hashes, { 'joern-1.log': sha('a'), 'joern-2.log': sha('b') });
  assert.deepEqual(readdirSync(dir).sort(), ['entry.json', 'joern-1.log', 'joern-2.log']);
}));

test('unsafe characters in the check id and repo name become underscores in the entry path', () => withBase((base) => {
  const { cfg, reportDir } = setup(base, { 'out.log': 'z' });
  const repo = join(base, 'my repo!');
  const r = store(cfg, { id: 'a/b c', reuse: { outputs: ['out.log'] } }, repo, 'k', {}, reportDir);
  const dir = entryPath(cfg.cache, 'a_b_c', 'my_repo_', repo);
  assert.deepEqual(r, { ok: true, files: ['out.log'] });
  const e = JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8'));
  assert.deepEqual([e.check, e.repo], ['a/b c', resolve(repo)]);
}));
