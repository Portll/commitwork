// node --test monitor/test/ — the roots walk must not enlist a linked worktree of this checkout.
//
// `selfRoot` excluded the checkout by PATH, which covers one directory and nothing else. A
// `git worktree add ../commitwork-comments` puts a second full copy of every tracked file beside
// it, and that copy resolved as its own project belonging to no area: registry-coverage.test.mjs
// went red on both assertions with no commit to blame, because the cause was on disk. Measured
// 2026-09-06.
//
// BOTH DIRECTIONS, because only one of them lies to you. A skip that also swallowed a real sibling
// would hide a repo that should have been declared, which is the failure this walk exists to
// prevent — and it would look exactly like success.
//
// A linked worktree of ANOTHER checkout is skipped only when that checkout is itself a repository
// under the same root: it is that repo on another branch, and the repo is the subject the fleet
// declares. A worktree whose owner the walk cannot see stays visible, so nothing that should have
// been declared can vanish behind the rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRepos } from '../discover.mjs';

/** A tree with one self-worktree, one foreign worktree, one plain repo and one clone of self. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-discover-'));
  const self = join(root, 'self');
  mkdirSync(join(self, '.git', 'worktrees', 'self-comments'), { recursive: true });

  const mk = (name, gitdir) => {
    const dir = join(root, name);
    mkdirSync(dir);
    if (gitdir === null) mkdirSync(join(dir, '.git'));      // a repo in its own right
    else writeFileSync(join(dir, '.git'), `gitdir: ${gitdir}\n`);
    return dir;
  };

  return {
    root,
    self,
    ours: mk('self-comments', join(self, '.git', 'worktrees', 'self-comments')),
    foreign: mk('other-wt', join(root, 'elsewhere', '.git', 'worktrees', 'x')),   // owner is not a repo the walk can see
    plain: mk('plain-repo', null),
    owned: mk('plain-wt', join(root, 'plain-repo', '.git', 'worktrees', 'plain-wt')),   // a branch of plain-repo
    clone: mk('self-clone', null),                          // a CLONE of self is a separate subject
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const namesIn = (root, self) => {
  const reg = { roots: [{ path: root, maxDepth: 1 }] };
  const out = resolveRepos(reg, { selfRoot: self });
  return { names: out.repos.map((r) => r.name).sort(), notes: out.notes };
};

test('a linked worktree of THIS checkout is not a project, and every real sibling still is', (t) => {
  const f = fixture();
  try {
    const { names, notes } = namesIn(f.root, f.self);

    assert.ok(!names.includes('self-comments'),
      `a worktree of this checkout resolved as its own project: ${names.join(', ')}`);

    // The three that must survive. A worktree whose owner the walk cannot see is a genuine
    // sibling; a `.git` DIRECTORY is a repository with its own history, including a clone of this one.
    for (const keep of ['other-wt', 'plain-repo', 'self-clone']) {
      assert.ok(names.includes(keep), `${keep} must still resolve — it is not this checkout`);
    }
    // A worktree of a repo the walk DOES see is that repo on another branch, and is not a project.
    assert.ok(!names.includes('plain-wt'),
      `a worktree of plain-repo resolved as its own project: ${names.join(', ')}`);

    // Skipped LOUDLY. A silent skip is how a repo that should have been declared disappears.
    assert.ok(notes.some((n) => n.includes('linked worktree of this checkout') && n.includes('self-comments')),
      `the skip must be announced in notes; got: ${JSON.stringify(notes)}`);
    assert.ok(notes.some((n) => n.includes('linked worktree of') && n.includes('plain-repo') && n.includes('plain-wt')),
      `the owner must be named in the skip; got: ${JSON.stringify(notes)}`);
    t.diagnostic(`resolved: ${names.join(', ')}`);
  } finally {
    f.cleanup();
  }
});

test('without a selfRoot the self rule cannot fire — the owner rule still names what it skipped', () => {
  const f = fixture();
  try {
    const { names, notes } = namesIn(f.root, null);
    assert.ok(!notes.some((n) => n.includes('linked worktree of this checkout')),
      'with no selfRoot there is nothing to call "this checkout", so it must not claim that skip');
    // The owner rule needs no selfRoot. `self` is an ordinary repo under the root here, so its
    // worktree is skipped as a branch of it, and so is plain-repo's.
    for (const [wt, owner] of [['self-comments', 'self'], ['plain-wt', 'plain-repo']]) {
      assert.ok(!names.includes(wt), `${wt} is a branch of ${owner}, which the walk sees`);
      assert.ok(notes.some((n) => n.includes('linked worktree of') && n.includes(owner) && n.includes(wt)),
        `the skip of ${wt} must name ${owner}; got: ${JSON.stringify(notes)}`);
    }
    assert.ok(names.includes('self') && names.includes('other-wt'), 'the owner itself and the unowned worktree still resolve');
  } finally {
    f.cleanup();
  }
});

test('a .git file that is not a gitdir pointer is left alone rather than guessed at', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-discover-'));
  try {
    const self = join(root, 'self');
    mkdirSync(join(self, '.git'), { recursive: true });
    const odd = join(root, 'odd-repo');
    mkdirSync(odd);
    writeFileSync(join(odd, '.git'), 'this is not a gitdir line\n');

    const { names } = namesIn(root, self);
    assert.ok(names.includes('odd-repo'),
      'an unparseable .git file is not evidence of anything — it must not be skipped');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
