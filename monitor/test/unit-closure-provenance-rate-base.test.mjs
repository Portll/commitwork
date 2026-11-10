// Rate-eligible verdict buckets, exclusions and a gated false-positive rate (monitor/closure-provenance.mjs rateBase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateBase } from '../closure-provenance.mjs';

const close = (issueId, data) => ({ type: 'issue-closed', issueId, data });
const closedIssues = (ids) => Object.fromEntries(ids.map((id) => [id, { state: 'closed' }]));
const selectionWhy = (sampling, fp, tp) => `sampling is '${sampling}' \u2014 findings were adjudicated because they looked wrong, so the eligible set is a selection rather than a sample. ${fp} refuted and ${tp} confirmed-true is the honest statement; a ratio over them would measure who chose what to look at.`;
const emptyEligible = { refuted: [], accepted: [], fixedHuman: [] };
const emptyExcluded = { fixedAuto: [], superseded: [], unmarked: [], open: [] };

test('A null document yields empty buckets, zero counts and the opportunistic refusal', () => {
  assert.deepEqual(rateBase(null), {
    eligible: emptyEligible,
    excluded: emptyExcluded,
    report: {
      totalIssues: 0, eligibleForRate: 0, falsePositives: 0, truePositives: 0,
      excludedFixedAuto: 0, excludedSuperseded: 0, excludedUnmarked: 0, stillOpen: 0,
      rate: null, sampling: 'opportunistic', rateWhy: selectionWhy('opportunistic', 0, 0),
    },
  });
});

test('Random sampling with no human verdict reports that there is nothing to rate', () => {
  const doc = {
    events: [close('a', { closedAs: 'fixed', auto: true }), close('b', { closedAs: 'superseded', evidence: 'dup' })],
    issues: closedIssues(['a', 'b']),
  };
  const r = rateBase(doc, { sampling: 'random' });
  assert.deepEqual(r.eligible, emptyEligible);
  assert.deepEqual(r.excluded, { fixedAuto: ['a'], superseded: ['b'], unmarked: [], open: [] });
  assert.deepEqual(r.report, {
    totalIssues: 2, eligibleForRate: 0, falsePositives: 0, truePositives: 0,
    excludedFixedAuto: 1, excludedSuperseded: 1, excludedUnmarked: 0, stillOpen: 0,
    rate: null, sampling: 'random',
    rateWhy: 'no closure carries a human true/false verdict \u2014 there is nothing to compute a rate over',
  });
});

test('Non-random sampling withholds the rate even when both sides have verdicts', () => {
  const doc = {
    events: [close('a', { closedAs: 'refuted', evidence: 'e' }), close('b', { closedAs: 'accepted', evidence: 'e' })],
    issues: closedIssues(['a', 'b']),
  };
  const r = rateBase(doc, { sampling: 'convenience' });
  assert.deepEqual(r.eligible, { refuted: ['a'], accepted: ['b'], fixedHuman: [] });
  assert.deepEqual(r.excluded, emptyExcluded);
  assert.deepEqual(r.report, {
    totalIssues: 2, eligibleForRate: 2, falsePositives: 1, truePositives: 1,
    excludedFixedAuto: 0, excludedSuperseded: 0, excludedUnmarked: 0, stillOpen: 0,
    rate: null, sampling: 'convenience', rateWhy: selectionWhy('convenience', 1, 1),
  });
});

test('Random sampling computes the refuted share rounded to four decimals', () => {
  const doc = {
    events: [
      close('a', { closedAs: 'refuted', evidence: 'e' }),
      close('b', { closedAs: 'accepted', evidence: 'e' }),
      close('c', { closedAs: 'fixed', evidence: 'commit abc' }),
    ],
    issues: closedIssues(['a', 'b', 'c']),
  };
  const r = rateBase(doc, { sampling: 'random' });
  assert.deepEqual(r.eligible, { refuted: ['a'], accepted: ['b'], fixedHuman: ['c'] });
  assert.deepEqual(r.excluded, emptyExcluded);
  assert.deepEqual(r.report, {
    totalIssues: 3, eligibleForRate: 3, falsePositives: 1, truePositives: 2,
    excludedFixedAuto: 0, excludedSuperseded: 0, excludedUnmarked: 0, stillOpen: 0,
    rate: 0.3333, sampling: 'random', rateWhy: null,
  });
});

test('Random sampling with exactly one confirmed-true closure gives a rate of zero', () => {
  const doc = { events: [close('a', { closedAs: 'accepted', evidence: 'e' })], issues: closedIssues(['a']) };
  const r = rateBase(doc, { sampling: 'random' });
  assert.deepEqual(r.eligible, { refuted: [], accepted: ['a'], fixedHuman: [] });
  assert.equal(r.report.eligibleForRate, 1);
  assert.equal(r.report.rate, 0);
  assert.equal(r.report.rateWhy, null);
});

test('Random sampling where every verdict is a refutation explains why no rate exists', () => {
  const ids = Array.from({ length: 3 }, (_, i) => `r${i}`);
  const doc = { events: ids.map((id) => close(id, { closedAs: 'refuted', evidence: 'no repro' })), issues: closedIssues(ids) };
  const r = rateBase(doc, { sampling: 'random' });
  assert.deepEqual(r.eligible, { refuted: ['r0', 'r1', 'r2'], accepted: [], fixedHuman: [] });
  assert.deepEqual(r.report, {
    totalIssues: 3, eligibleForRate: 3, falsePositives: 3, truePositives: 0,
    excludedFixedAuto: 0, excludedSuperseded: 0, excludedUnmarked: 0, stillOpen: 0,
    rate: null, sampling: 'random',
    rateWhy: 'every eligible closure is a refutation (3 of 3); a rate needs confirmed-true findings on the other side, and none exist',
  });
});

test('Open, missing, superseded, unmarked, auto-fixed and unknown closures are excluded and the last close wins', () => {
  const doc = {
    events: [
      close('sup', { closedAs: 'superseded' }),
      close('unm', { closedAs: 'refuted' }),
      close('blank', { closedAs: 'accepted', evidence: '   ' }),
      close('auto', { closedAs: 'fixed', auto: true }),
      close('other', { closedAs: 'wontfix', evidence: 'e' }),
      { type: 'issue-opened', issueId: 'none', data: { closedAs: 'accepted', evidence: 'e' } },
      close('last', { closedAs: 'refuted', evidence: 'e' }),
      close('last', { closedAs: 'accepted', evidence: 'e' }),
    ],
    issues: { open1: { state: 'open' }, gone: null, ...closedIssues(['sup', 'unm', 'blank', 'auto', 'other', 'none', 'last']) },
  };
  const r = rateBase(doc, { sampling: 'random' });
  assert.deepEqual(r.eligible, { refuted: [], accepted: ['last'], fixedHuman: [] });
  assert.deepEqual(r.excluded, {
    fixedAuto: ['auto'], superseded: ['sup'], unmarked: ['unm', 'blank', 'other', 'none'], open: ['open1', 'gone'],
  });
  assert.deepEqual(r.report, {
    totalIssues: 9, eligibleForRate: 1, falsePositives: 0, truePositives: 1,
    excludedFixedAuto: 1, excludedSuperseded: 1, excludedUnmarked: 4, stillOpen: 2,
    rate: 0, sampling: 'random', rateWhy: null,
  });
});
