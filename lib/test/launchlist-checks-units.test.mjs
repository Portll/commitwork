// lib/test/launchlist-checks-units.test.mjs — case tests for githubSlug, repoFacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubSlug, repoFacts } from '../launchlist-checks.mjs';
import { gitChildEnv } from '../../bin/lib/git-env.mjs';

// Inside a hook git exports GIT_DIR, and every `git -C <tmp>` here, repoFacts' own included, would
// then act on the hooked repository: these tests commit.
process.env = gitChildEnv();

test('returns cfg.github when present', () => {
  const ctx = { cfg: { github: 'owner/repo' }, repo: '/nonexistent' };
  assert.equal(githubSlug(ctx), 'owner/repo');
});

test('returns null when cfg.github is empty and git fails', () => {
  const ctx = { cfg: { github: '' }, repo: '/nonexistent' };
  assert.equal(githubSlug(ctx), null);
});

test('returns null when cfg.github is undefined and git fails', () => {
  const ctx = { cfg: {}, repo: '/nonexistent' };
  assert.equal(githubSlug(ctx), null);
});

test('repoFacts returns head sha and branch name for a normal repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-'));
  try {
    execFileSync('git', ['init', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.t']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
    execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'init']);
    const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const facts = repoFacts(dir);
    assert.equal(facts.head, head);
    assert.equal(facts.branch, 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repoFacts returns null branch when HEAD is detached', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-'));
  try {
    execFileSync('git', ['init', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.t']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
    execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'init']);
    const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', dir, 'checkout', '--detach', head]);
    const facts = repoFacts(dir);
    assert.equal(facts.head, head);
    assert.equal(facts.branch, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repoFacts returns the correct head sha after a second commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-'));
  try {
    execFileSync('git', ['init', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.t']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
    execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'one']);
    execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'two']);
    const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const facts = repoFacts(dir);
    assert.equal(facts.head, head);
    assert.equal(facts.branch, 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repoFacts throws when the path is not a git repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-'));
  try {
    assert.throws(() => repoFacts(dir), /fatal/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
