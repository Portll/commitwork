// node --test monitor/test/ — I7: who closed a finding, and whether a rate may use it.
//
// TWO DEFECTS THIS PINS, AND THE SECOND WAS MINE.
//
// 1. The auto-close gate writes `auto:true` into the EVENT and never onto the issue, so a reader of
//    issues.json sees `closedAs:'fixed'` and cannot tell a machine inference from a human verdict.
//    50-odd closures are machine-inferred by a gate that once reported 8 findings FIXED when they
//    had merely shifted lines.
//
// 2. The first version of rateBase() emitted falsePositives/n whenever both sides were non-zero.
//    On the live store that produced 0.9927 — from 136 refutations against ONE human-confirmed true
//    positive. A selection artefact wearing a measurement's clothes, produced by the module written
//    to prevent exactly that. The guard is now `sampling`, and the default is the honest one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closureProvenance, rateBase } from '../closure-provenance.mjs';

const closed = (id, closedAs) => [id, { id, state: 'closed', closedAs }];
const ev = (issueId, data) => ({ type: 'issue-closed', issueId, data });
const doc = (issues, events) => ({ issues: Object.fromEntries(issues), events });

// ---- provenance, derived from the chain ---------------------------------------------------------

test('an auto flag makes the closure machine-inferred', () => {
  const p = closureProvenance([ev('A', { closedAs: 'fixed', auto: true })], 'A');
  assert.equal(p.provenance, 'auto');
  assert.match(p.why, /auto-close gate/);
});

test('recorded evidence makes it human', () => {
  assert.equal(closureProvenance([ev('A', { closedAs: 'refuted', evidence: 'a real reason' })], 'A').provenance, 'human');
});

test('ABSENCE OF THE FLAG IS NOT PROOF OF A HUMAN — it reads unmarked', () => {
  // An older event shape may simply not have carried `auto`. Reading absence as "human" would
  // silently promote machine inferences into the confirmed-true side of a rate.
  const p = closureProvenance([ev('A', { closedAs: 'fixed' })], 'A');
  assert.equal(p.provenance, 'unmarked');
  assert.notEqual(p.provenance, 'human');
});

test('blank evidence is not evidence', () => {
  assert.equal(closureProvenance([ev('A', { closedAs: 'fixed', evidence: '   ' })], 'A').provenance, 'unmarked');
});

test('the LAST close wins when an issue was closed, reopened and closed again', () => {
  const p = closureProvenance([
    ev('A', { closedAs: 'fixed', auto: true }),
    ev('A', { closedAs: 'refuted', evidence: 'human looked again' }),
  ], 'A');
  assert.equal(p.provenance, 'human');
  assert.equal(p.closedAs, 'refuted');
});

test('no close event at all is `none`, never a default verdict', () => {
  assert.equal(closureProvenance([], 'A').provenance, 'none');
});

// ---- THE GUARD: a computable number is not a measurable one --------------------------------------

test('NO RATE WITHOUT DECLARED RANDOM SAMPLING — even when both sides are non-empty', () => {
  // This is the exact live shape: 136 refuted against 1 human-fixed. The ratio is computable and
  // must not be emitted, because the denominator was a selection rather than a sample.
  const issues = [...Array(136)].map((_, i) => closed(`R${i}`, 'refuted')).concat([closed('F', 'fixed')]);
  const events = [...Array(136)].map((_, i) => ev(`R${i}`, { closedAs: 'refuted', evidence: 'looked wrong' }))
    .concat([ev('F', { closedAs: 'fixed', evidence: 'a human fixed it' })]);
  const { report } = rateBase(doc(issues, events));
  assert.equal(report.falsePositives, 136);
  assert.equal(report.truePositives, 1);
  assert.equal(report.rate, null, 'the number is computable and must stay unpublished');
  assert.equal(report.sampling, 'opportunistic', 'the DEFAULT is the honest one');
  assert.match(report.rateWhy, /selection rather than a sample/);
});

test('declaring random sampling is what unlocks a rate — an explicit act, never a default', () => {
  const issues = [closed('A', 'refuted'), closed('B', 'accepted')];
  const events = [ev('A', { closedAs: 'refuted', evidence: 'e' }), ev('B', { closedAs: 'accepted', evidence: 'e' })];
  assert.equal(rateBase(doc(issues, events)).report.rate, null, 'not by default');
  assert.equal(rateBase(doc(issues, events), { sampling: 'random' }).report.rate, 0.5, 'only when declared');
});

test('a one-sided set yields null even under random sampling', () => {
  const issues = [closed('A', 'refuted')];
  const events = [ev('A', { closedAs: 'refuted', evidence: 'e' })];
  const { report } = rateBase(doc(issues, events), { sampling: 'random' });
  assert.equal(report.rate, null);
  assert.match(report.rateWhy, /needs confirmed-true findings on the other side/);
});

// ---- what is excluded, and why, counted rather than dropped --------------------------------------

test('a machine-inferred `fixed` is EXCLUDED from the base, not counted as a true positive', () => {
  const { report, excluded } = rateBase(doc(
    [closed('A', 'fixed')],
    [ev('A', { closedAs: 'fixed', auto: true })],
  ));
  assert.equal(report.truePositives, 0, 'an inferred absence is not a confirmed finding');
  assert.equal(report.excludedFixedAuto, 1);
  assert.deepEqual(excluded.fixedAuto, ['A']);
});

test('a HUMAN `fixed` IS a confirmed true positive', () => {
  const { report } = rateBase(doc([closed('A', 'fixed')], [ev('A', { closedAs: 'fixed', evidence: 'I fixed it' })]));
  assert.equal(report.truePositives, 1);
  assert.equal(report.excludedFixedAuto, 0);
});

test('superseded is a bookkeeping merge, never a verdict about truth', () => {
  const { report } = rateBase(doc([closed('A', 'superseded')], [ev('A', { closedAs: 'superseded', evidence: 'dupe' })]));
  assert.equal(report.eligibleForRate, 0);
  assert.equal(report.excludedSuperseded, 1);
});

test('every issue lands in exactly one bucket — nothing is silently dropped', () => {
  const issues = [closed('A', 'refuted'), closed('B', 'fixed'), closed('C', 'superseded'),
    ['D', { id: 'D', state: 'open', closedAs: null }]];
  const events = [ev('A', { closedAs: 'refuted', evidence: 'e' }), ev('B', { closedAs: 'fixed', auto: true }),
    ev('C', { closedAs: 'superseded', evidence: 'e' })];
  const { report } = rateBase(doc(issues, events));
  const total = report.eligibleForRate + report.excludedFixedAuto + report.excludedSuperseded
    + report.excludedUnmarked + report.stillOpen;
  assert.equal(total, report.totalIssues, 'a rate over a lossy split is fabricated');
});

// ---- non-vacuity -----------------------------------------------------------------------------------

test('NOT VACUOUS: random sampling with real counts DOES emit a rate', () => {
  // Without this, every null-returning assertion above would pass on a function that never computes.
  const issues = [...Array(3)].map((_, i) => closed(`R${i}`, 'refuted')).concat([closed('A', 'accepted')]);
  const events = [...Array(3)].map((_, i) => ev(`R${i}`, { closedAs: 'refuted', evidence: 'e' }))
    .concat([ev('A', { closedAs: 'accepted', evidence: 'e' })]);
  assert.equal(rateBase(doc(issues, events), { sampling: 'random' }).report.rate, 0.75);
});

test('an empty store yields nulls and zeroes, never a fabricated 0% or 100%', () => {
  const { report } = rateBase(doc([], []), { sampling: 'random' });
  assert.equal(report.rate, null);
  assert.equal(report.eligibleForRate, 0);
  assert.match(report.rateWhy, /nothing to compute a rate over/);
});
