import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionKey, privateIndexPath, landVerdict, sharedIndexRepair, replayVerdict } from '../commit-phase-core.mjs';

const H0 = 'a'.repeat(40);
const H1 = 'b'.repeat(40);
const ok = { declared: ['bin/x.mjs'], headAtReadTree: H0, headNow: H0, stagedCount: 1 };

test('the session key is path-safe, because it becomes a filename inside $GIT_DIR', () => {
  assert.equal(sessionKey({ CW_COMMIT_SESSION: 'cw-44' }), 'cw-44');
  // A key that escaped would write outside the git dir — the whole point of sanitising.
  assert.equal(sessionKey({ CW_COMMIT_SESSION: '../../etc/passwd' }), 'etc-passwd');
  assert.equal(sessionKey({ CW_COMMIT_SESSION: 'a/b' }), 'a-b');
  assert.ok(!sessionKey({ CW_COMMIT_SESSION: '..' }).startsWith('.'));
  assert.ok(sessionKey({ CW_COMMIT_SESSION: 'x'.repeat(200) }).length <= 64);
});

test('the env is read at CALL time, so a test that sets it afterwards is not defeated', () => {
  // The failure this guards: `const K = process.env.X` at module load passes the test while
  // proving nothing. Two different envs, same imported function, two different answers.
  assert.equal(sessionKey({ CW_COMMIT_SESSION: 'first' }), 'first');
  assert.equal(sessionKey({ CW_COMMIT_SESSION: 'second' }), 'second');
});

test('CW_COMMIT_SESSION wins over CLAUDE_SESSION_ID, and pid is the floor', () => {
  assert.equal(sessionKey({ CW_COMMIT_SESSION: 'a', CLAUDE_SESSION_ID: 'b' }), 'a');
  assert.equal(sessionKey({ CLAUDE_SESSION_ID: 'b' }), 'b');
  // The name the harness actually exports. Reading only CLAUDE_SESSION_ID made this return
  // `pid-<pid>` for every real invocation, so the private index was per-process, not per-session.
  assert.equal(sessionKey({ CLAUDE_CODE_SESSION_ID: 'c' }), 'c');
  assert.equal(sessionKey({ CW_COMMIT_SESSION: 'a', CLAUDE_CODE_SESSION_ID: 'c' }), 'a');
  assert.equal(sessionKey({ CLAUDE_CODE_SESSION_ID: 'c', CLAUDE_SESSION_ID: 'b' }), 'c');
  assert.equal(sessionKey({}, 123), 'pid-123');
});

test('the index is per session, so two sessions never name the same file', () => {
  // join(), not a POSIX literal: this value becomes GIT_INDEX_FILE, so it must be an OS-NATIVE
  // path — `\r\.git\index.cw44` on Windows is correct and the literal was pinning the platform.
  // The property is that the filename carries the session key, which join() does not obscure.
  assert.equal(privateIndexPath('/r/.git', 'cw44'), join('/r/.git', 'index.cw44'));
  assert.notEqual(privateIndexPath('/r/.git', 'cw44'), privateIndexPath('/r/.git', 'cw23'));
});

test('a clean pre-flight lands', () => {
  const v = landVerdict(ok);
  assert.equal(v.verdict, 'land');
  assert.equal(v.exit, 0);
});

test('THE STALE INDEX IS REFUSED — HEAD moved since the read-tree', () => {
  const v = landVerdict({ ...ok, headNow: H1 });
  assert.equal(v.verdict, 'stale-index');
  assert.equal(v.exit, 2);
  // The message must name the actual harm, not just the mismatch: someone reading this at 3am
  // needs to know the diff will look clean while reverting another session.
  assert.match(v.why, /revert/);
  assert.equal(v.headAtReadTree, H0);
  assert.equal(v.headNow, H1);
});

test('an UNKNOWN head is refused, never coerced to "unchanged" — fail closed', () => {
  for (const bad of [null, undefined, '']) {
    assert.equal(landVerdict({ ...ok, headNow: bad }).verdict, 'unknown-head', `headNow=${bad}`);
    assert.equal(landVerdict({ ...ok, headAtReadTree: bad }).verdict, 'unknown-head', `head0=${bad}`);
  }
  // Both unknown must NOT compare equal into a pass — the null===null trap.
  assert.equal(landVerdict({ ...ok, headAtReadTree: null, headNow: null }).verdict, 'unknown-head');
});

test('no declaration is an error, not an implicit "everything staged"', () => {
  assert.equal(landVerdict({ ...ok, declared: [] }).verdict, 'no-declaration');
  assert.equal(landVerdict({ ...ok, declared: undefined }).verdict, 'no-declaration');
  assert.match(landVerdict({ ...ok, declared: [] }).why, /shared index/);
});

test('a declared path that escapes the repo is refused', () => {
  for (const p of ['/etc/passwd', '../outside', 'a/../../b', '']) {
    assert.equal(landVerdict({ ...ok, declared: [p] }).verdict, 'no-declaration', p);
  }
  // A legitimate path containing "..", but not AS a segment, still lands.
  assert.equal(landVerdict({ ...ok, declared: ['bin/a..b.mjs'] }).verdict, 'land');
});

test('the staleness check runs BEFORE the nothing-staged check', () => {
  // Order matters: a stale index with nothing staged is still stale, and reporting "nothing to
  // commit" would send the caller away believing the tree was fine.
  const v = landVerdict({ ...ok, headNow: H1, stagedCount: 0 });
  assert.equal(v.verdict, 'stale-index');
});

test('nothing staged is exit 1 — distinct from a refusal', () => {
  const v = landVerdict({ ...ok, stagedCount: 0 });
  assert.equal(v.verdict, 'nothing-staged');
  assert.equal(v.exit, 1);
});

test('the shared-index repair names exactly the declared paths and nothing else', () => {
  // Never `-u`, never `-A`: this runs against the SHARED index, where a broad reset would unstage
  // other sessions' work.
  assert.deepEqual(sharedIndexRepair(['a.mjs', 'b.mjs']), ['reset', '-q', 'HEAD', '--', 'a.mjs', 'b.mjs']);
  const cmd = sharedIndexRepair(['a.mjs']);
  assert.ok(!cmd.includes('-u') && !cmd.includes('-A') && !cmd.includes('--hard'));
});


// ── replayVerdict: the refusal is the load-bearing half ───────────────────────────────────────
// A replay ASSIGNS blobs; it does not merge. On a path both sides changed it would take ours and
// drop theirs behind a diff that looks clean, which is strictly worse than the rebase --onto
// exists to avoid. These pin the refusal, not the happy path.

test('an UNKNOWN base or head is refused, never coerced', () => {
  assert.equal(replayVerdict({ base: null, head: 'a'.repeat(40) }).verdict, 'refuse');
  assert.equal(replayVerdict({ base: 'a'.repeat(40), head: null }).verdict, 'refuse');
  assert.equal(replayVerdict({}).verdict, 'refuse');
});

test('already at the target, or behind it, is a NOOP and exits 0 — not a refusal', () => {
  const a = 'a'.repeat(40);
  assert.deepEqual(
    (({ verdict, exit }) => ({ verdict, exit }))(replayVerdict({ base: a, head: a })),
    { verdict: 'noop', exit: 0 });
  const r = replayVerdict({ base: a, head: 'b'.repeat(40), commits: [] });
  assert.equal(r.verdict, 'noop');
  assert.equal(r.exit, 0, 'nothing to replay is success, not failure');
});

test('a path changed on BOTH sides is refused, and every collision is named', () => {
  const r = replayVerdict({
    base: 'a'.repeat(40), head: 'b'.repeat(40), commits: ['c'.repeat(40)],
    mineFiles: ['z.txt', 'shared.txt', 'mine.txt', 'also-shared.txt'],
    theirFiles: ['shared.txt', 'also-shared.txt', 'theirs.txt'],
  });
  assert.equal(r.verdict, 'refuse');
  assert.equal(r.exit, 2);
  // Sorted and complete: a partial list would let somebody resolve one and retry into the other.
  assert.deepEqual(r.overlap, ['also-shared.txt', 'shared.txt']);
  assert.match(r.why, /also-shared\.txt, shared\.txt/);
});

test('a DISJOINT change set replays', () => {
  const r = replayVerdict({
    base: 'a'.repeat(40), head: 'b'.repeat(40), commits: ['c'.repeat(40), 'd'.repeat(40)],
    mineFiles: ['mine.txt'], theirFiles: ['theirs.txt'],
  });
  assert.equal(r.verdict, 'replay');
  assert.deepEqual(r.overlap, []);
});
