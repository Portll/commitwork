// R-C · ownership is answered from write EVIDENCE, or not answered.
//
// WHAT THIS COST, before it was a code problem. `attributeFiles` filtered on `if (!r.f) continue`
// and consulted neither `t` nor `via` nor `access`, so every "Dirty files ANOTHER session touched"
// line the gate printed was drawn from all 18,762 file rows — of which 6,528 carry write evidence
// and 12,166 carry none. Those named sessions may only have had the path appear in a command string.
//
// It stopped being cosmetic on 2026-08-30: a correct gate classification sat unlanded
// with a test red because two sessions each declined to commit it out of courtesy to an author
// neither could identify, and nine sessions were polled and nine disclaimed it. A session that edits
// through Bash has nothing to recognise its own work by either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeFiles, authorOf } from '../gate-tests-core.mjs';

const row = (o) => JSON.stringify(o);
const AT = '2026-08-30T09:00:00.000Z';

test('THE DEFECT: a bare touch does not make a file yours', () => {
  // One row, no write evidence — the path merely appeared in a command.
  const lines = [row({ s: 'aaaaaaaa', f: 'x.mjs', at: AT })];
  const r = attributeFiles(['x.mjs'], 'bbbbbbbb', { ledgerLines: lines });
  assert.ok(r.unevidenced.includes('x.mjs'),
    'a file whose only rows are evidence-free must be reported as unevidenced');
});

test('a write-evidenced row IS evidence, and the file is not flagged', () => {
  const lines = [row({ s: 'aaaaaaaa', f: 'x.mjs', at: AT, t: 'edit' })];
  const r = attributeFiles(['x.mjs'], 'bbbbbbbb', { ledgerLines: lines });
  assert.equal(r.unevidenced.includes('x.mjs'), false,
    't:"edit" carries payload fingerprints — it proves a write');
});

test('the existing buckets are UNCHANGED — this is additive, nothing regresses', () => {
  const lines = [row({ s: 'aaaaaaaa', f: 'x.mjs', at: AT })];
  const r = attributeFiles(['x.mjs'], 'aaaaaaaa', { ledgerLines: lines });
  assert.ok(r.mine.includes('x.mjs'),
    'callers depending on the old classification must keep getting it; the new bucket only says which answers rest on proof');
});

test('exec rows never establish authorship — running a file is not writing it', () => {
  const lines = [row({ s: 'aaaaaaaa', f: 'x.mjs', at: AT, via: 'exec' })];
  const r = attributeFiles(['x.mjs'], 'bbbbbbbb', { ledgerLines: lines });
  assert.ok(r.unknown.includes('x.mjs'), 'an exec row is skipped entirely');
});

// ── authorOf ────────────────────────────────────────────────────────────────────────────────────

test('authorOf returns UNKNOWN rather than naming a toucher', () => {
  const lines = [row({ s: 'aaaaaaaa', f: 'x.mjs', at: AT })];
  const a = authorOf('x.mjs', { ledgerLines: lines });
  assert.equal(a.basis, 'unknown');
  assert.equal(a.session, null,
    'naming a session on this evidence is how nine sessions came to be polled about a hunk none of them wrote');
});

test('authorOf names a session ONLY on write evidence', () => {
  const lines = [row({ s: 'aaaaaaaa', f: 'x.mjs', at: AT, t: 'write' })];
  const a = authorOf('x.mjs', { ledgerLines: lines });
  assert.deepEqual([a.basis, a.session], ['write', 'aaaaaaaa']);
});

test('two writers is CONTESTED — a real answer, not a failure to produce one', () => {
  const lines = [
    row({ s: 'aaaaaaaa', f: 'x.mjs', at: AT, t: 'edit' }),
    row({ s: 'bbbbbbbb', f: 'x.mjs', at: AT, via: 'commit' }),
  ];
  const a = authorOf('x.mjs', { ledgerLines: lines });
  assert.equal(a.basis, 'contested');
  assert.equal(a.session, null, 'contested must not pick a winner');
  assert.deepEqual(a.sessions.sort(), ['aaaaaaaa', 'bbbbbbbb']);
});

test('a delta-derived row does not make an author — it cannot, on a shared tree', () => {
  const lines = [row({ s: 'aaaaaaaa', f: 'x.mjs', at: AT, via: 'fs-delta', access: 'undetermined' })];
  assert.equal(authorOf('x.mjs', { ledgerLines: lines }).basis, 'unknown',
    'the delta says something changed in my window, never that I changed it');
});

test('authorOf ignores rows about a different path, and torn lines do not throw', () => {
  const lines = [
    row({ s: 'aaaaaaaa', f: 'other.mjs', at: AT, t: 'edit' }),
    '{not json',
    row({ s: 'cccccccc', f: 'x.mjs', at: AT, t: 'edit' }),
  ];
  const a = authorOf('x.mjs', { ledgerLines: lines });
  assert.deepEqual([a.basis, a.session], ['write', 'cccccccc']);
});

// ── R-2 · THE LAUNDERING CASE ───────────────────────────────────────────────────────────────────
// Measured 2026-08-30 on the live ledger: session A made a genuine write to a path; sessions B and C
// picked up evidence-free rows on that SAME path from a filesystem-delta race. `evidenced` was a Set
// of FILENAMES, so A's real write marked the file evidenced and the bucket reported []. The guard
// built to catch exactly this saw nothing, because a per-file key cannot express a per-session
// question.
test("R-2: one session's real write does NOT launder another's evidence-free row", () => {
  const AT = '2026-08-30T10:12:36.000Z';
  const lines = [
    // A: genuine authorship, payload fingerprints.
    row({ s: 'aaaaaaaa', f: 'shared.mjs', at: AT, t: 'edit' }),
    // B: same path, no evidence — the race victim.
    row({ s: 'bbbbbbbb', f: 'shared.mjs', at: AT }),
  ];
  const r = attributeFiles(['shared.mjs'], 'bbbbbbbb', { ledgerLines: lines });
  assert.ok(r.unevidenced.includes('shared.mjs'),
    "B is being named on this path with nothing proving it — A's write is not B's evidence");
});

test('R-2: a file whose named session DOES have evidence is not flagged', () => {
  const AT = '2026-08-30T10:12:36.000Z';
  const lines = [row({ s: 'aaaaaaaa', f: 'mine.mjs', at: AT, t: 'edit' })];
  const r = attributeFiles(['mine.mjs'], 'aaaaaaaa', { ledgerLines: lines });
  assert.equal(r.unevidenced.includes('mine.mjs'), false,
    'the flag must fire on absent evidence, not on every shared file');
});

test('R-2: two real writers on one path are both evidenced — contested, not unevidenced', () => {
  const AT = '2026-08-30T10:12:36.000Z';
  const lines = [
    row({ s: 'aaaaaaaa', f: 'both.mjs', at: AT, t: 'edit' }),
    row({ s: 'bbbbbbbb', f: 'both.mjs', at: AT, via: 'commit' }),
  ];
  const r = attributeFiles(['both.mjs'], 'aaaaaaaa', { ledgerLines: lines });
  assert.equal(r.unevidenced.includes('both.mjs'), false,
    'contested authorship is evidenced authorship — the bucket is about proof, not agreement');
});
