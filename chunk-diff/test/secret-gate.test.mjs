import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gateChunk } from '../lib/secret-gate.mjs';

// assembled at run time so the source carries no key shape for a secrets scanner to lodge as real
const AWS_KEY = ['AKIA', '1234567890ABCDEF'].join('');

describe('gateChunk', () => {
  test('ordinary content passes through unchanged', () => {
    const r = gateChunk('Just some ordinary prose about the release.');
    assert.equal(r.redacted, false);
    assert.equal(r.src, 'Just some ordinary prose about the release.');
  });

  test('a real-shaped AWS key is redacted wholesale, not partially', () => {
    // Digit/letter mix — an all-alphabetic run reads as a placeholder to secrets-sweep on purpose
    // (real random key material almost always mixes digits in); this is what a real key looks like.
    const r = gateChunk(`key = ${AWS_KEY}`);
    assert.equal(r.redacted, true);
    assert.doesNotMatch(r.src, new RegExp(AWS_KEY));
    assert.match(r.src, /REDACTED/);
  });

  test('a placeholder-shaped value (example/dummy) is NOT redacted — over-redaction is its own false positive', () => {
    const r = gateChunk('key = AKIAEXAMPLE00000000');
    assert.equal(r.redacted, false);
  });
});
