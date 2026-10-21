import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { findGitRepos, walkForRepos, isSkipped, pathSegments } from '../repo-walk.mjs';

// A fixture tree covering every case the `find` invocation this replaced had an opinion about:
// depth, node_modules, a .git FILE (worktree/submodule — excluded by -type d), and a nested repo.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-walk-'));
  const mk = (...p) => { mkdirSync(join(root, ...p), { recursive: true }); };
  const repo = (...p) => { mk(...p, '.git'); writeFileSync(join(root, ...p, '.git', 'HEAD'), 'ref: refs/heads/main\n'); };

  repo('alpha');                                  // depth 1
  repo('beta');                                   // depth 1
  repo('nested', 'inner', 'gamma');               // depth 3
  repo('a', 'b', 'c', 'd', 'deep');               // .git at depth 6 — BEYOND -maxdepth 5
  repo('one', 'two', 'three', 'edge');            // .git at depth 5 — exactly AT the limit
  repo('vendor', 'node_modules', 'pkg');          // pruned
  repo('skipme');                                 // for --skip
  repo('keep', 'skipme');                         // --skip as an interior segment
  mk('plain', 'notarepo');                        // no .git at all
  // a .git FILE, not a directory: a linked worktree or submodule. `find -type d` excluded these
  // and so do we — widening the discovery set is its own change, not a portability side effect.
  mk('worktree');
  writeFileSync(join(root, 'worktree', '.git'), 'gitdir: /elsewhere/.git/worktrees/w\n');
  return root;
}

let ROOT;
test('setup', () => { ROOT = fixture(); });

test('finds repos at every depth up to the bound, and none past it', () => {
  const { repos } = findGitRepos([ROOT]);
  const rel = repos.map((p) => p.slice(ROOT.length + 1).split(sep).join('/')).sort();
  assert.deepEqual(rel, [
    'alpha',
    'beta',
    'keep/skipme',
    'nested/inner/gamma',
    'one/two/three/edge',
    'skipme',
  ], 'the depth-6 repo is excluded and the depth-5 one is included, matching -maxdepth 5');
});

test('node_modules is pruned', () => {
  const { repos } = findGitRepos([ROOT]);
  assert.ok(!repos.some((p) => p.includes('node_modules')), 'a repo under node_modules is never discovered');
});

test('a .git FILE (worktree/submodule) is not a repo — -type d semantics preserved', () => {
  const { repos } = findGitRepos([ROOT]);
  assert.ok(!repos.some((p) => p.endsWith(`${sep}worktree`)), 'discovery-set drift would be a silent fleet change');
});

test('a root that is itself a repo is discovered', () => {
  const { repos } = findGitRepos([join(ROOT, 'alpha')]);
  assert.equal(repos.length, 1);
  assert.equal(repos[0], join(ROOT, 'alpha'));
});

// ── --skip, which never worked on Windows ──────────────────────────────────────────────────────

test('--skip matches a path SEGMENT, at the end or in the middle', () => {
  const { repos } = findGitRepos([ROOT], { skip: ['skipme'] });
  const rel = repos.map((p) => p.slice(ROOT.length + 1).split(sep).join('/'));
  assert.ok(!rel.includes('skipme'), 'trailing segment');
  assert.ok(!rel.includes('keep/skipme'), 'interior segment');
  assert.ok(rel.includes('alpha'), 'unrelated repos survive the skip');
});

test('REGRESSION — skip matching is separator-aware, so it works on Windows paths', () => {
  // The predicate this replaced was `p.includes('/' + s + '/') || p.endsWith('/' + s)`, tested
  // against a path that uses `\` on Windows. `--skip` therefore matched NOTHING there — silently,
  // because a skip that does not skip just looks like a bigger fleet.
  assert.equal(isSkipped('C:\\Repositories\\Portll\\reference\\x', ['reference']), true);
  assert.equal(isSkipped('C:\\Repositories\\Portll\\reference', ['reference']), true);
  assert.equal(isSkipped('/work/Portll/reference/x', ['reference']), true);
  assert.equal(isSkipped('/work/Portll/reference', ['reference']), true);
  // NEGATIVE: a substring is not a segment. `refs` must not be skipped by `ref`.
  assert.equal(isSkipped('C:\\Repositories\\references\\x', ['reference']), false);
  assert.equal(isSkipped('C:\\Repositories\\my-reference-lib', ['reference']), false);
  assert.equal(isSkipped('C:\\Repositories\\x', []), false);
  assert.deepEqual(pathSegments('C:\\a\\b//c'), ['C:', 'a', 'b', 'c']);
});

// ── fail closed ────────────────────────────────────────────────────────────────────────────────

test('a missing root is REPORTED, not silently dropped', () => {
  const r = findGitRepos([join(ROOT, 'does-not-exist')]);
  assert.deepEqual(r.repos, []);
  assert.equal(r.missingRoots.length, 1);
});

test('an unreadable subtree is an ERROR, never a shorter list presented as complete', () => {
  // Injected rather than chmod'd: EACCES is not reproducible as a non-admin user on Windows,
  // and the property under test is the handling, not the OS.
  const boom = new Error('denied'); boom.code = 'EACCES';
  let first = true;
  const r = walkForRepos(ROOT, {
    fs: { readdirSync: (d, o) => { if (first) { first = false; throw boom; } return readdirSync(d, o); } },
  });
  assert.equal(r.repos.length, 0);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, 'EACCES', 'the code is preserved so the caller can tell EACCES from ENOENT');
});

test('determinism — repeated runs return byte-identical, sorted output', () => {
  const a = findGitRepos([ROOT], { skip: ['skipme'] }).repos;
  const b = findGitRepos([ROOT], { skip: ['skipme'] }).repos;
  assert.deepEqual(a, b);
  assert.deepEqual(a, [...a].sort(), 'sorted, so a downstream diff reflects the fleet and not the walk order');
});

test('duplicate roots and overlapping roots do not duplicate a repo', () => {
  const r = findGitRepos([ROOT, ROOT, join(ROOT, 'nested')]);
  assert.equal(new Set(r.repos).size, r.repos.length, 'the result is a set');
});

// ── SECOND WITNESS ─────────────────────────────────────────────────────────────────────────────
// The walker is cross-checked against the program it replaced, on the same tree, wherever a real
// GNU find exists (Git for Windows ships one at usr\bin\find.exe). This cannot share a failure
// mode with the walker: it is a different implementation by different authors. A walker that is
// merely self-consistent has no floor.

function gnuFind() {
  for (const cand of ['find', 'C:\\Program Files\\Git\\usr\\bin\\find.exe', '/usr/bin/find']) {
    const r = spawnSync(cand, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /GNU findutils/i.test(r.stdout || '')) return cand;
  }
  return null;
}

test('EQUIVALENCE — the Node walk matches GNU find on the same tree', (t) => {
  const find = gnuFind();
  if (!find) { t.skip('no GNU findutils on this box (it is an optional install — that is the point)'); return; }
  const r = spawnSync(find, [ROOT, '-maxdepth', '5', '-type', 'd', '-name', '.git', '-not', '-path', '*/node_modules/*'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `GNU find failed: ${r.stderr}`);
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/\.git$/, '').toLowerCase();
  const fromFind = new Set((r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).map(norm));
  const fromWalk = new Set(findGitRepos([ROOT]).repos.map((p) => norm(p.replace(/\\/g, '/'))));
  // Asserted in BOTH directions, separately: only one of them is the direction that lies to you.
  const missed = [...fromFind].filter((p) => !fromWalk.has(p));
  const invented = [...fromWalk].filter((p) => !fromFind.has(p));
  assert.deepEqual(missed, [], 'FALSE NEGATIVES — repos GNU find sees that the walker does not');
  assert.deepEqual(invented, [], 'FALSE POSITIVES — repos the walker reports that GNU find does not');
  assert.ok(fromFind.size >= 6, `the fixture must actually exercise this: ${fromFind.size} repos`);
});

// ── the defect that started this ───────────────────────────────────────────────────────────────

test('REGRESSION — discovery does not depend on a `find` on PATH', (t) => {
  if (process.platform !== 'win32') { t.skip('the wrong-find case is Windows-specific'); return; }
  // On Windows, `find` on PATH is C:\WINDOWS\system32\find.exe — a TEXT SEARCH tool. It rejects
  // the findutils operands and exits non-zero with empty stdout, and the old code read only
  // stdout. Proven here rather than asserted: this is why the fleet went quiet, not ENOENT.
  const r = spawnSync('find', [ROOT, '-maxdepth', '5', '-type', 'd', '-name', '.git'], { encoding: 'utf8' });
  const isTextFind = r.status !== 0 && !(r.stdout || '').trim();
  if (!isTextFind) { t.skip('a GNU find is first on PATH in this shell — the stock-PowerShell case is covered above'); return; }
  // and the walker is unaffected by that being the case
  assert.ok(findGitRepos([ROOT]).repos.length >= 6, 'the walker needs no external find at all');
});

test('cleanup', () => { if (ROOT && existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true }); });
