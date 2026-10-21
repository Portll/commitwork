// oracle-constructor.test.mjs — D2: a model-generated artifact is validated + gated, never executed;
// a malformed generation is rejected (explicit uncertainty), an add-only invariant that exempts is refused, a
// well-formed one is staged for human review before deterministic execution.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gateArtifact } from '../oracle-constructor.mjs';

describe('oracle-constructor gate', () => {
  test('a well-formed bola-manifest is STAGED (for review, not executed)', () => {
    const r = gateArtifact({ kind: 'bola-manifest', artifact: { base: 'https://x', paths: ['/a/{id}'] } });
    assert.equal(r.state, 'staged');
  });

  test('a malformed artifact is REJECTED, never executed — a hallucination is not a critical', () => {
    const r = gateArtifact({ kind: 'bola-manifest', artifact: { base: 'https://x' } }); // paths missing
    assert.equal(r.state, 'rejected');
    assert.match(r.errors.join(' '), /paths must be array/);
  });

  test('a well-formed invariant is staged; one that EXEMPTS is refused (add-only)', () => {
    assert.equal(gateArtifact({ kind: 'invariant', artifact: { set: '/api/', must: 'requireSession' } }).state, 'staged');
    const exempt = gateArtifact({ kind: 'invariant', artifact: { set: '/api/internal', must: 'nothing' } });
    assert.equal(exempt.state, 'rejected');
    assert.match(exempt.errors.join(' '), /ADD a check, never exempt/);
  });

  test('an unknown kind is refused — never guessed', () => {
    assert.equal(gateArtifact({ kind: 'freeform', artifact: {} }).state, 'rejected');
  });

  test('a non-object artifact is rejected, not crashed', () => {
    assert.equal(gateArtifact({ kind: 'property-test', artifact: 'DROP TABLE' }).state, 'rejected');
  });
});
