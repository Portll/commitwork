// Each feature flag's on/off state and source, or the charter load error (lib/feature-flags.mjs featureState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureState } from '../feature-flags.mjs';

const SUFFIX = ' \u2014 no entry point can be mapped to a flag, so nothing is gated';
const gated = (warns) => warns.filter((m) => m.endsWith(SUFFIX));
const failed = (r) => ({ ok: false, charterError: r.charterError, storeError: null, flags: [] });

function withBrokenCharter(call) {
  const parse = JSON.parse;
  const warn = console.warn;
  const warns = [];
  JSON.parse = () => { throw new SyntaxError('Unexpected token x in JSON at position 0'); };
  console.warn = (...args) => { warns.push(args.map(String).join(' ')); };
  try {
    return { r: call(), warns };
  } finally {
    JSON.parse = parse;
    console.warn = warn;
  }
}

test('when the flag charter cannot be parsed the result is not ok, has no flags and warns that nothing is gated', () => {
  const { r, warns } = withBrokenCharter(() => featureState({ env: {}, settings: {} }));
  assert.equal(r.ok, false);
  assert.deepEqual(r, failed(r));
  assert.notEqual(r.charterError, null);
  assert.deepEqual(gated(warns), [`[features] ${r.charterError}${SUFFIX}`]);
});

test('repeated calls with the charter still broken return the same failure and do not warn again', () => {
  const first = withBrokenCharter(() => featureState({ env: {}, settings: null }));
  const second = withBrokenCharter(() => featureState({ env: {}, settings: null }));
  assert.equal(first.r.ok, false);
  assert.deepEqual(first.r, failed(first.r));
  assert.deepEqual(second.r, first.r);
  assert.deepEqual(gated(first.warns), []);
  assert.deepEqual(gated(second.warns), []);
});

test('invalid supplied settings are never validated once the charter fails, so storeError stays null', () => {
  const { r } = withBrokenCharter(() => featureState({ env: { CW_FEATURE_SCAN_IMAGES: 'off' }, settings: 'x' }));
  assert.equal(r.ok, false);
  assert.equal(r.storeError, null);
  assert.deepEqual(r, failed(r));
});

test('env words that are not on or off go unreported once the charter fails because no flag is resolved', () => {
  const env = { CW_EXPERIMENTAL: 'maybe', CW_FEATURE_FLOW: 'yes' };
  const { r, warns } = withBrokenCharter(() => featureState({ env, settings: { flow: 'off' } }));
  assert.equal(r.ok, false);
  assert.deepEqual(r, failed(r));
  assert.deepEqual(warns.filter((m) => m.includes('is not on or off')), []);
});

test('many env overrides still yield an empty flag list when the charter fails', () => {
  const env = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`CW_FEATURE_F${i}`, i % 2 ? 'on' : 'off']));
  const { r } = withBrokenCharter(() => featureState({ env: { ...env, CW_EXPERIMENTAL: 'on' }, settings: {} }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.flags, []);
  assert.deepEqual(r, failed(r));
});

test('called with no arguments the defaults lead to the same charter failure', () => {
  const ref = withBrokenCharter(() => featureState({ env: {}, settings: {} })).r;
  const { r } = withBrokenCharter(() => featureState());
  assert.equal(r.ok, false);
  assert.deepEqual(r, ref);
  assert.deepEqual(r, failed(ref));
});
