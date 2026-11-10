// Validated scanner override map plus warnings (monitor/perf-tuning.mjs normalizeOverrides).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOverrides } from '../perf-tuning.mjs';

const DASH = '\u2014';
const nullMap = (entries = {}) => Object.assign(Object.create(null), entries);
const shapeWarning = (kind) =>
  `the scanner overrides are ${kind}, not an object of {id: "on"|"off"} ${DASH} NO override was applied, and the table below is the derivation alone`;
const stateWarning = (id, shown) =>
  `the override for ${id} is ${shown}, which is neither "on" nor "off" ${DASH} it is being IGNORED, not applied`;
const scannerWarning = (id, state) =>
  `the override for ${id} names a scanner this tuning model does not declare ${DASH} it is being IGNORED, and no lane was forced ${state}`;

test('null, undefined and an empty object all give an empty map and no warnings', () => {
  assert.deepEqual(normalizeOverrides(null), { map: nullMap(), warnings: [] });
  assert.deepEqual(normalizeOverrides(undefined), { map: nullMap(), warnings: [] });
  assert.deepEqual(normalizeOverrides({}), { map: nullMap(), warnings: [] });
});

test('a primitive is rejected with a warning naming its type', () => {
  assert.deepEqual(normalizeOverrides('on'), { map: nullMap(), warnings: [shapeWarning('a string')] });
  assert.deepEqual(normalizeOverrides(5), { map: nullMap(), warnings: [shapeWarning('a number')] });
  assert.deepEqual(normalizeOverrides(true), { map: nullMap(), warnings: [shapeWarning('a boolean')] });
});

test('an array is rejected as an array even when its items are valid states', () => {
  assert.deepEqual(normalizeOverrides(['on']), { map: nullMap(), warnings: [shapeWarning('an array')] });
  assert.deepEqual(normalizeOverrides([]), { map: nullMap(), warnings: [shapeWarning('an array')] });
});

test('on and off are both kept when no scanners are given', () => {
  const expected = { map: nullMap({ a: 'on', b: 'off' }), warnings: [] };
  assert.deepEqual(normalizeOverrides({ a: 'on', b: 'off' }), expected);
  assert.deepEqual(normalizeOverrides({ a: 'on', b: 'off' }, { scanners: null }), expected);
});

test('a state other than on or off is ignored with a warning while valid entries survive', () => {
  assert.deepEqual(normalizeOverrides({ a: 'maybe', b: 'on' }), {
    map: nullMap({ b: 'on' }),
    warnings: [stateWarning('a', '"maybe"')],
  });
});

test('invalid states are shown in their JSON form in the warning', () => {
  const r = normalizeOverrides({ a: 'ON', b: null, c: 1, d: undefined, e: ['on'] });
  assert.deepEqual(r, {
    map: nullMap(),
    warnings: [
      stateWarning('a', '"ON"'),
      stateWarning('b', 'null'),
      stateWarning('c', '1'),
      stateWarning('d', 'undefined'),
      stateWarning('e', '["on"]'),
    ],
  });
});

test('overrides for declared scanners are kept whatever the declared value is', () => {
  const r = normalizeOverrides({ a: 'on', b: 'off' }, { scanners: { a: true, b: false } });
  assert.deepEqual(r, { map: nullMap({ a: 'on', b: 'off' }), warnings: [] });
});

test('an undeclared scanner is ignored with a warning naming the state it asked for', () => {
  const r = normalizeOverrides({ ghost: 'on', phantom: 'off', real: 'off' }, { scanners: { real: true } });
  assert.deepEqual(r, {
    map: nullMap({ real: 'off' }),
    warnings: [scannerWarning('ghost', 'on'), scannerWarning('phantom', 'off')],
  });
  assert.deepEqual(normalizeOverrides({ a: 'on' }, { scanners: {} }), {
    map: nullMap(),
    warnings: [scannerWarning('a', 'on')],
  });
});

test('a scanner that is only inherited counts as undeclared', () => {
  const scanners = Object.create({ a: true });
  assert.deepEqual(normalizeOverrides({ a: 'on', toString: 'off' }, { scanners }), {
    map: nullMap(),
    warnings: [scannerWarning('a', 'on'), scannerWarning('toString', 'off')],
  });
});

test('a bad state on an undeclared scanner gets only the state warning', () => {
  const r = normalizeOverrides({ ghost: 'maybe' }, { scanners: { real: true } });
  assert.deepEqual(r, { map: nullMap(), warnings: [stateWarning('ghost', '"maybe"')] });
});
