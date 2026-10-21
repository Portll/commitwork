// bin/anchor-commit.mjs — a pathspec commit of the anchor store in the repo its symlink resolves
// into. Fixture: a real git repo in tmp, a `store/` dir inside it, and a symlink to that dir from
// outside — the sidecar shape. CW_CHAIN_ANCHORS points through the symlink, exactly as the real
// default does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anchorCommit } from '../anchor-commit.mjs';
import { committedAnchors, verifyChain, appendChainEvent, appendAnchor, _clearCommittedCache } from '../../monitor/history-chain.mjs';

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function sidecar() {
  const root = mkdtempSync(join(tmpdir(), 'cw-anchorcommit-'));
  const repo = join(root, 'sidecar'); mkdirSync(join(repo, 'store'), { recursive: true });
  git(repo, ['init', '-q']); git(repo, ['config', 'user.email', 'test@example.test']); git(repo, ['config', 'user.name', 'test']);
  writeFileSync(join(repo, 'README.md'), 'sidecar\n'); git(repo, ['add', '--', 'README.md']); git(repo, ['commit', '-q', '-m', 'init', '--', 'README.md']);
  // a peer's dirty file: must NEVER ride along on the pathspec commit
  writeFileSync(join(repo, 'peer-work.md'), 'uncommitted\n'); git(repo, ['add', '--', 'peer-work.md']);
  mkdirSync(join(root, 'checkout', '.claude'), { recursive: true });
  symlinkSync(join(repo, 'store'), join(root, 'checkout', '.claude', 'store'));
  const file = join(root, 'checkout', '.claude', 'store', 'chain-tips.jsonl');
  return { root, repo, file };
}
const H = (c) => c.repeat(64);

test('first commit: the untracked store is committed by pathspec, a staged peer file is left staged', () => {
  const { root, repo, file } = sidecar();
  appendFileSync(file, JSON.stringify({ at: '2026-09-06T00:00:00.000Z', area: 'a', length: 1, tip: H('a') }) + '\n');
  const r = anchorCommit({ path: file });
  assert.deepEqual([r.code, r.committed, r.rel], [0, true, 'store/chain-tips.jsonl'], JSON.stringify(r));
  assert.equal(git(repo, ['show', '--stat', '--format=', 'HEAD']).includes('peer-work.md'), false, 'the peer\'s staged file must not be in the anchor commit');
  assert.equal(git(repo, ['status', '--porcelain', '--', 'peer-work.md']).startsWith('A'), true, 'and it is still staged for them');
  assert.match(git(repo, ['log', '-1', '--format=%B']), /first commit of the anchor store/);
  rmSync(root, { recursive: true, force: true });
});

test('nothing to commit is exit 0 and says so; a new line is a new commit with the count', () => {
  const { root, repo, file } = sidecar();
  appendFileSync(file, JSON.stringify({ at: '2026-09-06T00:00:00.000Z', area: 'a', length: 1, tip: H('a') }) + '\n');
  assert.equal(anchorCommit({ path: file }).committed, true);
  const noop = anchorCommit({ path: file });
  assert.deepEqual([noop.code, noop.committed], [0, false]); assert.match(noop.why, /unchanged at HEAD/);
  appendFileSync(file, JSON.stringify({ at: '2026-09-06T01:00:00.000Z', area: 'a', length: 2, tip: H('b') }) + '\n');
  const r = anchorCommit({ path: file });
  assert.equal(r.committed, true); assert.match(git(repo, ['log', '-1', '--format=%s']), /1 new line/);
  rmSync(root, { recursive: true, force: true });
});

test('--check writes nothing', () => {
  const { root, repo, file } = sidecar();
  appendFileSync(file, JSON.stringify({ at: '2026-09-06T00:00:00.000Z', area: 'a', length: 1, tip: H('a') }) + '\n');
  const before = git(repo, ['rev-parse', 'HEAD']);
  const r = anchorCommit({ path: file, check: true });
  assert.deepEqual([r.code, r.committed, r.dryRun], [0, false, true]);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), before);
  rmSync(root, { recursive: true, force: true });
});

test('a store directory that is not a symlink is REFUSED (exit 2) unless the store was named explicitly', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-anchorcommit-real-'));
  mkdirSync(join(root, '.claude', 'store'), { recursive: true });
  const file = join(root, '.claude', 'store', 'chain-tips.jsonl'); writeFileSync(file, '{}\n');
  const saved = process.env.CW_CHAIN_ANCHORS; delete process.env.CW_CHAIN_ANCHORS;
  try {
    const r = anchorCommit({ path: file });
    assert.equal(r.code, 2); assert.match(r.why, /not a symlink/);
  } finally { if (saved !== undefined) process.env.CW_CHAIN_ANCHORS = saved; }
  rmSync(root, { recursive: true, force: true });
});

test('a store outside any git repo is refused with the reason, never a crash', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-anchorcommit-nogit-'));
  mkdirSync(join(root, 'real'), { recursive: true }); symlinkSync(join(root, 'real'), join(root, 'store'));
  const file = join(root, 'store', 'chain-tips.jsonl'); writeFileSync(file, '{}\n');
  const r = anchorCommit({ path: file });
  assert.equal(r.code, 2); assert.match(r.why, /not inside a git repository/);
  rmSync(root, { recursive: true, force: true });
});

// ── the verdict the commit exists for ──────────────────────────────────────────────────────────
test('committed: HEAD\'s anchor is the one consulted — a local line appended after the commit does not count, and a rewrite is named', () => {
  const { root, repo, file } = sidecar();
  const hd = join(root, 'hist'); mkdirSync(hd);
  const ev = (stamp) => ({ at: '2026-09-06T00:00:00.000Z', op: 'slice', stamp, sliceId: `s-${stamp}`, source: `sweep-${stamp}`, sliceSha256: H('a') });
  appendChainEvent(hd, ev('20260906000000'));
  appendAnchor(hd, 'a', '2026-09-06T00:00:00.000Z', file);
  const before = verifyChain(hd, [], { area: 'a', anchorsFile: file, committed: true });
  assert.equal(before.committed, null, 'nothing committed yet is UNDETERMINED, not false');
  assert.match(before.committedWhy, /none is committed yet/);
  assert.equal(anchorCommit({ path: file }).committed, true);
  const sha = git(repo, ['rev-parse', '--short', 'HEAD']);
  const v = verifyChain(hd, [], { area: 'a', anchorsFile: file, committed: true });
  assert.deepEqual([v.committed, v.committedSha, v.anchored], [true, sha, true], JSON.stringify(v));
  assert.match(v.committedWhy, /committed at/);
  // a second event + local anchor, NOT committed: the committed verdict still rests on HEAD's tip, which is still in the chain
  appendChainEvent(hd, ev('20260906010000')); appendAnchor(hd, 'a', '2026-09-06T01:00:00.000Z', file);
  assert.equal(verifyChain(hd, [], { area: 'a', anchorsFile: file, committed: true }).committed, true);
  // the attack: rewrite the chain from genesis AND the local anchor file to match — the local check passes, HEAD does not
  writeFileSync(join(hd, 'chain.jsonl'), ''); appendChainEvent(hd, ev('20260906999999'));
  writeFileSync(file, ''); appendAnchor(hd, 'a', '2026-09-06T02:00:00.000Z', file);
  const forged = verifyChain(hd, [], { area: 'a', anchorsFile: file, committed: true });
  assert.equal(forged.anchored, true, 'the local anchor was rewritten to agree — this is the case a local check cannot see');
  assert.deepEqual([forged.committed, forged.committedMissing], [false, true]);
  assert.match(forged.committedWhy, /rewritten or replaced since that commit/);
  assert.deepEqual(committedAnchors('a', file).anchors.map((x) => x.length), [1], 'HEAD still says length 1');
  rmSync(root, { recursive: true, force: true });
});

test('the committed read is CACHED for a burst, per-area filtering survives one shared entry, and ttl 0 disables it', () => {
  // Two git spawns per call. The sweep pays it once per area; the panel pays it on every Report-tab
  // read, so a burst would re-answer the same question. The cache holds the RAW file, not one
  // area's slice — two areas asking inside one window must not receive each other's answer.
  const { root, repo, file } = sidecar();
  for (const [area, tip] of [['a', H('a')], ['b', H('b')], ['a', H('c')]]) {
    appendFileSync(file, JSON.stringify({ at: '2026-09-06T00:00:00.000Z', area, length: 1, tip }) + '\n');
  }
  anchorCommit({ path: file });
  const saved = process.env.CW_ANCHOR_CACHE_MS;
  try {
    process.env.CW_ANCHOR_CACHE_MS = '5000'; _clearCommittedCache();
    const a1 = committedAnchors('a', file); const b1 = committedAnchors('b', file);
    assert.deepEqual([a1.anchors.length, b1.anchors.length], [2, 1], 'each area gets its OWN rows from the shared cache entry');
    assert.ok(a1.anchors.every((x) => x.area === 'a') && b1.anchors.every((x) => x.area === 'b'));
    // a commit landing inside the window is not visible until it expires — stated, not hidden
    appendFileSync(file, JSON.stringify({ at: '2026-09-06T01:00:00.000Z', area: 'b', length: 2, tip: H('d') }) + '\n');
    anchorCommit({ path: file });
    assert.equal(committedAnchors('b', file).anchors.length, 1, 'the cached answer is served for the TTL');
    _clearCommittedCache();
    assert.equal(committedAnchors('b', file).anchors.length, 2, 'and the new commit appears once the cache is cleared');
    // ttl 0 disables entirely, which is what a test must use to avoid a neighbour's answer
    process.env.CW_ANCHOR_CACHE_MS = '0';
    appendFileSync(file, JSON.stringify({ at: '2026-09-06T02:00:00.000Z', area: 'b', length: 3, tip: H('e') }) + '\n');
    anchorCommit({ path: file });
    assert.equal(committedAnchors('b', file).anchors.length, 3, 'ttl 0 reads through every time');
  } finally { if (saved === undefined) delete process.env.CW_ANCHOR_CACHE_MS; else process.env.CW_ANCHOR_CACHE_MS = saved; _clearCommittedCache(); }
  rmSync(root, { recursive: true, force: true });
});

test('committed is null with the reason when the store is not in a git repo — never true by absence', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-anchorcommit-nogit2-'));
  mkdirSync(join(root, 'store')); const file = join(root, 'store', 'chain-tips.jsonl');
  const hd = join(root, 'hist'); mkdirSync(hd);
  appendChainEvent(hd, { at: '2026-09-06T00:00:00.000Z', op: 'slice', stamp: '1', sliceId: 's', source: 'x', sliceSha256: H('a') });
  appendAnchor(hd, 'a', '2026-09-06T00:00:00.000Z', file);
  const v = verifyChain(hd, [], { area: 'a', anchorsFile: file, committed: true });
  assert.deepEqual([v.anchored, v.committed], [true, null]); assert.match(v.committedWhy, /not inside a git repository/);
  assert.equal(readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 1);
  rmSync(root, { recursive: true, force: true });
});
