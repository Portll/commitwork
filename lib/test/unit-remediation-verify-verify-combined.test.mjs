// determines verification status of a combined patch (lib/remediation-verify.mjs verifyCombined)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCombined } from '../remediation-verify.mjs';

test('throws when input is not an object', () => {
  assert.throws(() => verifyCombined(undefined), { name: "TypeError", message: "remediation-verify: included must be an array" });
});

test('throws when included is not an array', () => {
  const input = {
    included: 42,
    rerun: null,
    tests: { command: 'cmd', status: 'passed' },
  };
  assert.throws(() => verifyCombined(input), {
    name: 'TypeError',
    message: 'remediation-verify: included must be an array',
  });
});

test('throws when an included entry lacks a non\u2011empty identity', () => {
  const input = {
    included: [{ identity: '' }],
    rerun: null,
    tests: { command: 'cmd', status: 'passed' },
  };
  assert.throws(() => verifyCombined(input), {
    name: 'TypeError',
    message: 'remediation-verify: included[0].identity must be a non-empty string',
  });
});

test('returns undetermined with NO_FIX_INCLUDED when no identities are included', () => {
  const input = {
    included: [],
    rerun: { ran: true, lanes: ['l'], identities: [], newIdentities: [] },
    tests: { command: 'cmd', status: 'passed' },
  };
  const result = verifyCombined(input);
  assert.deepEqual(result, { status: "undetermined", reason: "no fix was included", stillPresent: [], newFindings: [] });
});

test('returns undetermined with RERUN_NEVER_ATTEMPTED when rerun is null', () => {
  const input = {
    included: [{ identity: 'id1' }],
    rerun: null,
    tests: { command: 'cmd', status: 'passed' },
  };
  const result = verifyCombined(input);
  assert.deepEqual(result, { status: "undetermined", reason: "the re-run was never attempted", stillPresent: [], newFindings: [] });
});

test('returns undetermined with the rerun reason when rerun did not run', () => {
  const input = {
    included: [{ identity: 'id1' }],
    rerun: { ran: false, reason: 'skip this', lanes: [], identities: [], newIdentities: [] },
    tests: { command: 'cmd', status: 'passed' },
  };
  const result = verifyCombined(input);
  assert.deepEqual(result, { status: "undetermined", reason: "skip this", stillPresent: [], newFindings: [] });
});

test('fails when some included identities are still present after the combined patch', () => {
  const input = {
    included: [{ identity: 'a' }, { identity: 'b' }],
    rerun: {
      ran: true,
      lanes: ['l'],
      identities: ['a', 'c'],
      newIdentities: [],
    },
    tests: { command: 'cmd', status: 'passed' },
  };
  const result = verifyCombined(input);
  assert.deepEqual(result, { status: "failed", reason: "included identities are still present after the combined patch: a", stillPresent: ["a"], newFindings: [] });
});

test('fails when new findings appear in the touched files', () => {
  const input = {
    included: [{ identity: 'a' }],
    rerun: {
      ran: true,
      lanes: ['l'],
      identities: [],
      newIdentities: ['new1'],
    },
    tests: { command: 'cmd', status: 'passed' },
  };
  const result = verifyCombined(input);
  assert.deepEqual(result, { status: "failed", reason: "new findings appeared in the touched files: new1", stillPresent: [], newFindings: ["new1"] });
});

test('fails when the test command failed', () => {
  const input = {
    included: [{ identity: 'a' }],
    rerun: {
      ran: true,
      lanes: ['l'],
      identities: [],
      newIdentities: [],
    },
    tests: { command: 'cmd', status: 'failed' },
  };
  const result = verifyCombined(input);
  assert.deepEqual(result, { status: "failed", reason: "the test command failed", stillPresent: [], newFindings: [] });
});

test('returns verified when everything passes', () => {
  const input = {
    included: [{ identity: 'a' }],
    rerun: {
      ran: true,
      lanes: ['l'],
      identities: [],
      newIdentities: [],
    },
    tests: { command: 'cmd', status: 'passed' },
  };
  const result = verifyCombined(input);
  assert.deepEqual(result, { status: "verified", reason: null, stillPresent: [], newFindings: [] });
});
