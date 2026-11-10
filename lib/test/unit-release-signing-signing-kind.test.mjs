// Determines the signing kind string or 'undeclared' (lib/release-signing.mjs signingKind).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signingKind } from '../release-signing.mjs';

test('returns the declared kind when it is "cosign-checksums"', () => {
  const spec = { signing: { kind: 'cosign-checksums' } };
  assert.equal(signingKind(spec), "cosign-checksums");
});

test('returns the declared kind when it is "none"', () => {
  const spec = { signing: { kind: 'none' } };
  assert.equal(signingKind(spec), "none");
});

test('returns "undeclared" when the kind is not in the allowed list', () => {
  const spec = { signing: { kind: 'invalid-kind' } };
  assert.equal(signingKind(spec), "undeclared");
});

test('returns "undeclared" when signing object is missing', () => {
  const spec = { other: {} };
  assert.equal(signingKind(spec), "undeclared");
});

test('returns "undeclared" when spec is null', () => {
  const spec = null;
  assert.equal(signingKind(spec), "undeclared");
});

test('returns "undeclared" when kind is null', () => {
  const spec = { signing: { kind: null } };
  assert.equal(signingKind(spec), "undeclared");
});
