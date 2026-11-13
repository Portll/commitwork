// lib/test/remediation-verify.test.mjs — the verification decision: one case per branch with its
// exact object, the precedence between branches, the malformed inputs that must throw rather than
// become a status, and the property that every branch's object validates inside a real candidate.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRemediation, validateRemediation } from '../remediation-contract.mjs';
import { verificationFor, verifyCombined } from '../remediation-verify.mjs';

const AT = '2026-11-09T10:00:00Z';
const ID = 'sc|sastGitleaks|generic-api-key|src/config.js';
const OTHER = 'sc|sastSemgrep|other|src/config.js';
const NEW_A = 'sc|sastSemgrep|a|src/config.js';
const NEW_Z = 'sc|sastSemgrep|z|src/config.js';
const PATCH = '--- a/src/config.js\n+++ b/src/config.js\n@@ -1 +1 @@\n-  apiKey: "k",\n+  apiKey: env.API_KEY,\n';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const PROVENANCE = { tool: 'commitwork', model: null, version: '0.6.174' };

const BEFORE = { lanes: ['sastGitleaks'], count: 1 };
const TESTS = { command: 'node --test', status: 'passed' };
const NO_TESTS = { command: null, status: 'notDeclared' };

const rerunOf = (over = {}) => ({
  ran: true,
  lanes: ['sastGitleaks'],
  identities: [],
  newIdentities: [],
  digest: null,
  ...over,
});

const documentWith = (verification) => buildRemediation({
  repository: 'org/repo',
  commit: 'b'.repeat(40),
  generatedAt: AT,
  toolVersion: '0.6.174',
  findings: [{
    identity: ID,
    occurrence: 0,
    ruleId: 'sastGitleaks/generic-api-key',
    lane: 'sastGitleaks',
    file: 'src/config.js',
    severity: 'high',
    candidates: [{ tier: 'deterministic', provenance: PROVENANCE, patch: PATCH, cached: true, verification }],
    actions: [],
  }],
});

// ── the branches, in decision order ─────────────────────────────────────────────────────────────

test('a re-run that was never attempted is unverified and claims no witness', () => {
  assert.deepEqual(verificationFor({ identity: ID, before: BEFORE, rerun: null, tests: NO_TESTS }), {
    status: 'unverified',
    witness: { lanes: [], before: 1, after: null, digest: null },
    newFindings: [],
    tests: { command: null, status: 'notDeclared' },
    reason: null,
  });
});

test('a re-run that did not run is undetermined with the reason it gave', () => {
  const rerun = { ran: false, reason: 'the scanner binary was absent', lanes: ['sastGitleaks'], identities: [], newIdentities: [] };
  assert.deepEqual(verificationFor({ identity: ID, before: BEFORE, rerun, tests: TESTS }), {
    status: 'undetermined',
    witness: { lanes: ['sastGitleaks'], before: 1, after: null, digest: null },
    newFindings: [],
    tests: { command: 'node --test', status: 'passed' },
    reason: 'the scanner binary was absent',
  });
});

test('a finding that was not present before the fix is undetermined, whatever the re-run saw', () => {
  assert.deepEqual(verificationFor({
    identity: ID,
    before: { lanes: ['sastGitleaks'], count: 0 },
    rerun: rerunOf({ lanes: ['sastGitleaks', 'sastSemgrep', 'sastGitleaks'], newIdentities: [NEW_A], digest: DIGEST }),
    tests: TESTS,
  }), {
    status: 'undetermined',
    witness: { lanes: ['sastGitleaks', 'sastSemgrep'], before: 0, after: null, digest: DIGEST },
    newFindings: [NEW_A],
    tests: { command: 'node --test', status: 'passed' },
    reason: 'the finding was not present before the fix, so its absence afterwards shows nothing',
  });
});

test('an identity still reported after the patch is failed', () => {
  assert.deepEqual(verificationFor({
    identity: ID, before: BEFORE, rerun: rerunOf({ identities: [OTHER, ID] }), tests: TESTS,
  }), {
    status: 'failed',
    witness: { lanes: ['sastGitleaks'], before: 1, after: 1, digest: null },
    newFindings: [],
    tests: { command: 'node --test', status: 'passed' },
    reason: 'the identity is still present after the patch',
  });
});

test('a new identity in the touched files is failed, listed sorted', () => {
  assert.deepEqual(verificationFor({
    identity: ID, before: BEFORE, rerun: rerunOf({ newIdentities: [NEW_Z, NEW_A] }), tests: TESTS,
  }), {
    status: 'failed',
    witness: { lanes: ['sastGitleaks'], before: 1, after: 0, digest: null },
    newFindings: [NEW_A, NEW_Z],
    tests: { command: 'node --test', status: 'passed' },
    reason: `new findings appeared in the touched files: ${NEW_A}, ${NEW_Z}`,
  });
});

test('a failed test command is failed even when the lane found nothing', () => {
  assert.deepEqual(verificationFor({
    identity: ID, before: BEFORE, rerun: rerunOf(), tests: { command: 'node --test', status: 'failed' },
  }), {
    status: 'failed',
    witness: { lanes: ['sastGitleaks'], before: 1, after: 0, digest: null },
    newFindings: [],
    tests: { command: 'node --test', status: 'failed' },
    reason: 'the test command failed',
  });
});

test('a declared test command that did not run is undetermined, not verified', () => {
  assert.deepEqual(verificationFor({
    identity: ID, before: BEFORE, rerun: rerunOf(), tests: { command: 'node --test', status: 'notRun' },
  }), {
    status: 'undetermined',
    witness: { lanes: ['sastGitleaks'], before: 1, after: null, digest: null },
    newFindings: [],
    tests: { command: 'node --test', status: 'notRun' },
    reason: 'the declared test command did not run',
  });
});

test('an identity gone, nothing new and the tests passing is verified', () => {
  assert.deepEqual(verificationFor({
    identity: ID,
    before: { lanes: ['sastGitleaks', 'sastSemgrep'], count: 2 },
    rerun: rerunOf({ lanes: ['sastSemgrep', 'sastGitleaks', 'sastSemgrep'], identities: [OTHER], digest: DIGEST }),
    tests: TESTS,
  }), {
    status: 'verified',
    witness: { lanes: ['sastGitleaks', 'sastSemgrep'], before: 2, after: 0, digest: DIGEST },
    newFindings: [],
    tests: { command: 'node --test', status: 'passed' },
    reason: null,
  });
});

// ── precedence between branches ────────────────────────────────────────────────────────────────

test('a re-run that did not run outranks a failed test and a still-present identity: undetermined', () => {
  const rerun = { ran: false, reason: 'the lane crashed', lanes: ['sastGitleaks'], identities: [ID], newIdentities: [NEW_A] };
  const got = verificationFor({ identity: ID, before: BEFORE, rerun, tests: { command: 'node --test', status: 'failed' } });
  assert.equal(got.status, 'undetermined');
  assert.equal(got.reason, 'the lane crashed');
  assert.equal(got.witness.after, null);
});

test('a finding absent before the fix outranks a failed test: undetermined', () => {
  const got = verificationFor({
    identity: ID, before: { lanes: [], count: 0 }, rerun: rerunOf(), tests: { command: 'node --test', status: 'failed' },
  });
  assert.equal(got.status, 'undetermined');
  assert.equal(got.reason, 'the finding was not present before the fix, so its absence afterwards shows nothing');
  assert.equal(got.witness.after, null);
});

test('a measured failure outranks a declared test command that did not run: failed', () => {
  const got = verificationFor({
    identity: ID, before: BEFORE, rerun: rerunOf({ identities: [ID] }), tests: { command: 'node --test', status: 'notRun' },
  });
  assert.equal(got.status, 'failed');
  assert.equal(got.reason, 'the identity is still present after the patch');
  assert.equal(got.witness.after, 1);
});

test('every applicable failed cause is named in the contract order, joined by "; "', () => {
  const got = verificationFor({
    identity: ID,
    before: BEFORE,
    rerun: rerunOf({ identities: [ID], newIdentities: [NEW_Z, NEW_A] }),
    tests: { command: 'node --test', status: 'failed' },
  });
  assert.equal(got.reason, `the identity is still present after the patch; new findings appeared in the touched files: ${NEW_A}, ${NEW_Z}; the test command failed`);
  assert.deepEqual(got.newFindings, [NEW_A, NEW_Z]);
});

// ── malformed input throws, naming the field ───────────────────────────────────────────────────

test('a missing identity is refused', () => {
  assert.throws(() => verificationFor({ before: BEFORE, rerun: null, tests: NO_TESTS }),
    { name: 'TypeError', message: /identity/ });
});

test('a non-integer before.count is refused', () => {
  assert.throws(() => verificationFor({ identity: ID, before: { lanes: ['sastGitleaks'], count: '1' }, rerun: null, tests: NO_TESTS }),
    { name: 'TypeError', message: /before\.count/ });
});

test('a negative before.count is refused', () => {
  assert.throws(() => verificationFor({ identity: ID, before: { lanes: ['sastGitleaks'], count: -1 }, rerun: null, tests: NO_TESTS }),
    { name: 'TypeError', message: /before\.count/ });
});

test('an unknown tests.status is refused', () => {
  assert.throws(() => verificationFor({ identity: ID, before: BEFORE, rerun: null, tests: { command: 'node --test', status: 'maybe' } }),
    { name: 'TypeError', message: /tests\.status/ });
});

test('tests "notDeclared" with a command is refused', () => {
  assert.throws(() => verificationFor({ identity: ID, before: BEFORE, rerun: null, tests: { command: 'node --test', status: 'notDeclared' } }),
    { name: 'TypeError', message: /tests\.command/ });
});

test('tests "passed" without a command is refused', () => {
  assert.throws(() => verificationFor({ identity: ID, before: BEFORE, rerun: null, tests: { command: null, status: 'passed' } }),
    { name: 'TypeError', message: /tests\.command/ });
});

test('an omitted rerun is refused rather than read as "never attempted"', () => {
  assert.throws(() => verificationFor({ identity: ID, before: BEFORE, tests: NO_TESTS }),
    { name: 'TypeError', message: /rerun/ });
});

test('a non-array rerun.identities is refused', () => {
  assert.throws(() => verificationFor({ identity: ID, before: BEFORE, rerun: { ran: true, lanes: ['sastGitleaks'], identities: OTHER, newIdentities: [] }, tests: NO_TESTS }),
    { name: 'TypeError', message: /rerun\.identities/ });
});

test('a re-run that did not run without a reason is refused', () => {
  assert.throws(() => verificationFor({ identity: ID, before: BEFORE, rerun: { ran: false, reason: '   ' }, tests: NO_TESTS }),
    { name: 'TypeError', message: /rerun\.reason/ });
});

test('a re-run that ran but named no lane is refused: its witness would prove nothing', () => {
  assert.throws(() => verificationFor({ identity: ID, before: BEFORE, rerun: { ran: true, lanes: [], identities: [], newIdentities: [] }, tests: NO_TESTS }),
    { name: 'TypeError', message: /rerun\.lanes/ });
});

// ── the combined patch ────────────────────────────────────────────────────────────────────────

const INCLUDED = [
  { identity: ID, occurrence: 0, candidateId: '0123456789abcdef', files: ['src/config.js'] },
  { identity: OTHER, occurrence: 0, candidateId: 'fedcba9876543210', files: ['src/config.js'] },
];

const combinedRerun = (over = {}) => ({ ran: true, lanes: ['sastGitleaks', 'sastSemgrep'], identities: [], newIdentities: [], ...over });

test('an empty inclusion is undetermined: there is no combination to judge', () => {
  assert.deepEqual(verifyCombined({ included: [], rerun: combinedRerun(), tests: TESTS }), {
    status: 'undetermined', reason: 'no fix was included', stillPresent: [], newFindings: [],
  });
});

test('a combined patch that was never re-run is undetermined', () => {
  assert.deepEqual(verifyCombined({ included: INCLUDED, rerun: null, tests: TESTS }), {
    status: 'undetermined', reason: 'the re-run was never attempted', stillPresent: [], newFindings: [],
  });
});

test('a combined re-run that did not run is undetermined with its reason', () => {
  assert.deepEqual(verifyCombined({
    included: INCLUDED, tests: TESTS,
    rerun: { ran: false, reason: 'the lane timed out', lanes: ['sastGitleaks'], identities: [ID], newIdentities: [] },
  }), {
    status: 'undetermined', reason: 'the lane timed out', stillPresent: [], newFindings: [],
  });
});

test('an included identity still reported after the combined patch is failed, sorted unique', () => {
  assert.deepEqual(verifyCombined({
    included: [INCLUDED[1], INCLUDED[0], { ...INCLUDED[0] }].reverse(),
    tests: TESTS,
    rerun: combinedRerun({ identities: [OTHER, ID, OTHER] }),
  }), {
    status: 'failed',
    reason: `included identities are still present after the combined patch: ${ID}, ${OTHER}`,
    stillPresent: [ID, OTHER],
    newFindings: [],
  });
});

test('a new identity after the combined patch is failed', () => {
  assert.deepEqual(verifyCombined({ included: INCLUDED, rerun: combinedRerun({ newIdentities: [NEW_Z, NEW_A] }), tests: TESTS }), {
    status: 'failed',
    reason: `new findings appeared in the touched files: ${NEW_A}, ${NEW_Z}`,
    stillPresent: [],
    newFindings: [NEW_A, NEW_Z],
  });
});

test('a failed test command after the combined patch is failed', () => {
  assert.deepEqual(verifyCombined({ included: INCLUDED, rerun: combinedRerun(), tests: { command: 'node --test', status: 'failed' } }), {
    status: 'failed', reason: 'the test command failed', stillPresent: [], newFindings: [],
  });
});

test('a combined patch with every included identity gone and tests passing is verified', () => {
  assert.deepEqual(verifyCombined({ included: INCLUDED, rerun: combinedRerun({ identities: [NEW_A] }), tests: TESTS }), {
    status: 'verified', reason: null, stillPresent: [], newFindings: [],
  });
});

test('a declared test command that did not run leaves the combination undetermined', () => {
  assert.deepEqual(verifyCombined({ included: INCLUDED, rerun: combinedRerun(), tests: { command: 'node --test', status: 'notRun' } }), {
    status: 'undetermined', reason: 'the declared test command did not run', stillPresent: [], newFindings: [],
  });
});

test('a still-present identity outranks a declared test command that did not run: failed', () => {
  const got = verifyCombined({ included: INCLUDED, rerun: combinedRerun({ identities: [ID] }), tests: { command: 'node --test', status: 'notRun' } });
  assert.equal(got.status, 'failed');
  assert.deepEqual(got.stillPresent, [ID]);
});

test('verifyCombined refuses an included entry without an identity', () => {
  assert.throws(() => verifyCombined({ included: [{ files: [] }], rerun: combinedRerun(), tests: NO_TESTS }),
    { name: 'TypeError', message: /included\[0\]\.identity/ });
});

test('verifyCombined refuses a combined re-run that did not run without a reason', () => {
  assert.throws(() => verifyCombined({ included: INCLUDED, rerun: { ran: false }, tests: NO_TESTS }),
    { name: 'TypeError', message: /rerun\.reason/ });
});

// ── the property: every branch produces a candidate the contract accepts ──────────────────────

const BRANCHES = [
  ['unverified', () => verificationFor({ identity: ID, before: BEFORE, rerun: null, tests: NO_TESTS })],
  ['undetermined: re-run did not run', () => verificationFor({
    identity: ID, before: BEFORE, tests: TESTS,
    rerun: { ran: false, reason: 'the scanner binary was absent', lanes: ['sastGitleaks'], identities: [], newIdentities: [] },
  })],
  ['undetermined: finding was not present before', () => verificationFor({
    identity: ID, before: { lanes: ['sastGitleaks'], count: 0 }, rerun: rerunOf({ newIdentities: [NEW_A] }), tests: TESTS,
  })],
  ['undetermined: the reporting lane did not re-run', () => verificationFor({
    identity: ID, before: BEFORE, rerun: rerunOf({ lanes: ['sastSemgrep'] }), tests: TESTS,
  })],
  ['undetermined: declared tests did not run', () => verificationFor({
    identity: ID, before: BEFORE, rerun: rerunOf(), tests: { command: 'node --test', status: 'notRun' },
  })],
  ['failed: identity still present', () => verificationFor({ identity: ID, before: BEFORE, rerun: rerunOf({ identities: [ID] }), tests: TESTS })],
  ['failed: new identity', () => verificationFor({ identity: ID, before: BEFORE, rerun: rerunOf({ newIdentities: [NEW_A] }), tests: TESTS })],
  ['failed: tests failed', () => verificationFor({
    identity: ID, before: BEFORE, rerun: rerunOf(), tests: { command: 'node --test', status: 'failed' },
  })],
  ['verified', () => verificationFor({ identity: ID, before: BEFORE, rerun: rerunOf({ identities: [OTHER] }), tests: TESTS })],
];

test('every decision branch yields a verification object validateRemediation accepts', () => {
  for (const [name, make] of BRANCHES) {
    assert.deepEqual(validateRemediation(documentWith(make())).errors, [], `${name} did not validate`);
  }
});

test('an identity is not shown gone by a re-run that skipped the lane that reported it', () => {
  const v = verificationFor({ identity: ID, before: BEFORE, rerun: rerunOf({ lanes: ['sastSemgrep'], digest: DIGEST }), tests: TESTS });
  assert.deepEqual(v, {
    status: 'undetermined',
    witness: { lanes: ['sastSemgrep'], before: 1, after: null, digest: DIGEST },
    newFindings: [],
    tests: TESTS,
    reason: 'a lane that reported the finding did not re-run: sastGitleaks',
  });
});

test('every lane that ran before must re-run, and the missing ones are named sorted', () => {
  const before = { lanes: ['sastSemgrep', 'sastGitleaks', 'depsOsv'], count: 2 };
  const v = verificationFor({ identity: ID, before, rerun: rerunOf({ lanes: ['sastGitleaks'] }), tests: TESTS });
  assert.equal(v.status, 'undetermined');
  assert.equal(v.reason, 'a lane that reported the finding did not re-run: depsOsv, sastSemgrep');
  assert.equal(verificationFor({ identity: ID, before, rerun: rerunOf({ lanes: ['depsOsv', 'sastGitleaks', 'sastSemgrep', 'extra'] }), tests: TESTS }).status, 'verified');
});

test('failure the other lanes measured stands even when the reporting lane was skipped', () => {
  const v = verificationFor({ identity: ID, before: BEFORE, rerun: rerunOf({ lanes: ['sastSemgrep'], newIdentities: [NEW_A] }), tests: { command: 'node --test', status: 'failed' } });
  assert.equal(v.status, 'failed');
  assert.equal(v.reason, `new findings appeared in the touched files: ${NEW_A}; the test command failed`);
});

test('a skipped reporting lane outranks a declared test command that did not run', () => {
  const v = verificationFor({ identity: ID, before: BEFORE, rerun: rerunOf({ lanes: ['sastSemgrep'] }), tests: { command: 'node --test', status: 'notRun' } });
  assert.equal(v.reason, 'a lane that reported the finding did not re-run: sastGitleaks');
});

test('a finding counted before with no lane named is refused', () => {
  assert.throws(() => verificationFor({ identity: ID, before: { lanes: [], count: 1 }, rerun: rerunOf(), tests: TESTS }), /before\.lanes must name the lane/);
});
