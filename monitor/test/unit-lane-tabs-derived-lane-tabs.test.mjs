// Derives lane tabs for categories not in the declared set (monitor/lane-tabs.mjs derivedLaneTabs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivedLaneTabs } from '../lane-tabs.mjs';

test('filters out declared categories from the input list', () => {
  const r = derivedLaneTabs(['a', 'b', 'c'], ['b'], () => null);
  assert.deepEqual(r, [{ key: "a", view: "a", section: "other", label: "a", short: "a", derived: true }, { key: "c", view: "c", section: "other", label: "c", short: "c", derived: true }]);
});

test('returns an empty array when all categories are declared', () => {
  const r = derivedLaneTabs(['a', 'b'], ['a', 'b'], () => null);
  assert.deepEqual(r, []);
});

test('returns an empty array when categories is null', () => {
  const r = derivedLaneTabs(null, [], () => null);
  assert.deepEqual(r, []);
});

test('returns an empty array when declared is null', () => {
  const r = derivedLaneTabs(['a'], null, () => null);
  assert.deepEqual(r, [{ key: "a", view: "a", section: "other", label: "a", short: "a", derived: true }]);
});

test('uses the labelFor result when it is truthy', () => {
  const r = derivedLaneTabs(['x'], [], (c) => c === 'x' ? 'My Label' : null);
  assert.deepEqual(r, [{ key: "x", view: "x", section: "other", label: "My Label", short: "My Label", derived: true }]);
});

test('falls back to the category when labelFor returns null', () => {
  const r = derivedLaneTabs(['x'], [], () => null);
  assert.deepEqual(r, [{ key: "x", view: "x", section: "other", label: "x", short: "x", derived: true }]);
});

test('reverts short to label when two tabs share the same short form', () => {
  const r = derivedLaneTabs(['a', 'b'], [], (c) => c === 'a' ? 'Same (X)' : 'Same (Y)');
  assert.deepEqual(r, [{ key: "a", view: "a", section: "other", label: "Same (X)", short: "Same \u00b7 X", derived: true }, { key: "b", view: "b", section: "other", label: "Same (Y)", short: "Same \u00b7 Y", derived: true }]);
});

test('keeps short distinct when tabs have different short forms', () => {
  const r = derivedLaneTabs(['a', 'b'], [], (c) => c === 'a' ? 'Alpha (X)' : 'Beta (Y)');
  assert.deepEqual(r, [{ key: "a", view: "a", section: "other", label: "Alpha (X)", short: "Alpha \u00b7 X", derived: true }, { key: "b", view: "b", section: "other", label: "Beta (Y)", short: "Beta \u00b7 Y", derived: true }]);
});

test('sorts tabs by section then by key', () => {
  const r = derivedLaneTabs(['zeta', 'alpha', 'beta'], [], () => null);
  assert.deepEqual(r, [{ key: "alpha", view: "alpha", section: "other", label: "alpha", short: "alpha", derived: true }, { key: "beta", view: "beta", section: "other", label: "beta", short: "beta", derived: true }, { key: "zeta", view: "zeta", section: "other", label: "zeta", short: "zeta", derived: true }]);
});

test('marks every derived tab with derived true', () => {
  const r = derivedLaneTabs(['a', 'b'], [], () => null);
  assert.deepEqual(r, [{ key: "a", view: "a", section: "other", label: "a", short: "a", derived: true }, { key: "b", view: "b", section: "other", label: "b", short: "b", derived: true }]);
});
