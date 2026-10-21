// Every point in bin/commit-phase.mjs's sequence at which a peer can land, enumerated. The core
// tests pin the verdict function and commit-phase-e2e.test.mjs performs ONE race (HEAD moving
// between the read-tree and the land, with the second HEAD read faked). This file performs all
// of them against real git, by pausing the real CLI after each step (CW_COMMIT_PHASE_PAUSE_AFTER,
// a wait and never a hook) and landing a peer's commit while it waits.
//
// The invariant is the same at every point and is asserted against the repository, not the
// message: a peer's landed work is never reverted, and our commit is never silently lost. Each
// interleaving resolves to exactly one of two outcomes, and the test names which:
//   REFUSED        exit 2, HEAD is the peer's commit, their file intact, nothing of ours on the
//                  ref, no private index left, our edit still in the working tree, a reason on
//                  stderr that is the tool's and not the pause seam's own cap.
//   LANDED-ON-TOP  exit 0, the printed sha is HEAD, its parent is the peer's commit, their file
//                  intact, ours in the tree.
//
// Which guard refuses (the second HEAD read before the verdict, or the update-ref compare-and-swap
// at the land) is a mechanism and is not asserted; it is noted per test so a change shows up as
// a change in the documented behaviour, not as a surprise.
//
// Barrier, not sleep: the child writes `<file>.paused` when it reaches the step and resumes when
// `<file>` exists. Every wait has a hard cap because node --test has no default timeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commit-phase.mjs');
const PKG = '{\n  "name": "fixture",\n  "version": "0.1.0",\n  "private": true\n}\n';
const WAIT_CAP_MS = 20000;
const SESSION = 'cw-ours';
const OUR_MSG = 'test: write our change';

const g = (cwd, args, env = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();

const baseEnv = (dir) => ({
  ...process.env,
  CW_COMMIT_REPO: dir,
  CW_TOUCH_LEDGER: join(dir, '.cw-test-touches.jsonl'),   // hermetic, as commit-phase-e2e explains
  CW_ALLOW_UNSIGNED: '1',                                   // signing has its own file
  CW_COMMIT_SESSION: SESSION,
});

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-interleave-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 'test@example.invalid']);
  g(dir, ['config', 'user.name', 'test']);
  g(dir, ['config', 'commit.gpgsign', 'false']);           // the peer commits with plain git
  writeFileSync(join(dir, 'mine.txt'), 'base\n');
  writeFileSync(join(dir, 'theirs.txt'), 'their original\n');
  writeFileSync(join(dir, 'package.json'), PKG);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-q', '-m', 'test: base']);
  return dir;
}

/** The peer: a plain git commit on the shared index, which is what a second session's land is. */
function peerLands(dir, content, n = '') {
  writeFileSync(join(dir, 'theirs.txt'), content);
  g(dir, ['add', 'theirs.txt']);
  g(dir, ['commit', '-q', '-m', `test: peer lands${n}`]);
  return g(dir, ['rev-parse', 'HEAD']);
}

/** Synchronous run, for the cases with no pause. Never throws. */
function cli(dir, args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...baseEnv(dir), ...env },
  });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start a land that pauses after `step`. Resolves `paused` when the child reaches it, or rejects
 * with the child's output if it exits first (a refusal before the step is a test failure, not a
 * hang). `resume()` lets it continue; `done` is the exit.
 */
function pausedLand(dir, step, args, env = {}) {
  const pauseFile = join(dir, `.pause-${step}`);
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...baseEnv(dir), CW_COMMIT_PHASE_PAUSE_AFTER: step, CW_COMMIT_PHASE_PAUSE_FILE: pauseFile, ...env },
  });
  let out = '';
  let err = '';
  let exited = null;
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res) => child.on('close', (code) => { exited = code ?? 1; res({ code: exited, out, err }); }));
  const paused = (async () => {
    const deadline = Date.now() + WAIT_CAP_MS;
    while (!existsSync(`${pauseFile}.paused`)) {
      if (exited !== null) throw new Error(`child exited ${exited} before pausing after ${step}:\n${out}${err}`);
      if (Date.now() > deadline) { child.kill('SIGKILL'); throw new Error(`child never paused after ${step} within ${WAIT_CAP_MS} ms:\n${out}${err}`); }
      await sleep(10);
    }
    assert.equal(readFileSync(`${pauseFile}.paused`, 'utf8'), `${step}\n`, 'the marker names the step');
  })();
  const resume = () => writeFileSync(pauseFile, '');
  return { paused, resume, done };
}

/** The land was refused and the peer's work is exactly as they left it. */
function assertRefused(dir, r, { peerHead, peerContent }) {
  assert.equal(r.code, 2, `expected a refusal, got exit ${r.code}:\n${r.out}${r.err}`);
  assert.doesNotMatch(r.err, /REFUSED — paused after/, 'the refusal must be the tool\'s, not the pause cap');
  assert.match(r.err, /REFUSED|STALE-INDEX/, 'a refusal says so on stderr — never silent');
  assert.equal(g(dir, ['rev-parse', 'HEAD']), peerHead, 'HEAD is the peer\'s commit');
  assert.equal(g(dir, ['show', 'HEAD:theirs.txt']), peerContent.trim(), 'the peer\'s landed work is intact');
  assert.equal(g(dir, ['show', 'HEAD:mine.txt']), 'base', 'nothing of ours on the ref');
  assert.doesNotMatch(g(dir, ['log', '--format=%s']), new RegExp(OUR_MSG), 'our message is nowhere in history');
  assert.ok(!existsSync(join(dir, '.git', `index.${SESSION}`)), 'no private index a later run could mistake for fresh');
  assert.equal(readFileSync(join(dir, 'mine.txt'), 'utf8'), 'my work\n', 'our edit is still in the working tree to re-land');
}

/** The land succeeded on top of the peer's commit, carrying both sides. */
function assertLandedOnTop(dir, r, { peerHead, peerContent }) {
  assert.equal(r.code, 0, `expected a land, got exit ${r.code}:\n${r.out}${r.err}`);
  const sha = r.out.split('\n')[0].trim();
  assert.match(sha, /^[0-9a-f]{40}$/, 'the sha is printed');
  assert.equal(g(dir, ['rev-parse', 'HEAD']), sha, 'the printed sha is HEAD');
  assert.equal(g(dir, ['rev-parse', 'HEAD^']), peerHead, 'our commit\'s parent is the peer\'s commit');
  assert.equal(g(dir, ['show', 'HEAD:theirs.txt']), peerContent.trim(), 'the peer\'s landed work is intact');
  assert.equal(g(dir, ['show', 'HEAD:mine.txt']), 'my work', 'and ours is in the tree');
  assert.equal(g(dir, ['show', '-s', '--format=%s', 'HEAD']), OUR_MSG);
  // The private index is kept after a land (the tool names it on stdout); only a refusal unlinks it.
}

// One interleaving per test. `step` is the point the peer lands AFTER.
async function interleave(t, step, { twice = false } = {}) {
  const dir = scratch(t);
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const land = pausedLand(dir, step, ['-m', OUR_MSG, '--', 'mine.txt']);
  await land.paused;
  let peerHead = peerLands(dir, 'THEIR LANDED WORK\n');
  let peerContent = 'THEIR LANDED WORK\n';
  if (twice) {
    peerContent = 'THEIR SECOND LANDING\n';
    peerHead = peerLands(dir, peerContent, ' again');
  }
  land.resume();
  const r = await land.done;
  return { dir, r, peerHead, peerContent };
}

// ── the sequence, point by point ──────────────────────────────────────────────────────────────

test('peer lands BEFORE head0 is read: LANDED-ON-TOP, parent is the peer\'s commit', (t) => {
  // Not a race — the baseline every refusal below is measured against. A peer that landed before
  // we started is simply our parent, and the tool must not refuse a sequential land.
  const dir = scratch(t);
  const peerContent = 'THEIR LANDED WORK\n';
  const peerHead = peerLands(dir, peerContent);
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const r = cli(dir, ['-m', OUR_MSG, '--', 'mine.txt']);
  assertLandedOnTop(dir, r, { peerHead, peerContent });
});

test('peer lands after head0, before read-tree: REFUSED', async (t) => {
  // head0 is the old commit; the index is then built from it. Refused at the second HEAD read.
  const { dir, r, ...peer } = await interleave(t, 'head0');
  assertRefused(dir, r, peer);
});

test('peer lands after read-tree, before add: REFUSED', async (t) => {
  // The private index holds the old HEAD's blob for theirs.txt. Refused at the second HEAD read.
  const { dir, r, ...peer } = await interleave(t, 'read-tree');
  assertRefused(dir, r, peer);
});

test('peer lands after add, before the verdict: REFUSED', async (t) => {
  // Content frozen, stale parent. Refused at the second HEAD read, before any tree is written.
  const { dir, r, ...peer } = await interleave(t, 'add');
  assertRefused(dir, r, peer);
});

test('peer lands after the verdict, before write-tree: REFUSED', async (t) => {
  // The second HEAD read has already passed and agreed with head0, so only the compare-and-swap
  // stands between this index and a revert of theirs.txt. It refuses.
  const { dir, r, ...peer } = await interleave(t, 'verdict');
  assertRefused(dir, r, peer);
});

test('peer lands after write-tree, before commit-tree: REFUSED', async (t) => {
  // A tree object exists that would revert them if committed and referenced. The commit is built
  // and the compare-and-swap refuses to reference it.
  const { dir, r, ...peer } = await interleave(t, 'write-tree');
  assertRefused(dir, r, peer);
});

test('peer lands after commit-tree, before update-ref: REFUSED', async (t) => {
  // The narrowest window: a complete commit object with the old parent, one update-ref away from
  // the ref. The compare-and-swap refuses; the object stays unreferenced.
  const { dir, r, ...peer } = await interleave(t, 'commit-tree');
  assertRefused(dir, r, peer);
});

test('peer lands TWICE after commit-tree, before update-ref: REFUSED, HEAD is the second landing', async (t) => {
  // The CAS compares against head0, not against "one commit later"; two moves refuse as one does,
  // and the ref ends where the peer left it, not one landing back.
  const { dir, r, ...peer } = await interleave(t, 'commit-tree', { twice: true });
  assertRefused(dir, r, peer);
  assert.equal(g(dir, ['rev-list', '--count', 'HEAD']), '3', 'base + two peer landings, nothing else');
});

test('peer lands TWICE after read-tree, before add: REFUSED, HEAD is the second landing', async (t) => {
  const { dir, r, ...peer } = await interleave(t, 'read-tree', { twice: true });
  assertRefused(dir, r, peer);
  assert.equal(g(dir, ['rev-list', '--count', 'HEAD']), '3');
});

// ── the empty change set, through real git rather than the verdict function ───────────────────

test('an empty change set is refused as nothing-staged (exit 1), and no commit is written', (t) => {
  const dir = scratch(t);
  const head = g(dir, ['rev-parse', 'HEAD']);
  const r = cli(dir, ['-m', OUR_MSG, '--', 'mine.txt']);          // mine.txt equals HEAD's
  assert.equal(r.code, 1, `${r.out}${r.err}`);
  assert.match(r.err, /NOTHING-STAGED/);
  assert.equal(g(dir, ['rev-parse', 'HEAD']), head, 'HEAD did not move');
  assert.equal(g(dir, ['rev-list', '--count', 'HEAD']), '1', 'no empty commit was created');
  assert.ok(!existsSync(join(dir, '.git', `index.${SESSION}`)));
});

test('peer lands the SAME BYTES we hold: refused as nothing-staged, never an empty commit on top', (t) => {
  // Both sessions arrived at the same content. Against the peer's commit our file is no change,
  // and a commit carrying only a version stamp would be a commit of nothing.
  const dir = scratch(t);
  const peerHead = (() => {
    writeFileSync(join(dir, 'mine.txt'), 'same bytes\n');
    g(dir, ['add', 'mine.txt']);
    g(dir, ['commit', '-q', '-m', 'test: peer lands mine.txt']);
    return g(dir, ['rev-parse', 'HEAD']);
  })();
  writeFileSync(join(dir, 'mine.txt'), 'same bytes\n');          // ours, byte for byte theirs
  const r = cli(dir, ['-m', OUR_MSG, '--', 'mine.txt']);
  assert.equal(r.code, 1, `${r.out}${r.err}`);
  assert.match(r.err, /NOTHING-STAGED/);
  assert.match(r.err, /M27 — mine\.txt is byte-identical to HEAD/, 'and the unchanged path is named');
  assert.equal(g(dir, ['rev-parse', 'HEAD']), peerHead, 'HEAD is still the peer\'s commit');
  assert.equal(g(dir, ['rev-list', '--count', 'HEAD']), '2', 'base + the peer\'s; no empty commit of ours');
  assert.equal(g(dir, ['show', 'HEAD:package.json']), PKG.trim(), 'no stamp-only commit changed the version');
});

// ── the seam itself fails closed, and is inert by default ─────────────────────────────────────

test('the pause seam is inert when CW_COMMIT_PHASE_PAUSE_AFTER is unset: no marker, the land runs through', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const pauseFile = join(dir, '.pause-never');
  const r = cli(dir, ['-m', OUR_MSG, '--', 'mine.txt'], { CW_COMMIT_PHASE_PAUSE_FILE: pauseFile });
  assert.equal(r.code, 0, r.err);
  assert.ok(!existsSync(`${pauseFile}.paused`), 'nothing paused, nothing written');
  assert.equal(g(dir, ['show', 'HEAD:mine.txt']), 'my work');
});

test('a step name the tool does not have is refused before anything is read — a misspelt probe cannot pass as clean', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const head = g(dir, ['rev-parse', 'HEAD']);
  const r = cli(dir, ['-m', OUR_MSG, '--', 'mine.txt'], { CW_COMMIT_PHASE_PAUSE_AFTER: 'commit_tree', CW_COMMIT_PHASE_PAUSE_FILE: join(dir, '.p') });
  assert.equal(r.code, 2, `${r.out}${r.err}`);
  assert.match(r.err, /names no step/);
  assert.equal(g(dir, ['rev-parse', 'HEAD']), head);
  assert.ok(!existsSync(join(dir, '.git', `index.${SESSION}`)), 'refused before the index was built');
});

test('a pause nobody resumes refuses within its cap: nothing landed, no index left', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const head = g(dir, ['rev-parse', 'HEAD']);
  const pauseFile = join(dir, '.pause-abandoned');
  const r = cli(dir, ['-m', OUR_MSG, '--', 'mine.txt'],
    { CW_COMMIT_PHASE_PAUSE_AFTER: 'commit-tree', CW_COMMIT_PHASE_PAUSE_FILE: pauseFile, CW_COMMIT_PHASE_PAUSE_CAP_MS: '300' });
  assert.equal(r.code, 2, `${r.out}${r.err}`);
  assert.match(r.err, /REFUSED — paused after commit-tree and .* did not appear within 300 ms/);
  assert.ok(existsSync(`${pauseFile}.paused`), 'it did reach the step');
  assert.equal(g(dir, ['rev-parse', 'HEAD']), head, 'a timed-out pause lands nothing');
  assert.ok(!existsSync(join(dir, '.git', `index.${SESSION}`)));
});

test('a pause with no CW_COMMIT_PHASE_PAUSE_FILE refuses rather than running unpaused', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const head = g(dir, ['rev-parse', 'HEAD']);
  const r = cli(dir, ['-m', OUR_MSG, '--', 'mine.txt'], { CW_COMMIT_PHASE_PAUSE_AFTER: 'add', CW_COMMIT_PHASE_PAUSE_FILE: '' });
  assert.equal(r.code, 2, `${r.out}${r.err}`);
  assert.match(r.err, /CW_COMMIT_PHASE_PAUSE_FILE is unset/);
  assert.equal(g(dir, ['rev-parse', 'HEAD']), head);
});
