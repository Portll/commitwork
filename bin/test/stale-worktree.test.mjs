// stale-worktree must distinguish a STALE copy from an ordinary deletion. A detector that fired on
// every removed line would be muted inside a day, so both directions are asserted here: a worktree
// missing content from HEAD's own last write is reported, and a worktree that deliberately removes
// older content is NOT.
//
// Built on a scratch git repo per test — no fixtures, no dependence on the shared tree's state,
// and the commits are real ones so the signal is measured rather than mocked.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../stale-worktree.mjs', import.meta.url));

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'stale-wt-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  return { dir, g };
}
const run = (dir) => {
  try {
    return { code: 0, out: execFileSync('node', [TOOL, '--json'], { cwd: dir, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: e.stdout || '' };
  }
};

describe('stale-worktree', () => {
  test('a worktree copy predating HEAD\'s last write is reported, with the line count it would delete', () => {
    const { dir, g } = repo();
    try {
      writeFileSync(join(dir, 'f.md'), 'base line one\n');
      g('add', 'f.md'); g('commit', '-qm', 'base');
      // A blob land: HEAD gains content the worktree never sees.
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: 'base line one\nA LANDED LINE THAT THE WORKTREE NEVER RECEIVED\n', encoding: 'utf8' }).trim();
      g('update-index', '--add', '--cacheinfo', `100644,${blob},f.md`);
      g('commit', '-qm', 'landed by blob, worktree untouched');
      g('read-tree', 'HEAD'); // restore the index; the worktree file is still the old one

      const { code, out } = run(dir);
      const j = JSON.parse(out);
      assert.equal(code, 1, 'a stale path must exit 1');
      assert.equal(j.stale.length, 1);
      assert.equal(j.stale[0].path, 'f.md');
      // The measure is lines HEAD's last write added that the worktree lacks — NOT the raw
      // deletion column (which counts a replaced line twice) and NOT net shrink (which calls a
      // file safe when a peer replaces landed content with an equal amount of their own).
      assert.ok(j.stale[0].missing >= 1, 'it must state how many LANDED lines the copy is missing');
      assert.ok('net' in j.stale[0] && 'del' in j.stale[0], 'raw and net stay available as labelled context');
      assert.match(j.stale[0].sample, /NEVER RECEIVED/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('an ORDINARY deletion is not reported — the control that keeps this from becoming wallpaper', () => {
    const { dir, g } = repo();
    try {
      writeFileSync(join(dir, 'f.md'), 'keep me\nAN OLD LINE THAT IS BEING DELETED ON PURPOSE\n');
      g('add', 'f.md'); g('commit', '-qm', 'base');
      writeFileSync(join(dir, 'f.md'), 'keep me\nplus something new and long enough to fingerprint\n');
      g('add', 'f.md'); g('commit', '-qm', 'second');
      // Now delete a line deliberately. The worktree HAS everything HEAD's last commit added.
      writeFileSync(join(dir, 'f.md'), 'plus something new and long enough to fingerprint\n');

      const { code, out } = run(dir);
      const j = JSON.parse(out);
      assert.equal(code, 0, 'a deliberate deletion must NOT be flagged');
      assert.equal(j.stale.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a clean tree reports nothing and exits 0', () => {
    const { dir, g } = repo();
    try {
      writeFileSync(join(dir, 'f.md'), 'only line\n');
      g('add', 'f.md'); g('commit', '-qm', 'base');
      const { code, out } = run(dir);
      assert.equal(code, 0);
      assert.equal(JSON.parse(out).stale.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('short added lines do not count as fingerprints — they collide and would prove nothing', () => {
    const { dir, g } = repo();
    try {
      writeFileSync(join(dir, 'f.md'), 'a\n');
      g('add', 'f.md'); g('commit', '-qm', 'base');
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: 'a\nb\n', encoding: 'utf8' }).trim();
      g('update-index', '--add', '--cacheinfo', `100644,${blob},f.md`);
      g('commit', '-qm', 'adds only a one-char line');
      g('read-tree', 'HEAD');
      const { code } = run(dir);
      assert.equal(code, 0, 'a one-character addition is not evidence of staleness');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
