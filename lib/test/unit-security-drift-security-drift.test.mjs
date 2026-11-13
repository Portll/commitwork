// Computes differences between two security snapshots (lib/security-drift.mjs securityDrift)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityDrift } from '../security-drift.mjs';

test('throws when before is not an object with subjects array', () => {
  const input = { before: null, after: { subjects: [] } };
  assert.throws(() => securityDrift(input), {
    name: 'TypeError',
    message: 'before.subjects must be an array'
  });
});

test('throws when after is not an object with subjects array', () => {
  const input = { before: { subjects: [] }, after: undefined };
  assert.throws(() => securityDrift(input), {
    name: 'TypeError',
    message: 'after.subjects must be an array'
  });
});

test('accepts a valid subject kind without throwing', () => {
  const input = {
    before: { subjects: [{ id: 'a', kind: 'dependency-origin', measured: false, value: {} }] },
    after: { subjects: [{ id: 'a', kind: 'dependency-origin', measured: false, value: {} }] }
  };
  const result = securityDrift(input);
  assert.deepEqual(result, { transitions: [], added: [], removed: [], unknown: [{ kind: "dependency-origin", id: "a", reason: "unmeasured-before" }, { kind: "dependency-origin", id: "a", reason: "unmeasured-after" }] });
});

test('throws when dependency-origin value.source is an invalid string', () => {
  const subj = { id: 'b', kind: 'dependency-origin', measured: true, value: { source: 'invalid' } };
  const input = { before: { subjects: [subj] }, after: { subjects: [subj] } };
  assert.throws(() => securityDrift(input), {
    name: 'TypeError',
    message: 'before dependency-origin value.source must be one of: registry, git, archive, path'
  });
});

test('accepts a workflow-permissions scope level that is valid', () => {
  const subj = {
    id: 'c',
    kind: 'workflow-permissions',
    measured: true,
    value: { scopes: { repo: 'read' } }
  };
  const input = { before: { subjects: [subj] }, after: { subjects: [subj] } };
  const result = securityDrift(input);
  assert.deepEqual(result, { transitions: [], added: [], removed: [], unknown: [] });
});

test('throws when suppression reason is an empty string', () => {
  const subj = {
    id: 'd',
    kind: 'suppression',
    measured: true,
    value: { reason: '', expiresAt: null }
  };
  const input = { before: { subjects: [subj] }, after: { subjects: [subj] } };
  assert.throws(() => securityDrift(input), {
    name: 'TypeError',
    message: 'before suppression value.reason must be a non-empty string'
  });
});

test('throws when suppression expiresAt is an invalid ISO\u20118601 timestamp', () => {
  const subj = {
    id: 'e',
    kind: 'suppression',
    measured: true,
    value: { reason: 'test', expiresAt: '2023-01-01T12:123:45Z' }
  };
  const input = { before: { subjects: [subj] }, after: { subjects: [subj] } };
  assert.throws(() => securityDrift(input), {
    name: 'TypeError',
    message: 'before suppression value.expiresAt must be a valid ISO-8601 instant with explicit zone'
  });
});

test('accepts a valid timestamp where month parsing subtracts 1 correctly', () => {
  const subj = {
    id: 'f',
    kind: 'suppression',
    measured: true,
    value: { reason: 'ok', expiresAt: '2023-02-01T00:00:00Z' }
  };
  const input = { before: { subjects: [subj] }, after: { subjects: [subj] } };
  const result = securityDrift(input);
  assert.deepEqual(result, { transitions: [], added: [], removed: [], unknown: [] });
});

test('accepts a timestamp where year component matches (original check uses !==)', () => {
  const subj = {
    id: 'g',
    kind: 'suppression',
    measured: true,
    value: { reason: 'ok', expiresAt: '2023-03-01T00:00:00Z' }
  };
  const input = { before: { subjects: [subj] }, after: { subjects: [subj] } };
  const result = securityDrift(input);
  assert.deepEqual(result, { transitions: [], added: [], removed: [], unknown: [] });
});

test('accepts a timestamp where minutes component matches (original check uses !==)', () => {
  const subj = {
    id: 'h',
    kind: 'suppression',
    measured: true,
    value: { reason: 'ok', expiresAt: '2023-04-01T12:34:56Z' }
  };
  const input = { before: { subjects: [subj] }, after: { subjects: [subj] } };
  const result = securityDrift(input);
  assert.deepEqual(result, { transitions: [], added: [], removed: [], unknown: [] });
});
