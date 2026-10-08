// A5 · every published attribution states what it rests on.
//
// Measured 2026-08-30: `basis` appeared in 0 of 4,983 gate journal records. Every attribution the
// fleet published named WHO without saying what the claim was made from — how many files carried
// write evidence, how many sessions were in the population, or whether the comparison was possible
// at all. A reader could not distinguish a well-evidenced answer from a guess, and the gate's own
// author could not either a week later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributionBasis } from '../gate-tests-core.mjs';

test('the basis reports the population, not just the verdict', () => {
  const b = attributionBasis({
    mine: ['a'], theirs: ['b'], unknown: ['c'], unevidenced: ['b'],
    liveSessions: { a: ['s1'], b: ['s2', 's3'] },
    treeMineRows: 4, treeUnknownRows: 96, foreignTreeRows: 0, torn: 1,
    ledgerPresent: true, sessionKnown: true,
  });
  assert.equal(b.files, 3);
  assert.equal(b.unevidenced, 1);
  assert.equal(b.sessionsConsidered, 3, 'distinct sessions across every file considered');
  assert.equal(b.rows.treeUnknown, 96);
  assert.equal(b.rows.torn, 1, 'torn lines are counted, never silently dropped');
});

test('evidenced excludes BOTH the unknown and the unevidenced', () => {
  const b = attributionBasis({ mine: ['a', 'd'], theirs: ['b'], unknown: ['c'], unevidenced: ['b'] });
  // 4 files, 1 unknown, 1 unevidenced ⇒ 2 rest on proof.
  assert.equal(b.evidenced, 2,
    'a file with no rows and a file with evidence-free rows are both outside the evidenced set');
});

test('the basis carries WHICH unknown this is, so a reader is not left to infer it', () => {
  assert.equal(attributionBasis({ ledgerPresent: false }).kind, 'no-ledger');
  assert.equal(attributionBasis({ ledgerPresent: true, sessionKnown: false }).kind, 'no-session');
  assert.equal(attributionBasis({ ledgerPresent: true, sessionKnown: true }).kind, 'no-entry');
});

test('an empty result yields a basis rather than throwing — it is journalled on EVERY run', () => {
  const b = attributionBasis({});
  assert.equal(b.files, 0);
  assert.equal(b.sessionsConsidered, 0);
  assert.equal(b.evidenced, 0);
  assert.ok(b.rows, 'the row population is always present, even when empty');
});

test('evidenced never goes negative on a malformed result', () => {
  const b = attributionBasis({ mine: [], theirs: [], unknown: ['a', 'b'], unevidenced: ['a', 'b', 'c'] });
  assert.ok(b.evidenced >= 0, 'a count that can go negative is a count nobody can trust');
});

test('it reports COUNTS, not lists — this is written on every run and must not grow without bound', () => {
  const many = Array.from({ length: 500 }, (_, i) => `f${i}`);
  const b = attributionBasis({ mine: many, theirs: [], unknown: [], unevidenced: [] });
  const size = JSON.stringify(b).length;
  assert.ok(size < 400, `basis serialises to ${size} bytes for 500 files; it must stay bounded`);
});

// ── A6 · the basis rendered, not merely journalled ──────────────────────────────────────────────
// The alarms printed FILE counts and never the population those files were judged against. A reader
// could not weigh "another session touched 22 files" without knowing whether that came from 2
// sessions or 9, or whether any of it rested on proof.
import { basisNote } from '../gate-tests-core.mjs';

test('the note states evidence and population, not just a file count', () => {
  const n = basisNote({ files: 10, evidenced: 6, unevidenced: 3, sessionsConsidered: 4 });
  assert.match(n, /6 of 10 attributed on WRITE evidence/);
  assert.match(n, /3 on a bare touch/);
  assert.match(n, /4 session\(s\) considered/);
});

test('it says nothing when there is nothing to say — never permanent furniture', () => {
  assert.equal(basisNote({ files: 0 }), '');
  assert.equal(basisNote({}), '');
  assert.equal(basisNote(), '');
});

test('a fully evidenced run omits the bare-touch clause rather than printing a zero', () => {
  const n = basisNote({ files: 5, evidenced: 5, unevidenced: 0, sessionsConsidered: 1 });
  assert.doesNotMatch(n, /bare touch/, 'a clause that always prints stops being read');
  assert.match(n, /5 of 5 attributed on WRITE evidence/);
});

test('it composes from attributionBasis without a shim', () => {
  const who = { mine: ['a'], theirs: ['b'], unknown: [], unevidenced: ['b'], liveSessions: { a: ['s1'], b: ['s2'] } };
  const n = basisNote(attributionBasis(who));
  assert.match(n, /1 of 2 attributed on WRITE evidence/);
  assert.match(n, /2 session\(s\) considered/);
});
