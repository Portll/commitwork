// determines verification status for a finding (lib/remediation-verify.mjs verificationFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificationFor } from '../remediation-verify.mjs';

test('throws when input is not an object', () => {
  assert.throws(() => verificationFor(null), {
    name: 'TypeError',
    message: 'remediation-verify: verificationFor expects an object',
  });
});

test('throws when identity is empty', () => {
  const input = {
    identity: '',
    before: { count: 1, lanes: ['lane1'] },
    tests: { command: 'cmd', status: 'passed' },
    rerun: { ran: true, lanes: ['lane1'], identities: [], newIdentities: [] },
  };
  assert.throws(() => verificationFor(input), {
    name: 'TypeError',
    message: 'remediation-verify: identity must be a non-empty string',
  });
});

test('returns unverified when rerun is null', () => {
  const input = {
    identity: 'id',
    before: { count: 1, lanes: ['lane1'] },
    tests: { command: 'cmd', status: 'passed' },
    rerun: null,
  };
  const result = verificationFor(input);
  assert.deepEqual(result, { status: "unverified", witness: { lanes: [], before: 1, after: null, digest: null }, newFindings: [], tests: { command: "cmd", status: "passed" }, reason: null });
});

test('returns undetermined when rerun did not run', () => {
  const input = {
    identity: 'id',
    before: { count: 1, lanes: ['lane1'] },
    tests: { command: 'cmd', status: 'passed' },
    rerun: { ran: false, lanes: ['lane1'], identities: [], newIdentities: [], reason: 'skip' },
  };
  const result = verificationFor(input);
  assert.deepEqual(result, { status: "undetermined", witness: { lanes: ["lane1"], before: 1, after: null, digest: null }, newFindings: [], tests: { command: "cmd", status: "passed" }, reason: "skip" });
});

test('returns undetermined with BEFORE_NOT_PRESENT when before count is zero', () => {
  const input = {
    identity: 'id',
    before: { count: 0, lanes: [] },
    tests: { command: 'cmd', status: 'passed' },
    rerun: { ran: true, lanes: ['lane1'], identities: [], newIdentities: ['new1'], digest: null },
  };
  const result = verificationFor(input);
  assert.deepEqual(result, { status: "undetermined", witness: { lanes: ["lane1"], before: 0, after: null, digest: null }, newFindings: ["new1"], tests: { command: "cmd", status: "passed" }, reason: "the finding was not present before the fix, so its absence afterwards shows nothing" });
});

test('returns failed when identity still present and new findings appear', () => {
  const input = {
    identity: 'id',
    before: { count: 1, lanes: ['lane1'] },
    tests: { command: 'cmd', status: 'passed' },
    rerun: {
      ran: true,
      lanes: ['lane1'],
      identities: ['id'],
      newIdentities: ['newA', 'newB'],
      digest: null,
    },
  };
  const result = verificationFor(input);
  assert.deepEqual(result, { status: "failed", witness: { lanes: ["lane1"], before: 1, after: 1, digest: null }, newFindings: ["newA", "newB"], tests: { command: "cmd", status: "passed" }, reason: "the identity is still present after the patch; new findings appeared in the touched files: newA, newB" });
});

test('returns failed when tests status is failed', () => {
  const input = {
    identity: 'id',
    before: { count: 1, lanes: ['lane1'] },
    tests: { command: 'cmd', status: 'failed' },
    rerun: { ran: true, lanes: ['lane1'], identities: [], newIdentities: [], digest: null },
  };
  const result = verificationFor(input);
  assert.deepEqual(result, { status: "failed", witness: { lanes: ["lane1"], before: 1, after: 0, digest: null }, newFindings: [], tests: { command: "cmd", status: "failed" }, reason: "the test command failed" });
});

test('returns undetermined when some before lanes were not rerun', () => {
  const input = {
    identity: 'id',
    before: { count: 1, lanes: ['lane1', 'lane2'] },
    tests: { command: 'cmd', status: 'passed' },
    rerun: { ran: true, lanes: ['lane1'], identities: [], newIdentities: [], digest: null },
  };
  const result = verificationFor(input);
  assert.deepEqual(result, { status: "undetermined", witness: { lanes: ["lane1"], before: 1, after: null, digest: null }, newFindings: [], tests: { command: "cmd", status: "passed" }, reason: "a lane that reported the finding did not re-run: lane2" });
});

test('returns undetermined when tests did not run', () => {
  const input = {
    identity: 'id',
    before: { count: 1, lanes: ['lane1'] },
    tests: { command: 'cmd', status: 'notRun' },
    rerun: { ran: true, lanes: ['lane1'], identities: [], newIdentities: [], digest: null },
  };
  const result = verificationFor(input);
  assert.deepEqual(result, { status: "undetermined", witness: { lanes: ["lane1"], before: 1, after: null, digest: null }, newFindings: [], tests: { command: "cmd", status: "notRun" }, reason: "the declared test command did not run" });
});

test('returns verified when all conditions are satisfied', () => {
  const input = {
    identity: 'id',
    before: { count: 1, lanes: ['lane1'] },
    tests: { command: 'cmd', status: 'passed' },
    rerun: { ran: true, lanes: ['lane1'], identities: [], newIdentities: [], digest: null },
  };
  const result = verificationFor(input);
  assert.deepEqual(result, { status: "verified", witness: { lanes: ["lane1"], before: 1, after: 0, digest: null }, newFindings: [], tests: { command: "cmd", status: "passed" }, reason: null });
});
