// Validates artifact shape and policy, returning staged or rejected (monitor/oracle-constructor.mjs gateArtifact).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateArtifact } from '../oracle-constructor.mjs';

test('rejects unknown artifact kind', () => {
  const result = gateArtifact({ kind: 'unknown-kind', artifact: {} });
  assert.deepEqual(result, {
    state: 'rejected',
    kind: 'unknown-kind',
    errors: ['unknown artifact kind "unknown-kind"'],
    why: 'no validator \u2014 a kind must be declared, never guessed'
  });
});

test('rejects bola-manifest with missing base field', () => {
  const result = gateArtifact({ kind: 'bola-manifest', artifact: { paths: [] } });
  assert.deepEqual(result, {
    state: 'rejected',
    kind: 'bola-manifest',
    errors: ['field base must be string, got undefined'],
    why: 'malformed generation \u2014 rejected, never executed (a hallucination is a validation failure, not a critical)'
  });
});

test('rejects bola-manifest with wrong type for paths', () => {
  const result = gateArtifact({ kind: 'bola-manifest', artifact: { base: 'main', paths: 'not-an-array' } });
  assert.deepEqual(result, {
    state: 'rejected',
    kind: 'bola-manifest',
    errors: ['field paths must be array, got string'],
    why: 'malformed generation \u2014 rejected, never executed (a hallucination is a validation failure, not a critical)'
  });
});

test('stages valid bola-manifest', () => {
  const result = gateArtifact({ kind: 'bola-manifest', artifact: { base: 'main', paths: ['src/', 'lib/'] } });
  assert.deepEqual(result, {
    state: 'staged',
    kind: 'bola-manifest',
    errors: [],
    why: 'well-formed \u2014 staged for human review, then deterministic execution (generation and execution stay separate)'
  });
});

test('rejects invariant with exempting must value "no"', () => {
  const result = gateArtifact({ kind: 'invariant', artifact: { set: 'security', must: 'no' } });
  assert.deepEqual(result, {
    state: 'rejected',
    kind: 'invariant',
    errors: ['invariant must ADD a check, never exempt'],
    why: 'a repo-local invariant may only add coverage, never subtract'
  });
});

test('rejects invariant with exempting must value "none"', () => {
  const result = gateArtifact({ kind: 'invariant', artifact: { set: 'security', must: 'none' } });
  assert.deepEqual(result, {
    state: 'rejected',
    kind: 'invariant',
    errors: ['invariant must ADD a check, never exempt'],
    why: 'a repo-local invariant may only add coverage, never subtract'
  });
});

test('rejects invariant with exempting must value "nothing"', () => {
  const result = gateArtifact({ kind: 'invariant', artifact: { set: 'security', must: 'nothing' } });
  assert.deepEqual(result, {
    state: 'rejected',
    kind: 'invariant',
    errors: ['invariant must ADD a check, never exempt'],
    why: 'a repo-local invariant may only add coverage, never subtract'
  });
});

test('rejects invariant with exempting must value "any"', () => {
  const result = gateArtifact({ kind: 'invariant', artifact: { set: 'security', must: 'any' } });
  assert.deepEqual(result, {
    state: 'rejected',
    kind: 'invariant',
    errors: ['invariant must ADD a check, never exempt'],
    why: 'a repo-local invariant may only add coverage, never subtract'
  });
});

test('rejects invariant with exempting must value "*"', () => {
  const result = gateArtifact({ kind: 'invariant', artifact: { set: 'security', must: '*' } });
  assert.deepEqual(result, {
    state: 'rejected',
    kind: 'invariant',
    errors: ['invariant must ADD a check, never exempt'],
    why: 'a repo-local invariant may only add coverage, never subtract'
  });
});

test('stages valid invariant with adding must value', () => {
  const result = gateArtifact({ kind: 'invariant', artifact: { set: 'security', must: 'all files must have license headers' } });
  assert.deepEqual(result, {
    state: 'staged',
    kind: 'invariant',
    errors: [],
    why: 'well-formed \u2014 staged for human review, then deterministic execution (generation and execution stay separate)'
  });
});
