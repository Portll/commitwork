// The resolved on/off state, source and metadata of a declared experimental feature flag (lib/feature-flags.mjs featureFlag).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureFlag } from '../feature-flags.mjs';

const tail = ' is not declared in manifests/feature-charter.json experimentalFlags';

test('throws for an undeclared flag id with the id quoted in the message', () => {
  assert.throws(() => featureFlag('missing-flag', { env: {}, settings: {} }), {
    name: 'Error',
    message: 'feature flag "missing-flag"' + tail,
  });
});

test('throws for an undeclared flag id even when no options object is passed', () => {
  assert.throws(() => featureFlag('zz-not-a-real-flag-zz'), {
    name: 'Error',
    message: 'feature flag "zz-not-a-real-flag-zz"' + tail,
  });
});

test('throws for an undeclared flag id before consulting env overrides or settings', () => {
  const env = { CW_EXPERIMENTAL: 'on', CW_FEATURE_ZZ_UNDECLARED: 'off' };
  assert.throws(() => featureFlag('zz-undeclared', { env, settings: { 'zz-undeclared': 'on' } }), {
    name: 'Error',
    message: 'feature flag "zz-undeclared"' + tail,
  });
});

test('throws for an undeclared flag id whose quote and tab are JSON escaped in the message', () => {
  assert.throws(() => featureFlag('quote"a\tb', { env: {}, settings: null }), {
    name: 'Error',
    message: 'feature flag "quote\\"a\\tb"' + tail,
  });
});

test('throws for a numeric flag id with the number unquoted in the message', () => {
  assert.throws(() => featureFlag(7, { env: {}, settings: {} }), {
    name: 'Error',
    message: 'feature flag 7' + tail,
  });
});

test('throws for an undefined flag id with the word undefined in the message', () => {
  assert.throws(() => featureFlag(undefined, { env: {}, settings: {} }), {
    name: 'Error',
    message: 'feature flag undefined' + tail,
  });
});

test('throws for a null flag id with the word null in the message', () => {
  assert.throws(() => featureFlag(null, { env: {}, settings: {} }), {
    name: 'Error',
    message: 'feature flag null' + tail,
  });
});

test('throws for a very long undeclared flag id with the whole id in the message', () => {
  const id = 'x'.repeat(300);
  assert.throws(() => featureFlag(id, { env: {}, settings: {} }), {
    name: 'Error',
    message: 'feature flag "' + id + '"' + tail,
  });
});

test('throws for an undeclared non-ASCII flag id left unescaped in the message', () => {
  assert.throws(() => featureFlag('caf\u00e9-zz', { env: {}, settings: {} }), {
    name: 'Error',
    message: 'feature flag "caf\u00e9-zz"' + tail,
  });
});
