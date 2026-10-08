// node --test monitor/test/ — I9: re-grading a closed verdict APPENDS, never rewrites.
//
// WHY THIS NEEDS ITS OWN FUNNEL. mutateIssue already chains an event, so a naive re-grade would
// "have history" — and that is exactly the trap. The event chain would still verify, because a
// rewrite that re-chains is valid. What is lost is the ORIGINAL verdict from the record itself,
// recoverable only by replaying every event.
//
// It matters here because the correction that makes a false-positive rate computable — re-grading
// the 66 machine-inferred `fixed` closures — runs over history, in bulk, by the party being
// measured. Those three properties are the argument for a dedicated path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regradeClosure, classifyDefect, closeIssue, CLOSED_AS, DEFECT_OWNERS } from '../issue-store.mjs';

const AT = '2026-08-27T00:00:00.000Z';
const doc = (over = {}) => ({
  issues: {
    'ISS-1': {
      id: 'ISS-1', state: 'closed', closedAs: 'fixed', severity: 'high', reopenCount: 0,
      updatedAt: AT, ...over,
    },
  },
  events: [],
  nextOrdinal: 1,
});

// ---- the append-only property, which is the whole point ---------------------------------------

test('a re-grade preserves the ORIGINAL verdict in the record, not only in the chain', () => {
  const d = doc();
  regradeClosure(d, 'ISS-1', { to: 'refuted', why: 'auto-close fired on line drift', evidence: 'commit abc123 moved the finding 4 lines', at: AT });
  assert.equal(d.issues['ISS-1'].closedAs, 'refuted', 'the current answer moves — a reader asking "what is this now" must get it');
  assert.equal(d.issues['ISS-1'].closedAsOriginal, 'fixed', 'and the first verdict survives IN THE RECORD');
  assert.equal(d.issues['ISS-1'].regradeCount, 1);
});

test('a SECOND re-grade does not overwrite the first verdict with the second', () => {
  // The subtle one. closedAsOriginal is written once; a naive implementation would set it each time
  // and the true original would be lost after two corrections.
  const d = doc();
  regradeClosure(d, 'ISS-1', { to: 'refuted', why: 'a', evidence: 'e1', at: AT });
  regradeClosure(d, 'ISS-1', { to: 'accepted', why: 'b', evidence: 'e2', at: AT });
  assert.equal(d.issues['ISS-1'].closedAsOriginal, 'fixed', 'still the FIRST verdict, not `refuted`');
  assert.equal(d.issues['ISS-1'].closedAs, 'accepted');
  assert.equal(d.issues['ISS-1'].regradeCount, 2);
});

test('every re-grade appends an event carrying from, to and evidence', () => {
  const d = doc();
  regradeClosure(d, 'ISS-1', { to: 'refuted', why: 'inferred, not observed', evidence: 'sha abc123', by: 'operator', at: AT });
  const ev = d.events.filter((e) => e.type === 'issue-regraded');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].data.from, 'fixed');
  assert.equal(ev[0].data.to, 'refuted');
  assert.equal(ev[0].data.by, 'operator');
  assert.match(ev[0].data.evidence, /abc123/);
});

// ---- the refusals -----------------------------------------------------------------------------

test('a re-grade without evidence is refused — it would be an assertion, not a correction', () => {
  for (const bad of [undefined, null, '', '   ']) {
    assert.throws(() => regradeClosure(doc(), 'ISS-1', { to: 'refuted', why: 'x', evidence: bad, at: AT }), /requires evidence/);
  }
});

test('an OPEN issue cannot be re-graded — it has no verdict to correct', () => {
  const d = doc({ state: 'open', closedAs: null });
  assert.throws(() => regradeClosure(d, 'ISS-1', { to: 'refuted', why: 'x', evidence: 'e', at: AT }), /not closed/);
});

test('re-grading to the SAME verdict is refused — a re-grade must change something', () => {
  assert.throws(() => regradeClosure(doc(), 'ISS-1', { to: 'fixed', why: 'x', evidence: 'e', at: AT }), /already fixed/);
});

test('the target must be a legal verdict, and the vocabulary is the store\'s own', () => {
  assert.throws(() => regradeClosure(doc(), 'ISS-1', { to: 'inferred', why: 'x', evidence: 'e', at: AT }), /must be one of/);
  assert.deepEqual([...CLOSED_AS], ['fixed', 'accepted', 'refuted', 'superseded']);
});

test('an unknown issue throws rather than silently creating one', () => {
  assert.throws(() => regradeClosure(doc(), 'ISS-NOPE', { to: 'refuted', why: 'x', evidence: 'e', at: AT }), /unknown issue/);
});

// ---- defect classification --------------------------------------------------------------------

test('classification records WHO decided and on WHAT BASIS, never as a bare fact', () => {
  const d = doc();
  classifyDefect(d, 'ISS-1', { owner: 'instrument', basis: 'commit', evidence: 'fixed by c0ffee1 in commitwork', by: 'operator', at: AT });
  assert.equal(d.issues['ISS-1'].defectOwner, 'instrument');
  assert.equal(d.issues['ISS-1'].defectBasis, 'commit');
  const ev = d.events.filter((e) => e.type === 'issue-classified');
  assert.equal(ev[0].data.basis, 'commit');
  assert.equal(ev[0].data.from, null, 'the prior classification is recorded even when there was none');
});

test('BASIS SEPARATES A LOOKUP FROM AN OPINION — the distinction a rate must be able to state', () => {
  // Where a refuted finding was closed because commitwork shipped a fix, that fix has a sha and the
  // classification is DERIVED. Where it was judged, it is an opinion by the party being measured.
  // A rate that cannot say how much of its input was which is not a rate anyone should trust.
  const d = doc();
  assert.throws(() => classifyDefect(d, 'ISS-1', { owner: 'instrument', basis: 'vibes', evidence: 'e', at: AT }), /requires basis/);
  assert.throws(() => classifyDefect(d, 'ISS-1', { owner: 'instrument', evidence: 'e', at: AT }), /requires basis/);
  for (const b of ['commit', 'adjudication', 'model-agreement']) {
    assert.doesNotThrow(() => classifyDefect(doc(), 'ISS-1', { owner: 'upstream', basis: b, evidence: 'e', at: AT }));
  }
});

test('a changed classification leaves a trace in the record, not only in the chain', () => {
  const d = doc();
  classifyDefect(d, 'ISS-1', { owner: 'undetermined', basis: 'adjudication', evidence: 'e1', at: AT });
  classifyDefect(d, 'ISS-1', { owner: 'upstream', basis: 'commit', evidence: 'e2', at: AT });
  assert.equal(d.issues['ISS-1'].classifyCount, 2, 'a rate must be able to say how many were revised');
  assert.equal(d.issues['ISS-1'].defectOwner, 'upstream');
  assert.equal(d.events.filter((e) => e.type === 'issue-classified')[1].data.from, 'undetermined');
});

test('undetermined is a LEGAL owner, not an absence', () => {
  assert.ok(DEFECT_OWNERS.includes('undetermined'));
  const d = doc();
  assert.doesNotThrow(() => classifyDefect(d, 'ISS-1', { owner: 'undetermined', basis: 'adjudication', evidence: 'two models disagreed', at: AT }));
  assert.equal(d.issues['ISS-1'].defectOwner, 'undetermined', 'the common and correct state must be recordable');
});

test('classification refuses an owner outside the vocabulary, and refuses no evidence', () => {
  assert.throws(() => classifyDefect(doc(), 'ISS-1', { owner: 'ours', basis: 'commit', evidence: 'e', at: AT }), /must be one of/);
  assert.throws(() => classifyDefect(doc(), 'ISS-1', { owner: 'instrument', basis: 'commit', evidence: '  ', at: AT }), /requires evidence/);
});

// ---- non-vacuity -------------------------------------------------------------------------------

test('NOT VACUOUS: an issue never re-graded carries neither marker', () => {
  // Without this, every assertion above would pass on an implementation that set the fields
  // unconditionally at close time.
  const d = doc();
  assert.equal(d.issues['ISS-1'].closedAsOriginal, undefined);
  assert.equal(d.issues['ISS-1'].regradeCount, undefined);
  assert.equal(d.issues['ISS-1'].defectOwner, undefined);
});

test('a classification does NOT re-grade, and a re-grade does NOT classify', () => {
  // Two orthogonal facts. Conflating them would make "we decided this was our bug" imply "and
  // therefore the verdict changes", which is a different decision needing its own evidence.
  const a = doc();
  classifyDefect(a, 'ISS-1', { owner: 'instrument', basis: 'commit', evidence: 'e', at: AT });
  assert.equal(a.issues['ISS-1'].closedAs, 'fixed', 'the verdict is untouched');
  const b = doc();
  regradeClosure(b, 'ISS-1', { to: 'refuted', why: 'x', evidence: 'e', at: AT });
  assert.equal(b.issues['ISS-1'].defectOwner, undefined, 'the owner is untouched');
});
