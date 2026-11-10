// Null for an enabled flag, else a 404 response whose body says how to enable it (lib/feature-flags.mjs gateFeature).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateFeature } from '../feature-flags.mjs';

const undeclared = (shown) => ({
  name: 'Error',
  message: `feature flag ${shown} is not declared in manifests/feature-charter.json experimentalFlags`,
});

test('an id missing from the charter throws with the id JSON-quoted in the message', () => {
  assert.throws(() => gateFeature('dark-mode', { env: {} }), undeclared('"dark-mode"'));
});

test('an undeclared id throws even when its own env var and CW_EXPERIMENTAL both say off', () => {
  const env = { CW_FEATURE_DARK_MODE: 'off', CW_EXPERIMENTAL: 'off' };
  assert.throws(() => gateFeature('dark-mode', { env }), undeclared('"dark-mode"'));
});

test('an undeclared id throws before the supplied settings are validated', () => {
  assert.throws(() => gateFeature('dark-mode', { env: {}, settings: 'not-a-map' }), undeclared('"dark-mode"'));
});

test('a double quote inside an undeclared id is escaped in the message', () => {
  assert.throws(() => gateFeature('a"b', { env: {} }), undeclared('"a\\"b"'));
});

test('a long undeclared id appears whole in the message', () => {
  const id = 'x'.repeat(40);
  assert.throws(() => gateFeature(id, { env: {} }), undeclared(`"${id}"`));
});

test('a numeric id is not found among string flag ids and is shown unquoted', () => {
  assert.throws(() => gateFeature(7, { env: {} }), undeclared('7'));
});

test('a null id throws naming null', () => {
  assert.throws(() => gateFeature(null, { env: {} }), undeclared('null'));
});

test('calling with no arguments throws naming undefined', () => {
  assert.throws(() => gateFeature(), undeclared('undefined'));
});
