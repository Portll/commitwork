// Formats the commit gate alarm headline with attribution and advice (bin/gate-ratchet-core.mjs worseHeadline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worseHeadline } from '../gate-ratchet-core.mjs';

test('returns standing debt message with since date and advice', () => {
  const r = worseHeadline('standing', ['file1.js'], { since: '2024-01-01' });
  assert.equal(r, "commitwork gate: debt REMAINS above baseline (standing since 2024-01-01, not added this turn) \u2014 file1.js. Do NOT baseline a co-author's break \u2014 that banks their half-landed change as the permanent floor and hides their next real one. Separate yours from theirs before deciding: `git status`, then the touch ledger \u2014 enumerate EVERY generation (`.claude/store/touches.jsonl` plus each `.jsonl.N`; do not name one, they rotate). A row with `f` only means the ledger saw that path: require write evidence (`t`, or `via` of `commit`/`shell`) before treating it as authorship, because an exec row's `cmd` can merely mention a path and a delta row can name a file a peer wrote. Then `node bin/anchor-staleness.mjs`.");
});

test('returns theirs attribution with exactly three items and no more suffix', () => {
  const r = worseHeadline('theirs', ['a.js'], { theirs: ['x.js', 'y.js', 'z.js'] });
  assert.equal(r, "commitwork gate: debt increased since baseline \u2014 a.js. Attribution: ANOTHER session's uncommitted work (x.js, y.js, z.js). Do NOT baseline a co-author's break \u2014 that banks their half-landed change as the permanent floor and hides their next real one. Separate yours from theirs before deciding: `git status`, then the touch ledger \u2014 enumerate EVERY generation (`.claude/store/touches.jsonl` plus each `.jsonl.N`; do not name one, they rotate). A row with `f` only means the ledger saw that path: require write evidence (`t`, or `via` of `commit`/`shell`) before treating it as authorship, because an exec row's `cmd` can merely mention a path and a delta row can name a file a peer wrote. Then `node bin/anchor-staleness.mjs`.");
});

test('returns theirs attribution with four items showing more suffix', () => {
  const r = worseHeadline('theirs', ['a.js'], { theirs: ['x.js', 'y.js', 'z.js', 'w.js'] });
  assert.equal(r, "commitwork gate: debt increased since baseline \u2014 a.js. Attribution: ANOTHER session's uncommitted work (x.js, y.js, z.js +1 more). Do NOT baseline a co-author's break \u2014 that banks their half-landed change as the permanent floor and hides their next real one. Separate yours from theirs before deciding: `git status`, then the touch ledger \u2014 enumerate EVERY generation (`.claude/store/touches.jsonl` plus each `.jsonl.N`; do not name one, they rotate). A row with `f` only means the ledger saw that path: require write evidence (`t`, or `via` of `commit`/`shell`) before treating it as authorship, because an exec row's `cmd` can merely mention a path and a delta row can name a file a peer wrote. Then `node bin/anchor-staleness.mjs`.");
});

test('returns theirs attribution with one item and no more suffix', () => {
  const r = worseHeadline('theirs', ['a.js'], { theirs: ['x.js'] });
  assert.equal(r, "commitwork gate: debt increased since baseline \u2014 a.js. Attribution: ANOTHER session's uncommitted work (x.js). Do NOT baseline a co-author's break \u2014 that banks their half-landed change as the permanent floor and hides their next real one. Separate yours from theirs before deciding: `git status`, then the touch ledger \u2014 enumerate EVERY generation (`.claude/store/touches.jsonl` plus each `.jsonl.N`; do not name one, they rotate). A row with `f` only means the ledger saw that path: require write evidence (`t`, or `via` of `commit`/`shell`) before treating it as authorship, because an exec row's `cmd` can merely mention a path and a delta row can name a file a peer wrote. Then `node bin/anchor-staleness.mjs`.");
});

test('returns mixed attribution message', () => {
  const r = worseHeadline('mixed', ['a.js', 'b.js'], {});
  assert.equal(r, "commitwork gate: debt increased since baseline \u2014 a.js; b.js. Attribution: MIXED \u2014 this session and another both touched files carrying drifted anchors. Do NOT baseline a co-author's break \u2014 that banks their half-landed change as the permanent floor and hides their next real one. Separate yours from theirs before deciding: `git status`, then the touch ledger \u2014 enumerate EVERY generation (`.claude/store/touches.jsonl` plus each `.jsonl.N`; do not name one, they rotate). A row with `f` only means the ledger saw that path: require write evidence (`t`, or `via` of `commit`/`shell`) before treating it as authorship, because an exec row's `cmd` can merely mention a path and a delta row can name a file a peer wrote. Then `node bin/anchor-staleness.mjs`.");
});

test('returns mine attribution message', () => {
  const r = worseHeadline('mine', ['a.js'], {});
  assert.equal(r, "commitwork gate: this turn ADDED debt \u2014 a.js. Do NOT baseline a co-author's break \u2014 that banks their half-landed change as the permanent floor and hides their next real one. If it is yours and deliberate, accept it with `node bin/gate-ratchet.mjs --baseline`.");
});

test('returns unknown attribution with git-unavailable reason', () => {
  const r = worseHeadline('unknown', ['a.js'], { emptyReason: 'git-unavailable' });
  assert.equal(r, "commitwork gate: debt increased since baseline \u2014 a.js. Attribution UNKNOWN \u2014 the touch ledger was NOT READ (git status failed), so nothing was checked. This is \"we could not look\", NOT \"no evidence exists\". Do NOT baseline a co-author's break \u2014 that banks their half-landed change as the permanent floor and hides their next real one. Separate yours from theirs before deciding: `git status`, then the touch ledger \u2014 enumerate EVERY generation (`.claude/store/touches.jsonl` plus each `.jsonl.N`; do not name one, they rotate). A row with `f` only means the ledger saw that path: require write evidence (`t`, or `via` of `commit`/`shell`) before treating it as authorship, because an exec row's `cmd` can merely mention a path and a delta row can name a file a peer wrote. Then `node bin/anchor-staleness.mjs`.");
});

test('returns unknown attribution with no empty reason', () => {
  const r = worseHeadline('unknown', ['a.js'], {});
  assert.equal(r, "commitwork gate: debt increased since baseline \u2014 a.js. Attribution UNKNOWN \u2014 no touch-ledger evidence, which is what a concurrent session's committed change produces, so this is not evidence that it is yours. Do NOT baseline a co-author's break \u2014 that banks their half-landed change as the permanent floor and hides their next real one. Separate yours from theirs before deciding: `git status`, then the touch ledger \u2014 enumerate EVERY generation (`.claude/store/touches.jsonl` plus each `.jsonl.N`; do not name one, they rotate). A row with `f` only means the ledger saw that path: require write evidence (`t`, or `via` of `commit`/`shell`) before treating it as authorship, because an exec row's `cmd` can merely mention a path and a delta row can name a file a peer wrote. Then `node bin/anchor-staleness.mjs`.");
});

test('returns unknown attribution with non-git-unavailable reason', () => {
  const r = worseHeadline('unknown', ['a.js'], { emptyReason: 'other-reason' });
  assert.equal(r, "commitwork gate: debt increased since baseline \u2014 a.js. Attribution UNKNOWN \u2014 no touch-ledger evidence, which is what a concurrent session's committed change produces, so this is not evidence that it is yours. Do NOT baseline a co-author's break \u2014 that banks their half-landed change as the permanent floor and hides their next real one. Separate yours from theirs before deciding: `git status`, then the touch ledger \u2014 enumerate EVERY generation (`.claude/store/touches.jsonl` plus each `.jsonl.N`; do not name one, they rotate). A row with `f` only means the ledger saw that path: require write evidence (`t`, or `via` of `commit`/`shell`) before treating it as authorship, because an exec row's `cmd` can merely mention a path and a delta row can name a file a peer wrote. Then `node bin/anchor-staleness.mjs`.");
});
