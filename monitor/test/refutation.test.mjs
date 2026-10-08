// node --test monitor/test/ — I11: a refutation that is not a recorded, chained event is not
// contestable in any way that survives.
//
// The two properties the whole thing rests on: filing NEVER mutates the claim, and an open
// refutation means the claim does NOT silently win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  emptyRefutationDoc, fileRefutation, resolveRefutation, contestState,
  verifyRefutationChain, openRefutations, targetAddress, TARGET_KINDS, INDEPENDENCE, bandRefutations,
} from '../refutation.mjs';

const T0 = '2026-09-01T00:00:00.000Z';
const T1 = '2026-09-01T01:00:00.000Z';
const BAND = { kind: 'band', id: 'secrets' };
const ok = { target: BAND, ground: 'the band cites a corpus of 4 repos', by: 'jo', independence: 'internal', at: T0 };

// ---- addresses that already exist ------------------------------------------------------------------

test('a detector is contestable at the address it already has', () => {
  // So an upstream maintainer can contest `trufflehog/Lob` without commitwork minting them an id.
  assert.equal(targetAddress({ kind: 'detector', id: 'trufflehog/Lob' }), 'detector:trufflehog/Lob');
});

test('every target kind produces an address, and an unknown kind is refused', () => {
  for (const kind of TARGET_KINDS) assert.match(targetAddress({ kind, id: 'x' }), new RegExp(`^${kind}:x$`));
  assert.throws(() => targetAddress({ kind: 'vibes', id: 'x' }), /target kind must be one of/);
  assert.throws(() => targetAddress({ kind: 'band', id: '  ' }), /needs a target id/);
});

// ---- filing refuses what cannot be weighed ---------------------------------------------------------

test('a refutation with no ground is refused — that is a complaint, not a contest', () => {
  const doc = emptyRefutationDoc();
  assert.throws(() => fileRefutation(doc, { ...ok, ground: '' }), /requires a ground/);
  assert.deepEqual(doc.refutations, {}, 'a refused filing leaves nothing behind');
  assert.deepEqual(doc.events, [], 'and appends no event');
});

test('an anonymous refutation is refused', () => {
  assert.throws(() => fileRefutation(emptyRefutationDoc(), { ...ok, by: '' }), /named refuter/);
});

test('independence is REQUIRED, never defaulted', () => {
  // A default would guess at the one property this record exists to make legible, and `self`
  // defaulting would be as wrong as `external`.
  assert.throws(() => fileRefutation(emptyRefutationDoc(), { ...ok, independence: undefined }), /independence must be one of/);
  for (const ind of INDEPENDENCE) {
    assert.ok(fileRefutation(emptyRefutationDoc(), { ...ok, independence: ind }));
  }
});

// ---- the claim does not silently win ----------------------------------------------------------------

test('an open refutation makes the target CONTESTED — a third state, not upheld and not conceded', () => {
  const doc = emptyRefutationDoc();
  fileRefutation(doc, ok);
  const c = contestState(doc, BAND);
  assert.equal(c.state, 'contested');
  assert.equal(c.open, 1);
  assert.match(c.why, /does not stand unopposed/);
  assert.equal(c.grounds[0].ground, ok.ground, 'the ground is readable beside the claim');
});

test('an untouched target is UNCONTESTED, which is not the same as settled', () => {
  const c = contestState(emptyRefutationDoc(), BAND);
  assert.equal(c.state, 'uncontested');
  assert.equal(c.total, 0);
});

test('UPHELD-after-contest is distinguishable from never contested', () => {
  // Collapsing these discards the fact that somebody disagreed and was overruled.
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  resolveRefutation(doc, r.id, { resolution: 'upheld', why: 'the corpus is 100 repos; the band cites the right one', by: 'operator', at: T1 });
  const c = contestState(doc, BAND);
  assert.equal(c.state, 'settled');
  assert.notEqual(c.state, 'uncontested');
  assert.deepEqual(c.resolutions, { upheld: 1 });
  assert.match(c.why, /not an unchallenged one/);
});

// ---- resolution rules --------------------------------------------------------------------------------

test('resolving without a reason is refused — that is the claim winning by default', () => {
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  assert.throws(() => resolveRefutation(doc, r.id, { resolution: 'upheld', why: '', by: 'operator', at: T1 }), /requires a reason/);
  assert.equal(doc.refutations[r.id].state, 'open', 'a refused resolution leaves it open');
});

test('only the refuter may WITHDRAW — anyone else must say upheld or conceded', () => {
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  assert.throws(
    () => resolveRefutation(doc, r.id, { resolution: 'withdrawn', why: 'dropping it', by: 'operator', at: T1 }),
    /only the refuter may withdraw/,
  );
  assert.ok(resolveRefutation(doc, r.id, { resolution: 'withdrawn', why: 'I misread the corpus', by: 'jo', at: T1 }));
});

test('SELF-resolution is allowed and MARKED, never silently accepted', () => {
  // The operator is the primary adjudicator, so refusing this would stop the workflow; recording it
  // is the whole mechanism — naming the conflict does not remove it.
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  resolveRefutation(doc, r.id, { resolution: 'conceded', why: 'jo was right', by: 'jo', at: T1 });
  assert.equal(doc.refutations[r.id].resolvedIndependently, false);
  const doc2 = emptyRefutationDoc();
  const r2 = fileRefutation(doc2, ok);
  resolveRefutation(doc2, r2.id, { resolution: 'conceded', why: 'agreed', by: 'operator', at: T1 });
  assert.equal(doc2.refutations[r2.id].resolvedIndependently, true);
});

test('a resolved refutation cannot be re-resolved', () => {
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  resolveRefutation(doc, r.id, { resolution: 'upheld', why: 'checked', by: 'operator', at: T1 });
  assert.throws(() => resolveRefutation(doc, r.id, { resolution: 'conceded', why: 'changed my mind', by: 'operator', at: T1 }), /already resolved/);
});

// ---- chained ------------------------------------------------------------------------------------------

test('filing and resolving are CHAINED events', () => {
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  resolveRefutation(doc, r.id, { resolution: 'upheld', why: 'checked', by: 'operator', at: T1 });
  assert.deepEqual(doc.events.map((e) => e.type), ['refutation-filed', 'refutation-resolved']);
  assert.equal(verifyRefutationChain(doc).ok, true);
});

test('altering a recorded refutation BREAKS the chain', () => {
  const doc = emptyRefutationDoc();
  fileRefutation(doc, ok);
  fileRefutation(doc, { ...ok, target: { kind: 'detector', id: 'trufflehog/Lob' }, at: T1 });
  doc.events[0].data.by = 'somebody else';
  const v = verifyRefutationChain(doc);
  assert.equal(v.ok, false);
  assert.equal(v.broken[0].index, 0);
});

test('a chain verifies non-alteration and NOT that anything was considered', () => {
  // An empty store is a valid chain. It proves nobody tampered; it proves nothing was weighed.
  const v = verifyRefutationChain(emptyRefutationDoc());
  assert.equal(v.ok, true);
  assert.equal(v.events, 0);
});

// ---- the open list ---------------------------------------------------------------------------------------

test('open refutations are listed oldest-first so none ages out of view', () => {
  const doc = emptyRefutationDoc();
  const b = fileRefutation(doc, { ...ok, at: T1 });
  const a = fileRefutation(doc, { ...ok, target: { kind: 'closure', id: 'ISS-1' }, at: T0 });
  resolveRefutation(doc, b.id, { resolution: 'upheld', why: 'checked', by: 'operator', at: T1 });
  assert.deepEqual(openRefutations(doc).map((r) => r.id), [a.id], 'resolved ones drop out');
});

// ---- the adapter that makes I1's in-memory contest durable ------------------------------------------

test('band refutations come out in the shape buildLaneConfidence already accepts', async () => {
  const { buildLaneConfidence } = await import('../lane-confidence.mjs');
  const { bandRefutations } = await import('../refutation.mjs');
  const doc = emptyRefutationDoc();
  fileRefutation(doc, { ...ok, target: { kind: 'band', id: 'trufflehog/Lob' }, ground: 'the Lob detector produced 1,311 false criticals', by: 'upstream', independence: 'external' });
  const art = buildLaneConfidence(
    [{ detector: 'trufflehog/Lob', adjudicated: 0, sampling: 'opportunistic' }],
    { refutations: bandRefutations(doc) },
  );
  assert.equal(art.lanes[0].refutations.length, 1, 'the artifact renders the open contest');
  assert.equal(art.lanes[0].refutations[0].by, 'upstream');
});

test('a RESOLVED refutation stops hanging off the live band, but stays in the record', () => {
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, { ...ok, target: { kind: 'band', id: 'x/y' } });
  resolveRefutation(doc, r.id, { resolution: 'upheld', why: 'checked the corpus', by: 'operator', at: T1 });
  assert.deepEqual(bandRefutations(doc), [], 'not shown as still standing');
  assert.equal(bandRefutations(doc, { includeResolved: true }).length, 1);
  assert.equal(contestState(doc, { kind: 'band', id: 'x/y' }).state, 'settled', 'and the contest is still visible');
});

// ---- persistence: fail closed --------------------------------------------------------------------
//
// The store going unreadable would otherwise look exactly like nobody having objected. Only ENOENT
// means "no refutation has ever been filed".

test('a MISSING store is legitimately empty', async () => {
  const { loadRefutations } = await import('../refutation.mjs');
  const doc = loadRefutations(join(mkdtempSync(join(tmpdir(), 'cw-ref-')), 'nope.json'));
  assert.deepEqual(doc.refutations, {});
});

test('an UNPARSEABLE store throws — it does not read as zero contests', async () => {
  const { loadRefutations } = await import('../refutation.mjs');
  const p = join(mkdtempSync(join(tmpdir(), 'cw-ref-')), 'refutations.json');
  writeFileSync(p, '{ not json');
  assert.throws(() => loadRefutations(p), /refusing to report zero contests/);
});

test('a store of the WRONG SHAPE throws rather than being treated as empty', async () => {
  const { loadRefutations } = await import('../refutation.mjs');
  const p = join(mkdtempSync(join(tmpdir(), 'cw-ref-')), 'refutations.json');
  writeFileSync(p, JSON.stringify({ hello: 'world' }));
  assert.throws(() => loadRefutations(p), /not a refutation document/);
});

test('a BROKEN chain is never persisted', async () => {
  const { saveRefutations } = await import('../refutation.mjs');
  const p = join(mkdtempSync(join(tmpdir(), 'cw-ref-')), 'refutations.json');
  const doc = emptyRefutationDoc();
  fileRefutation(doc, ok);
  doc.events[0].data.by = 'tampered';
  assert.throws(() => saveRefutations(p, doc), /refusing to save a broken refutation chain/);
  assert.equal(existsSync(p), false, 'nothing was written');
});

test('a filed refutation round-trips through disk with its chain intact', async () => {
  const { saveRefutations, loadRefutations } = await import('../refutation.mjs');
  const p = join(mkdtempSync(join(tmpdir(), 'cw-ref-')), 'refutations.json');
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  saveRefutations(p, doc);
  const back = loadRefutations(p);
  assert.equal(back.refutations[r.id].ground, ok.ground);
  assert.equal(verifyRefutationChain(back).ok, true, 'survives the round trip — which is the whole point of I11');
});

// ---- what `settled` MEANS depends on how ---------------------------------------------------------
//
// The first version said "a claim upheld over a recorded contest" for every settled target,
// including conceded ones — asserting the claim stood in exactly the cases where it did not.

test('a CONCEDED contest says the claim does not stand', () => {
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  resolveRefutation(doc, r.id, { resolution: 'conceded', why: 'measured; the refuter was right', by: 'operator', at: T1 });
  const c = contestState(doc, BAND);
  assert.equal(c.claimStands, false);
  assert.match(c.why, /CONCEDED/);
  assert.match(c.why, /withdrawn or restated/);
  assert.doesNotMatch(c.why, /upheld over a recorded contest/);
});

test('an UPHELD contest says the claim stands, and that it was challenged', () => {
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  resolveRefutation(doc, r.id, { resolution: 'upheld', why: 'the corpus is right', by: 'operator', at: T1 });
  const c = contestState(doc, BAND);
  assert.equal(c.claimStands, true);
  assert.match(c.why, /not an unchallenged one/);
});

test('a WITHDRAWN contest leaves the claim UNTESTED, not vindicated', () => {
  const doc = emptyRefutationDoc();
  const r = fileRefutation(doc, ok);
  resolveRefutation(doc, r.id, { resolution: 'withdrawn', why: 'I misread it', by: 'jo', at: T1 });
  const c = contestState(doc, BAND);
  assert.equal(c.claimStands, null, 'null, not true — nobody ruled');
  assert.match(c.why, /never tested rather than vindicated/);
});

test('one concession outweighs an upheld — the claim still does not stand', () => {
  const doc = emptyRefutationDoc();
  const a = fileRefutation(doc, ok);
  const b = fileRefutation(doc, { ...ok, ground: 'a second, different objection', at: T1 });
  resolveRefutation(doc, a.id, { resolution: 'upheld', why: 'this ground was wrong', by: 'operator', at: T1 });
  resolveRefutation(doc, b.id, { resolution: 'conceded', why: 'this one was right', by: 'operator', at: T1 });
  assert.equal(contestState(doc, BAND).claimStands, false);
});
