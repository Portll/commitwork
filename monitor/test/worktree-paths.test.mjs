// classify, never drop. These pin the discrimination (what is and is not a copy of this repo) and
// the property the whole shape exists for: a set-aside row stays enumerable and keeps its severity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorktreePath, partition } from '../worktree-paths.mjs';

test('a file inside a named agent worktree is a copy', () => {
  const c = classifyWorktreePath('.claude/worktrees/agent-a7aa848af9652adb0/monitor/timeline2.mjs');
  assert.equal(c.worktree, true);
  assert.equal(c.pattern, '.claude/worktrees');
  assert.equal(c.name, 'agent-a7aa848af9652adb0');
  assert.match(c.why, /checked out again/);
});

test('leading ./ and file:// forms normalise to the same verdict', () => {
  for (const p of ['./.claude/worktrees/wt/a/b.mjs', 'file:///.claude/worktrees/wt/a/b.mjs',
    '.claude\\worktrees\\wt\\a\\b.mjs']) {
    assert.equal(classifyWorktreePath(p).worktree, true, p);
  }
});

// The discriminations that stop this blanking real code.
test('.claude config in the scanned repo is NOT a worktree copy', () => {
  assert.equal(classifyWorktreePath('.claude/settings.json').worktree, false);
  assert.equal(classifyWorktreePath('.claude/hooks/gate.mjs').worktree, false);
});

test('a worktree root with no file beneath a NAMED directory is not classified', () => {
  assert.equal(classifyWorktreePath('.claude/worktrees/agent-x').worktree, false);
  assert.equal(classifyWorktreePath('.claude/worktrees/agent-x/').worktree, false);
  assert.equal(classifyWorktreePath('.claude/worktrees/agent-x/file.mjs').worktree, true);
});

test('the segment must be on a boundary — a lookalike path is not ours', () => {
  assert.equal(classifyWorktreePath('vendor/x.claude/worktrees/wt/a/b.mjs').worktree, false);
  assert.equal(classifyWorktreePath('src/worktrees/wt/a/b.mjs').worktree, false);
});

test('empty and junk input answer false rather than throwing', () => {
  for (const p of ['', null, undefined, '/', './']) assert.equal(classifyWorktreePath(p).worktree, false);
});

test('CW_WORKTREE_PATHS=off makes everything count, read at call time', () => {
  const path = '.claude/worktrees/wt/a/b.mjs';
  assert.equal(classifyWorktreePath(path).worktree, true);
  const prev = process.env.CW_WORKTREE_PATHS;
  process.env.CW_WORKTREE_PATHS = 'off';
  try { assert.equal(classifyWorktreePath(path).worktree, false, 'the override must be read per call'); }
  finally { if (prev === undefined) delete process.env.CW_WORKTREE_PATHS; else process.env.CW_WORKTREE_PATHS = prev; }
  assert.equal(classifyWorktreePath(path).worktree, true, 'and must not latch');
});

test('partition keeps both halves — set aside is recoverable, with severity intact', () => {
  const rows = [
    { file: 'monitor/timeline2.mjs', sev: 'med' },
    { file: '.claude/worktrees/wt-a/monitor/timeline2.mjs', sev: 'med' },
    { file: '.claude/worktrees/wt-b/monitor/timeline2.mjs', sev: 'med' },
    { file: 'admin/index.html', sev: 'high' },
  ];
  const { kept, worktrees, report } = partition(rows);
  assert.equal(kept.length, 2, 'the real tree survives');
  assert.equal(worktrees.length, 2);
  assert.deepEqual(worktrees.map((r) => r.sev), ['med', 'med'], 'a set-aside row keeps its severity');
  assert.deepEqual(worktrees.map((r) => r.worktreeName), ['wt-a', 'wt-b']);
  assert.equal(report.inWorktrees, 2);
  assert.equal(report.total, 4);
  assert.match(report.note, /2 of 4/, 'the fraction is stated, not just the survivors');
});

test('partition on a clean set reports the absence rather than staying silent', () => {
  const { kept, worktrees, report } = partition([{ file: 'a.mjs', sev: 'low' }]);
  assert.equal(kept.length, 1);
  assert.equal(worktrees.length, 0);
  assert.equal(report.inWorktrees, 0);
  assert.match(report.note, /no findings/);
});
