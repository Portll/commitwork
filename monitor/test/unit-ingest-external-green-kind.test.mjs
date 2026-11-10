// Which kind of green an issue has earned (monitor/ingest-external.mjs greenKind).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greenKind } from '../ingest-external.mjs';
import { subjectDigest } from '../ingest-external.mjs';

const now = '2026-01-15T12:00:00.000Z';
const justBefore = '2026-01-15T11:59:59.999Z';
const justAfter = '2026-01-15T12:00:00.001Z';
const digest = 'sha256:subject';

const ruling = (disposition, whoKind, extra = {}) => ({
  disposition,
  whoKind,
  subjectDigest: digest,
  ...extra,
});
const openIssue = (...dispositions) => ({ state: 'open', dispositions });
const classify = (iss) => greenKind(iss, { now, currentDigest: digest });

test('a closed fixed issue with any machine evidence tier is scanner-clean', () => {
  for (const tier of ['strong', 'medium', 'anchor-drift']) {
    const iss = { state: 'closed', closedAs: 'fixed', evidence: [{ tier: 'manual' }, { tier }] };
    assert.equal(greenKind(iss, { now }), 'scanner-clean');
  }
});

test('a closed fixed issue without machine evidence is grey', () => {
  const closed = { state: 'closed', closedAs: 'fixed' };
  const evidence = [{ tier: 'manual' }, { tier: 'scan-absent' }];
  assert.equal(greenKind(closed, { now }), 'grey');
  assert.equal(greenKind({ ...closed, evidence: [] }, { now }), 'grey');
  assert.equal(greenKind({ ...closed, evidence }, { now }), 'grey');
});

test('a closed issue not closed as fixed is human-closed even with machine evidence', () => {
  const evidence = [{ tier: 'strong' }];
  assert.equal(greenKind({ state: 'closed', closedAs: 'wontfix', evidence }, { now }), 'human-closed');
  assert.equal(greenKind({ state: 'closed' }, { now }), 'human-closed');
});

test('an open issue with no ruling in force is open', () => {
  assert.equal(greenKind({ state: 'open' }, { now }), 'open');
  assert.equal(classify(openIssue()), 'open');
  assert.equal(classify(openIssue(ruling('false-positive', 'human', { invalidatedAt: now }))), 'open');
  assert.equal(classify(openIssue(ruling('false-positive', 'human', { expires: now }))), 'open');
  assert.equal(classify(openIssue(ruling('not-applicable', 'human', { expires: justBefore }))), 'open');
});

test('an in-force false-positive or not-applicable ruling from a person is human-green', () => {
  assert.equal(classify(openIssue(ruling('false-positive', 'human'))), 'human-green');
  assert.equal(classify(openIssue(ruling('not-applicable', 'human'))), 'human-green');
  assert.equal(classify(openIssue(ruling('false-positive', 'human', { expires: justAfter }))), 'human-green');
});

test('an in-force remediated claim is claimed-fixed whoever made it', () => {
  assert.equal(classify(openIssue(ruling('remediated', 'human'))), 'claimed-fixed');
  assert.equal(classify(openIssue(ruling('remediated', 'machine'))), 'claimed-fixed');
  const newerClaim = openIssue(ruling('false-positive', 'human'), ruling('remediated', 'machine'));
  assert.equal(classify(newerClaim), 'claimed-fixed');
});

test('an in-force machine ruling with nothing else behind it is agent-proposed', () => {
  assert.equal(classify(openIssue(ruling('false-positive', 'machine'))), 'agent-proposed');
  assert.equal(classify(openIssue(ruling('not-applicable', 'machine'))), 'agent-proposed');
});

test('an earlier in-force ruling from a person keeps a later machine ruling human-green', () => {
  const machine = ruling('not-applicable', 'machine');
  assert.equal(classify(openIssue(ruling('false-positive', 'human'), machine)), 'human-green');
  const expiresLater = ruling('false-positive', 'human', { expires: justAfter });
  assert.equal(classify(openIssue(expiresLater, machine)), 'human-green');
});

test('a person entry that is not an in-force suppressing ruling leaves a machine ruling agent-proposed', () => {
  const machine = ruling('false-positive', 'machine');
  const entries = [
    ruling('remediated', 'human'),
    ruling('false-positive', 'human', { invalidatedAt: now }),
    ruling('false-positive', 'human', { expires: now }),
    ruling('false-positive', 'human', { subjectDigest: 'sha256:moved' }),
  ];
  for (const entry of entries) {
    assert.equal(classify(openIssue(entry, machine)), 'agent-proposed');
  }
});

test('a ruling counts only against the digest of the subject it was made on', () => {
  const subject = { state: 'open', repo: 'commitwork', title: 'lodash 4.17.20', severity: 'high' };
  const own = subjectDigest(subject);
  const current = ruling('false-positive', 'human', { subjectDigest: own });
  const agent = ruling('false-positive', 'machine', { subjectDigest: own });
  const stale = ruling('false-positive', 'human');
  assert.equal(greenKind({ ...subject, dispositions: [current] }, { now }), 'human-green');
  assert.equal(greenKind({ ...subject, dispositions: [stale] }, { now }), 'open');
  assert.equal(greenKind({ ...subject, dispositions: [stale, agent] }, { now }), 'agent-proposed');
  assert.equal(greenKind(openIssue(stale), { now, currentDigest: 'sha256:moved' }), 'open');
  assert.equal(greenKind(openIssue(stale), { now, currentDigest: null }), 'human-green');
});
