// repChainPill() — the Report tab's chain verdict. Lifted from admin/index.html and run against
// injected state, the pattern lane-override-write.test.mjs uses for inline panel functions.
//
// Two claims. (1) `verified:false` covers TWO different facts and must not be described as one:
// a BROKEN chain (a line's hash does not recompute) and a DRIFTED store (every line recomputes;
// a recorded state's bytes no longer match what the log recorded). Drift used to render as "a
// recorded state was dropped, edited or reordered" with brokenAt null — a remedy text inventing a
// cause and sending the reader to hunt the wrong thing. (2) The three anchor states are three
// claims: a committed tip is evidence, a local anchor is a consistency check on the same disk under
// the same uid, and neither absence reads as a pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelSource } from './lib/panel-source.mjs';

const SRC = panelSource('index.html');
const m = SRC.match(/function repChainPill\(\)\{[\s\S]*?\n\}/);
assert.ok(m, 'repChainPill not found — the extraction anchor moved');

const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const build = (chain) => new Function('esc', 'repChain', `${m[0]}; return repChainPill;`)(esc, chain);
const text = (chain) => build(chain)().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const OK = { present: true, verified: true, length: 41, retroSealed: 0, unrecordedCount: 0, driftedCount: 0 };

test('the harness is live — a verified chain says so and names its length', () => {
  const s = text({ ...OK, committed: true, committedWhy: 'consistent with the anchor committed at abc1234', anchored: true });
  assert.match(s, /chain verified/);
  assert.match(s, /41 write event/);
});

// ── the misdiagnosis this file exists to prevent ───────────────────────────────────────────────
test('DRIFT is not described as a break: the log recomputes, the bytes moved', () => {
  const s = text({ ...OK, verified: false, driftedCount: 2, drifted: [{ stamp: '20260901000000' }, { stamp: '20260902000000' }], committed: true, anchored: true });
  assert.match(s, /2 state\(s\) DRIFTED/);
  assert.match(s, /every line of the log still recomputes/, 'the reader must be told the chain itself is intact');
  assert.match(s, /20260901000000/, 'the drifted states are named');
  assert.doesNotMatch(s, /dropped, edited or reordered/, 'that is the BREAK diagnosis and it is wrong here');
  assert.doesNotMatch(s, /chain BROKEN/);
});

test('a real break still reads as a break, with its line', () => {
  const s = text({ ...OK, verified: false, brokenAt: { line: 7, stamp: '20260901000000' }, committed: true, anchored: true });
  assert.match(s, /chain BROKEN/);
  assert.match(s, /at line 7/);
  assert.match(s, /dropped, edited or reordered/);
});

test('not verified and NEITHER named claims neither cause', () => {
  const s = text({ ...OK, verified: false, committed: true, anchored: true });
  assert.match(s, /chain NOT verified/);
  assert.doesNotMatch(s, /dropped, edited or reordered/);
  assert.doesNotMatch(s, /DRIFTED/);
});

// ── the three anchor states ────────────────────────────────────────────────────────────────────
test('a committed tip is stated as the copy this machine cannot rewrite', () => {
  const s = text({ ...OK, committed: true, committedWhy: 'consistent with the anchor committed at 77ed613', anchored: true });
  assert.match(s, /tip committed/);
  assert.match(s, /77ed613/);
  assert.match(s, /cannot rewrite/);
});

test('THE ATTACK: chain and local anchor rewritten to agree — committed disagreement outranks the passing local anchor', () => {
  const s = text({ ...OK, committed: false, committedWhy: 'the tip committed at 77ed613 is not in this chain — the log was rewritten or replaced since that commit', anchored: true, anchorAt: '2026-09-06T00:00:00.000Z' });
  assert.match(s, /committed anchor DISAGREES/);
  assert.match(s, /rewritten or replaced/);
  // the local anchor still says it is consistent, because it was rewritten too — both must show
  assert.match(s, /local anchor consistent/, 'the passing local check must remain visible beside the failing committed one, or the reader cannot see why one is weaker');
});

test('an uncommitted tip is NOT a pass, and says the local anchor is not evidence', () => {
  const s = text({ ...OK, committed: null, committedWhy: 'store/chain-tips.jsonl is not in HEAD — anchors exist locally but none is committed yet', anchored: true });
  assert.match(s, /tip not committed/);
  assert.match(s, /none is committed yet/);
  assert.match(s, /not evidence/);
  assert.doesNotMatch(s, /tip committed <|>tip committed</, 'null must never render as the committed-true pill');
});

test('a local anchor that disagrees is named even when the tip is committed', () => {
  const s = text({ ...OK, committed: true, committedWhy: 'x', anchorMissing: true, anchorWhy: 'the anchored tip is not in this chain' });
  assert.match(s, /local anchor disagrees/);
});

// ── scope of protection ────────────────────────────────────────────────────────────────────────
test('v1 lines are reported as unprotected rather than implied covered', () => {
  const none = text({ ...OK, committed: true, committedWhy: 'x', anchored: true, v1Lines: 41, protectedFrom: null });
  assert.match(none, /41 line\(s\) predate whole-line hashing/);
  assert.match(none, /none fully bound yet/);
  assert.match(none, /notes and flags are not covered/);
  const some = text({ ...OK, committed: true, committedWhy: 'x', anchored: true, v1Lines: 41, protectedFrom: 42 });
  assert.match(some, /fully bound from line 42/);
  const clean = text({ ...OK, committed: true, committedWhy: 'x', anchored: true, v1Lines: 0 });
  assert.doesNotMatch(clean, /predate whole-line hashing/, 'a fully v2 chain says nothing about v1');
});

test('unrecorded index states are still named', () => {
  const s = text({ ...OK, unrecordedCount: 2, unrecorded: ['20260901000000', '20260902000000'], committed: true, committedWhy: 'x', anchored: true });
  assert.match(s, /2 unrecorded/);
  assert.match(s, /dodged the log/);
});
