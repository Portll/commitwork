// Splits findings into kept rows and worktree rows with per-pattern and per-name counts (monitor/worktree-paths.mjs partition).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partition } from '../worktree-paths.mjs';

test('keeps a row whose file path is not a worktree path', () => {
  const rows = [{ file: 'src/main.c', severity: 'high' }];
  const r = partition(rows);
  assert.deepEqual(r, { kept: [{ file: "src/main.c", severity: "high" }], worktrees: [], report: { enabled: true, total: 1, inWorktrees: 0, byPattern: {}, byName: {}, note: "no findings under an agent worktree path" } });
});

test('moves a row with only a path property into worktrees when it matches a worktree root', () => {
  const rows = [{ path: '.claude/worktrees/alpha/src/x.c', severity: 'low' }];
  const r = partition(rows);
  assert.deepEqual(r, { kept: [], worktrees: [{ path: ".claude/worktrees/alpha/src/x.c", severity: "low", worktree: true, worktreePattern: ".claude/worktrees", worktreeName: "alpha" }], report: { enabled: true, total: 1, inWorktrees: 1, byPattern: { ".claude/worktrees": 1 }, byName: { alpha: 1 }, note: "1 of 1 findings describe a copy of this repository under an agent worktree and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries worktree: true with the pattern that matched. Set CW_WORKTREE_PATHS=off to count them." } });
});

test('moves a row with only a uri property into worktrees when it matches a worktree root', () => {
  const rows = [{ uri: '.git/worktrees/beta/src/y.c', severity: 'med' }];
  const r = partition(rows);
  assert.deepEqual(r, { kept: [], worktrees: [{ uri: ".git/worktrees/beta/src/y.c", severity: "med", worktree: true, worktreePattern: ".git/worktrees", worktreeName: "beta" }], report: { enabled: true, total: 1, inWorktrees: 1, byPattern: { ".git/worktrees": 1 }, byName: { beta: 1 }, note: "1 of 1 findings describe a copy of this repository under an agent worktree and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries worktree: true with the pattern that matched. Set CW_WORKTREE_PATHS=off to count them." } });
});

test('keeps a row whose file property is empty so the path property is used', () => {
  const rows = [{ file: '', path: 'src/ok.c', severity: 'low' }];
  const r = partition(rows);
  assert.deepEqual(r, { kept: [{ file: "", path: "src/ok.c", severity: "low" }], worktrees: [], report: { enabled: true, total: 1, inWorktrees: 0, byPattern: {}, byName: {}, note: "no findings under an agent worktree path" } });
});

test('keeps a row whose path property is empty so the uri property is used', () => {
  const rows = [{ file: 'a.c', path: '', uri: 'src/ok.c', severity: 'low' }];
  const r = partition(rows);
  assert.deepEqual(r, { kept: [{ file: "a.c", path: "", uri: "src/ok.c", severity: "low" }], worktrees: [], report: { enabled: true, total: 1, inWorktrees: 0, byPattern: {}, byName: {}, note: "no findings under an agent worktree path" } });
});

test('keeps a row whose uri property is empty and no other property is set', () => {
  const rows = [{ file: 'a.c', path: 'b.c', uri: '', severity: 'low' }];
  const r = partition(rows);
  assert.deepEqual(r, { kept: [{ file: "a.c", path: "b.c", uri: "", severity: "low" }], worktrees: [], report: { enabled: true, total: 1, inWorktrees: 0, byPattern: {}, byName: {}, note: "no findings under an agent worktree path" } });
});

test('counts each worktree pattern and name exactly once per matching row', () => {
  const rows = [
    { file: '.claude/worktrees/alpha/src/a.c', severity: 'high' },
    { file: '.claude/worktrees/alpha/src/b.c', severity: 'low' },
    { file: '.git/worktrees/beta/src/c.c', severity: 'med' },
    { file: 'src/main.c', severity: 'high' },
  ];
  const r = partition(rows);
  assert.deepEqual(r, { kept: [{ file: "src/main.c", severity: "high" }], worktrees: [{ file: ".claude/worktrees/alpha/src/a.c", severity: "high", worktree: true, worktreePattern: ".claude/worktrees", worktreeName: "alpha" }, { file: ".claude/worktrees/alpha/src/b.c", severity: "low", worktree: true, worktreePattern: ".claude/worktrees", worktreeName: "alpha" }, { file: ".git/worktrees/beta/src/c.c", severity: "med", worktree: true, worktreePattern: ".git/worktrees", worktreeName: "beta" }], report: { enabled: true, total: 4, inWorktrees: 3, byPattern: { ".claude/worktrees": 2, ".git/worktrees": 1 }, byName: { alpha: 2, beta: 1 }, note: "3 of 4 findings describe a copy of this repository under an agent worktree and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries worktree: true with the pattern that matched. Set CW_WORKTREE_PATHS=off to count them." } });
});

test('returns empty kept and worktrees arrays with zero totals for an empty rows array', () => {
  const r = partition([]);
  assert.deepEqual(r, { kept: [], worktrees: [], report: { enabled: true, total: 0, inWorktrees: 0, byPattern: {}, byName: {}, note: "no findings under an agent worktree path" } });
});

test('returns empty kept and worktrees arrays with zero totals when rows is null', () => {
  const r = partition(null);
  assert.deepEqual(r, { kept: [], worktrees: [], report: { enabled: true, total: 0, inWorktrees: 0, byPattern: {}, byName: {}, note: "no findings under an agent worktree path" } });
});

test('uses a custom pathOf function to classify rows', () => {
  const rows = [{ custom: '.claude/worktrees/gamma/src/z.c', severity: 'low' }];
  const r = partition(rows, (row) => row.custom);
  assert.deepEqual(r, { kept: [], worktrees: [{ custom: ".claude/worktrees/gamma/src/z.c", severity: "low", worktree: true, worktreePattern: ".claude/worktrees", worktreeName: "gamma" }], report: { enabled: true, total: 1, inWorktrees: 1, byPattern: { ".claude/worktrees": 1 }, byName: { gamma: 1 }, note: "1 of 1 findings describe a copy of this repository under an agent worktree and are excluded from headline totals. They are NOT discarded: each keeps its severity and carries worktree: true with the pattern that matched. Set CW_WORKTREE_PATHS=off to count them." } });
});
