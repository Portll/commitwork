// End-to-end against real git, in a scratch repo. The core tests prove the branch matrix; these
// prove the thing that matters — that the sequence in bin/commit-phase.mjs actually holds against
// a concurrent writer, and that the harm it refuses is a REAL harm rather than a hypothesis.
//
// The second half is the point. Asserting "the guard fired" only proves the guard fired; it cannot
// tell you the guard was needed. So the stale case is run TWICE: once through commit-phase (which
// must refuse) and once by hand doing exactly what the export-half-alone implementation would do
// (which must silently revert the co-session). Two witnesses that cannot share a failure mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commit-phase.mjs');
// Every commit stamps package.json from its parent's (bin/test/commit-phase-version.test.mjs), so
// every fixture carries one.
const PKG = '{\n  "name": "fixture",\n  "version": "0.1.0",\n  "private": true\n}\n';

const g = (cwd, args, env = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();

/** Run the CLI; never throws — returns {code, out, err} so a refusal is data, not an exception.
 *  stderr is kept on exit 0 too: a warning on a successful land is an outcome a test asserts. */
function cli(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CW_COMMIT_REPO: cwd,
    // CW_TOUCH_LEDGER IS SET HERE, at the helper, not in each test. commit-phase records what it
    // lands (H1), so without this every run of this file appended rows for `mine.txt` under a
    // scratch tree-id to the REAL .claude/store/touches.jsonl — 84 of them per suite run,
    // measured 2026-08-30. They were harmless to readers (each carries a foreign `r`) and
    // harmful anyway: they pushed the live ledger past its 2 MB rotation threshold, and a
    // rotation racing a gate read made bin/gate-spine.mjs report "did this session edit
    // anything" as UNKNOWN. A hermetic default belongs where no test can forget it.
    CW_TOUCH_LEDGER: join(cwd, '.cw-test-touches.jsonl'),
    // Signing is OFF for this file, deliberately. commit-phase signs by default and refuses to
    // land when it cannot, so without this every test here would depend on one private key being
    // present and unlocked — green on the box that owns it, red on a fresh clone and on the
    // Linux container, for reasons that have nothing to do with what these tests assert.
    // Signing has its own file: bin/test/commit-phase-signing.test.mjs, which builds a throwaway
    // key per scratch repo and asserts the effect in both directions.
    CW_ALLOW_UNSIGNED: '1',
      ...env,
    },
  });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-commit-phase-'));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 'test@example.invalid']);
  g(dir, ['config', 'user.name', 'test']);
  writeFileSync(join(dir, 'mine.txt'), 'base\n');
  writeFileSync(join(dir, 'theirs.txt'), 'their original\n');
  writeFileSync(join(dir, 'package.json'), PKG);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-m', 'test: base']);
  return dir;
}

test('a clean land works, and the sha it prints is the sha that landed', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const r = cli(dir, ['-m', 'test: write my commit', '--', 'mine.txt'], { CW_COMMIT_SESSION: 'cw44' });

  assert.equal(r.code, 0, r.err);
  const sha = r.out.split('\n')[0].trim();
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(g(dir, ['rev-parse', 'HEAD']), sha, 'printed sha must BE head — the ledger depends on it');
  assert.equal(g(dir, ['show', '-s', '--format=%s', 'HEAD']), 'test: write my commit');
  assert.equal(g(dir, ['show', 'HEAD:mine.txt']), 'my work');
});

test('the commit carries ONLY the declared path, with an undeclared dirty file beside it', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  writeFileSync(join(dir, 'theirs.txt'), 'ANOTHER SESSION MID-EDIT\n');   // never declared
  const r = cli(dir, ['-m', 'test: commit only mine', '--', 'mine.txt'], { CW_COMMIT_SESSION: 'cw44' });

  assert.equal(r.code, 0, r.err);
  const touched = g(dir, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
  assert.deepEqual(touched, ['mine.txt', 'package.json'], 'the declared path and the version stamp, nothing else');
  assert.equal(g(dir, ['show', 'HEAD:theirs.txt']), 'their original', 'undeclared work must not be swept in');
  assert.equal(readFileSync(join(dir, 'theirs.txt'), 'utf8'), 'ANOTHER SESSION MID-EDIT\n', 'nor touched on disk');
});

test('a foreign SHARED-index staging is not carried — the defect R1 exists to close', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Another session stages into the shared index a moment before we commit. A pathspec-less
  // `git commit` would carry it; commit-phase reads its own index and cannot see it.
  writeFileSync(join(dir, 'theirs.txt'), 'their staged work\n');
  g(dir, ['add', 'theirs.txt']);
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');

  const r = cli(dir, ['-m', 'test: commit mine only', '--', 'mine.txt'], { CW_COMMIT_SESSION: 'cw44' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(g(dir, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean), ['mine.txt', 'package.json']);
  assert.equal(g(dir, ['show', 'HEAD:theirs.txt']), 'their original');
});

test('THE STALE-INDEX FIXTURE: HEAD moves after the read-tree, and the land is REFUSED', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Build a private index from HEAD, exactly as commit-phase step 2 does...
  const idx = join(dir, '.git', 'index.cw44');
  const head0 = g(dir, ['rev-parse', 'HEAD']);
  g(dir, ['read-tree', head0], { GIT_INDEX_FILE: idx });
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  g(dir, ['add', '--', 'mine.txt'], { GIT_INDEX_FILE: idx });

  // ...then a co-session lands a commit, moving HEAD out from under it.
  writeFileSync(join(dir, 'theirs.txt'), 'THEIR LANDED WORK\n');
  g(dir, ['add', 'theirs.txt']);
  g(dir, ['commit', '-m', 'test: write their commit']);
  const headTheirs = g(dir, ['rev-parse', 'HEAD']);
  assert.notEqual(headTheirs, head0);

  // Now run a land whose second HEAD read reports the OLD head — i.e. the index it is about to
  // write was built before their commit. That is precisely the stale-index condition.
  const r = cli(dir, ['-m', 'test: write a stale commit', '--', 'mine.txt'],
    { CW_COMMIT_SESSION: 'cw44', CW_COMMIT_TEST_HEAD_NOW: head0 });

  assert.equal(r.code, 2, `expected refusal, got ${r.code}: ${r.out}${r.err}`);
  assert.match(r.err, /STALE-INDEX/);
  assert.match(r.err, /revert/);
  // The invariant, checked against the repo rather than the message: HEAD did not move, and their
  // landed work is intact.
  assert.equal(g(dir, ['rev-parse', 'HEAD']), headTheirs, 'a refused land must not move HEAD');
  assert.equal(g(dir, ['show', 'HEAD:theirs.txt']), 'THEIR LANDED WORK\n'.trim(),
    'a stale land must never revert the co-session');
  assert.ok(!existsSync(join(dir, '.git', 'index.cw44')), 'and must leave no index a later run could reuse');
});

test('THE SECOND WITNESS: the export half ALONE really does revert the co-session', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // This is the harm, performed rather than asserted. It is what R1's register entry means by
  // "a private index built from an older HEAD carries the old blob for everything", and it is why
  // the refusal above is not ceremony. If this test ever stops reverting, the guard is obsolete
  // and should be re-argued — not quietly kept.
  const idx = join(dir, '.git', 'index.stale');
  const head0 = g(dir, ['rev-parse', 'HEAD']);
  g(dir, ['read-tree', head0], { GIT_INDEX_FILE: idx });
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  g(dir, ['add', '--', 'mine.txt'], { GIT_INDEX_FILE: idx });

  writeFileSync(join(dir, 'theirs.txt'), 'THEIR LANDED WORK\n');
  g(dir, ['add', 'theirs.txt']);
  g(dir, ['commit', '-m', 'test: write their commit']);

  // No CAS, no re-read — the naive implementation.
  const tree = g(dir, ['write-tree'], { GIT_INDEX_FILE: idx });
  const c = g(dir, ['commit-tree', tree, '-p', g(dir, ['rev-parse', 'HEAD']), '-m', 'test: commit naively'], { GIT_INDEX_FILE: idx });
  g(dir, ['update-ref', 'refs/heads/main', c]);

  assert.equal(g(dir, ['show', 'HEAD:mine.txt']), 'my work', 'the naive commit does land my work');
  assert.equal(g(dir, ['show', 'HEAD:theirs.txt']), 'their original',
    'AND it silently reverted the co-session — this is the harm the guard refuses');
  // The diff of the naive commit looks clean for the author's own path, which is what makes it
  // survive review: the revert is only visible against the parent nobody reads.
});

test('the CAS refuses when the ref moves between build and install, and lands nothing', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const head0 = g(dir, ['rev-parse', 'HEAD']);
  const idx = join(dir, '.git', 'index.cw44');
  g(dir, ['read-tree', head0], { GIT_INDEX_FILE: idx });
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  g(dir, ['add', '--', 'mine.txt'], { GIT_INDEX_FILE: idx });
  const tree = g(dir, ['write-tree'], { GIT_INDEX_FILE: idx });
  const c = g(dir, ['commit-tree', tree, '-p', head0, '-m', 'test: commit mine'], { GIT_INDEX_FILE: idx });

  writeFileSync(join(dir, 'theirs.txt'), 'THEIR LANDED WORK\n');
  g(dir, ['add', 'theirs.txt']);
  g(dir, ['commit', '-m', 'test: write their commit']);
  const headTheirs = g(dir, ['rev-parse', 'HEAD']);

  let threw = false;
  try { g(dir, ['update-ref', 'refs/heads/main', c, head0]); } catch { threw = true; }
  assert.ok(threw, 'update-ref with an old-value must fail once the ref has moved');
  assert.equal(g(dir, ['rev-parse', 'HEAD']), headTheirs, 'and it must leave the ref exactly where it was');
  assert.equal(g(dir, ['show', 'HEAD:theirs.txt']), 'THEIR LANDED WORK\n'.trim());
});

test('no declaration refuses, and writes no index', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = cli(dir, ['-m', 'test: add x'], { CW_COMMIT_SESSION: 'nodecl' });
  assert.equal(r.code, 2);
  assert.match(r.err, /NO-DECLARATION/);
  assert.equal(g(dir, ['rev-parse', 'HEAD']), g(dir, ['rev-parse', 'HEAD']));
  assert.ok(!existsSync(join(dir, '.git', 'index.nodecl')), 'a refusal must leave no index behind');
});

test('--check writes nothing and does not move HEAD', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const before = g(dir, ['rev-parse', 'HEAD']);
  const r = cli(dir, ['--check', '--', 'mine.txt'], { CW_COMMIT_SESSION: 'cw44' });
  assert.equal(r.code, 0, r.err);
  assert.equal(g(dir, ['rev-parse', 'HEAD']), before);
  assert.match(r.out, /would land/);
});

test('the SHARED index is repaired, so the next session does not read a reverse-staged file', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const r = cli(dir, ['-m', 'test: commit mine', '--', 'mine.txt'], { CW_COMMIT_SESSION: 'cw44' });
  assert.equal(r.code, 0, r.err);
  // The cost docs/TRAPS.md names: without the reset, the shared index still holds the pre-commit
  // blob and `git status` shows a phantom staged change against the new HEAD.
  assert.equal(g(dir, ['diff', '--cached', '--name-only']), '', 'shared index must agree with the new HEAD');
});

test('a shared-index repair that fails is reported, not swallowed', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  // a peer's git holding the shared index lock: the land uses its own index, the repair cannot
  writeFileSync(join(dir, '.git', 'index.lock'), '');
  // spawnSync, not cli(): a land that succeeds exits 0, and the warning is on stderr
  const r = spawnSync(process.execPath, [CLI, '-m', 'test: commit mine', '--', 'mine.txt'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, CW_COMMIT_REPO: dir, CW_TOUCH_LEDGER: join(dir, '.cw-test-touches.jsonl'), CW_ALLOW_UNSIGNED: '1', CW_COMMIT_SESSION: 'cw44' },
  });
  assert.equal(r.status, 0, `the commit itself lands: ${r.stderr}`);
  assert.equal(g(dir, ['show', 'HEAD:mine.txt']), 'my work');
  assert.match(r.stderr, /shared index was NOT repaired for 1 path/);
});


// ── --onto: the push-race replay, as a tool rather than a recipe ──────────────────────────────
// Performed by hand this dropped two things silently, both measured 2026-08-30: the commits were
// written with raw commit-tree so NOTHING reached the touch ledger (gate-tests then read "YOU
// touched 3" for a session that had landed 11 files over four commits), and staging our blob for a
// path the other side also changed would have assigned over their work with no conflict at all.

/** main and `upstream` diverged: we changed `mine.txt`, they changed `shared.txt`. */
function diverged() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-onto-'));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 'test@example.invalid']);
  g(dir, ['config', 'user.name', 'test']);
  writeFileSync(join(dir, 'shared.txt'), 'base\n');
  writeFileSync(join(dir, 'mine.txt'), 'base\n');
  writeFileSync(join(dir, 'doomed.txt'), 'delete me\n');
  writeFileSync(join(dir, 'package.json'), PKG);
  g(dir, ['add', '-A']); g(dir, ['commit', '-m', 'test: base']);
  g(dir, ['branch', 'upstream']);
  writeFileSync(join(dir, 'mine.txt'), 'one\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-m', 'test: add mine one']);
  writeFileSync(join(dir, 'mine.txt'), 'two\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-m', 'test: add mine two']);
  g(dir, ['checkout', '-q', 'upstream']);
  writeFileSync(join(dir, 'shared.txt'), 'theirs\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-m', 'test: add theirs']);
  g(dir, ['checkout', '-q', 'main']);
  return dir;
}

const ledgerRows = (dir) => {
  const p = join(dir, '.cw-test-touches.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('--onto replays a disjoint set, keeping BOTH sides and preserving each commit', (t) => {
  const dir = diverged();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = cli(dir, ['--onto', 'upstream'], { CW_COMMIT_SESSION: 'onto1234' });
  assert.equal(r.code, 0, r.err);

  const log = g(dir, ['log', '--format=%s', 'main']).split('\n');
  assert.deepEqual(log, ['test: add mine two', 'test: add mine one', 'test: add theirs', 'test: base'],
    'both of ours replay ON TOP of theirs, and neither commit is collapsed');
  assert.equal(g(dir, ['show', 'main:shared.txt']), 'theirs', 'their change survived the replay');
  assert.equal(g(dir, ['show', 'main:mine.txt']), 'two', 'ours survived it too');
});

test('--onto RECORDS every commit it writes — the defect that made it a tool', (t) => {
  const dir = diverged();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = cli(dir, ['--onto', 'upstream'], { CW_COMMIT_SESSION: 'onto1234' });
  assert.equal(r.code, 0, r.err);

  const rows = ledgerRows(dir);
  assert.equal(rows.filter((row) => row.f === 'mine.txt').length, 2, 'one row per replayed commit — a hand replay wrote zero');
  assert.equal(rows.filter((row) => row.f === 'package.json').length, 2, 'and one for the version each replayed commit stamps');
  assert.equal(rows.length, 4);
  const shas = new Set(g(dir, ['log', '--format=%H', 'upstream..main']).split('\n'));
  for (const row of rows) {
    assert.equal(row.via, 'commit');
    assert.ok(shas.has(row.sha), 'the row must name the REPLAYED sha, not the pre-replay one');
  }
});

test('--onto REFUSES a path both sides changed, and nothing lands', (t) => {
  const dir = diverged();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Make our side touch shared.txt too, so the sets collide.
  writeFileSync(join(dir, 'shared.txt'), 'ours\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-m', 'test: touch shared from ours']);
  const before = g(dir, ['rev-parse', 'main']);

  const r = cli(dir, ['--onto', 'upstream'], { CW_COMMIT_SESSION: 'onto1234' });
  assert.equal(r.code, 2, 'a collision is a refusal, never a silent assignment');
  assert.match(r.err, /shared\.txt/, 'the refusal must NAME the colliding path');
  assert.equal(g(dir, ['rev-parse', 'main']), before, 'main did not move');
  assert.equal(g(dir, ['show', 'upstream:shared.txt']), 'theirs', 'their blob is untouched');
  assert.equal(ledgerRows(dir).length, 0, 'nothing landed, so nothing is recorded');
});

test('--onto carries a DELETION rather than resurrecting the file', (t) => {
  const dir = diverged();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // ls-tree returns nothing for a removed path. Staging only what it finds would rebuild the tree
  // from the parent WITH doomed.txt still in it — the deletion would vanish and look intentional.
  g(dir, ['rm', '-q', 'doomed.txt']);
  g(dir, ['commit', '-m', 'test: drop doomed.txt']);

  const r = cli(dir, ['--onto', 'upstream'], { CW_COMMIT_SESSION: 'onto1234' });
  assert.equal(r.code, 0, r.err);
  assert.equal(g(dir, ['cat-file', '-t', 'upstream:doomed.txt']), 'blob', 'it existed before the replay');
  const still = cli(dir, ['--check', '--onto', 'upstream']);
  assert.equal(still.code, 0);
  assert.throws(() => g(dir, ['cat-file', '-t', 'main:doomed.txt']),
    'the replayed tree must NOT carry doomed.txt');
});

test('--onto carries a RENAME as a deletion of the old path, not only an add of the new one', (t) => {
  const dir = diverged();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // git show --name-only lists a rename by its NEW path alone, so the old path was never removed
  // from the replayed tree: a renamed file came back beside its new name (measured 2026-10-07 on two
  // manifests renamed to *.self.*).
  g(dir, ['mv', 'doomed.txt', 'kept.txt']);
  g(dir, ['commit', '-m', 'test: rename doomed.txt']);

  const r = cli(dir, ['--onto', 'upstream'], { CW_COMMIT_SESSION: 'onto1234' });
  assert.equal(r.code, 0, r.err);
  assert.equal(g(dir, ['show', 'main:kept.txt']), 'delete me', 'the new path carries the content');
  assert.throws(() => g(dir, ['cat-file', '-t', 'main:doomed.txt']), 'the old path must not survive the replay');
});

test('--onto names the paths this checkout still holds at their pre-replay copy, and changes none', (t) => {
  const dir = diverged();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = cli(dir, ['--onto', 'upstream'], { CW_COMMIT_SESSION: 'onto1234' });
  assert.equal(r.code, 0, r.err);
  assert.equal(g(dir, ['show', 'main:shared.txt']), 'theirs');
  assert.equal(readFileSync(join(dir, 'shared.txt'), 'utf8'), 'base\n', 'the replay reads and writes no working tree');
  assert.match(r.err, /pre-replay copy of 1 path\(s\)[\s\S]*\n  shared\.txt\n/, 'their path, held at the old copy, is named');
  assert.doesNotMatch(r.err, /\n  mine\.txt\n/, 'our own path matches HEAD and is not');
});

test('--onto names nothing once the checkout holds HEAD\'s copy', (t) => {
  const dir = diverged();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'shared.txt'), 'theirs\n');
  const r = cli(dir, ['--onto', 'upstream'], { CW_COMMIT_SESSION: 'onto1234' });
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /pre-replay copy/);
});
