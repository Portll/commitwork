// Lists node_modules version changes between two lockfile snapshots, sorted by path (bin/lib/npm-update.mjs lockDiff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockDiff } from '../lib/npm-update.mjs';

test('returns an empty array when neither snapshot has packages', () => {
  assert.deepEqual(lockDiff({}, {}), []);
  assert.deepEqual(lockDiff({ packages: null }, { packages: null }), []);
});

test('ignores paths that do not start with node_modules/', () => {
  const before = { packages: { '': { version: '1.0.0' }, foo: { version: '1.0.0' }, 'lib/node_modules/bar': { version: '1.0.0' } } };
  const after = { packages: { '': { version: '2.0.0' }, foo: { version: '2.0.0' } } };
  assert.deepEqual(lockDiff(before, after), []);
});

test('skips packages whose version is the same on both sides', () => {
  const before = { packages: { 'node_modules/foo': { version: '1.0.0' }, 'node_modules/bar': {}, 'node_modules/baz': {} } };
  const after = { packages: { 'node_modules/foo': { version: '1.0.0' }, 'node_modules/bar': {} } };
  assert.deepEqual(lockDiff(before, after), []);
});

test('reports an added package with a null from version, prod exposure and null type', () => {
  const expected = [{ path: 'node_modules/foo', name: 'foo', from: null, to: '1.0.0', exposure: 'prod', type: null }];
  const after = { packages: { 'node_modules/foo': { version: '1.0.0' } } };
  assert.deepEqual(lockDiff({ packages: {} }, after), expected);
  assert.deepEqual(lockDiff({}, after), expected);
});

test('reports a removed dev package with a null to version', () => {
  const before = { packages: { 'node_modules/foo': { version: '1.0.0', dev: true } } };
  assert.deepEqual(lockDiff(before, {}), [{ path: 'node_modules/foo', name: 'foo', from: '1.0.0', to: null, exposure: 'dev', type: null }]);
});

test('takes exposure from the after entry whenever one exists', () => {
  const before = { packages: { 'node_modules/foo': {}, 'node_modules/bar': { version: '1.0.0', dev: true } } };
  const after = { packages: { 'node_modules/foo': { version: '1.0.0', dev: true }, 'node_modules/bar': {} } };
  assert.deepEqual(lockDiff(before, after), [
    { path: 'node_modules/bar', name: 'bar', from: '1.0.0', to: null, exposure: 'prod', type: null },
    { path: 'node_modules/foo', name: 'foo', from: null, to: '1.0.0', exposure: 'dev', type: null },
  ]);
});

test('reports a version bump with both versions and the last node_modules segment as name', () => {
  const k = 'node_modules/a/node_modules/@scope/b';
  const before = { packages: { [k]: { version: '1.0.0' } } };
  const after = { packages: { [k]: { version: '1.0.1' } } };
  assert.deepEqual(lockDiff(before, after).map(({ type, ...rest }) => rest), [{ path: k, name: '@scope/b', from: '1.0.0', to: '1.0.1', exposure: 'prod' }]);
});

test('sorts changes by path in ascending string order', () => {
  const before = { packages: { 'node_modules/zeta': { version: '1.0.0' } } };
  const after = { packages: { 'node_modules/alpha/node_modules/beta': { version: '1.0.0' }, 'node_modules/alpha': { version: '1.0.0' }, 'node_modules/@scope/pkg': { version: '1.0.0', dev: true } } };
  assert.deepEqual(lockDiff(before, after), [
    { path: 'node_modules/@scope/pkg', name: '@scope/pkg', from: null, to: '1.0.0', exposure: 'dev', type: null },
    { path: 'node_modules/alpha', name: 'alpha', from: null, to: '1.0.0', exposure: 'prod', type: null },
    { path: 'node_modules/alpha/node_modules/beta', name: 'beta', from: null, to: '1.0.0', exposure: 'prod', type: null },
    { path: 'node_modules/zeta', name: 'zeta', from: '1.0.0', to: null, exposure: 'prod', type: null },
  ]);
});

test('leaves type null when one side has a falsy version and the other a real one', () => {
  const pairs = [[0, '1.0.0'], ['', '1.0.0'], [false, '1.0.0'], [0n, '1.0.0'], [NaN, '1.0.0'], ['1.0.0', 0], ['1.0.0', ''], ['1.0.0', false], ['1.0.0', 0n]];
  const entries = (side) => Object.fromEntries(pairs.map((p, i) => [`node_modules/p${i}`, { version: p[side] }]));
  const expected = pairs.map(([from, to], i) => ({ path: `node_modules/p${i}`, name: `p${i}`, from, to, exposure: 'prod', type: null }));
  assert.deepEqual(lockDiff({ packages: entries(0) }, { packages: entries(1) }), expected);
});

test('never reads a version value to compute type when the other side is missing or falsy', () => {
  const v = new Proxy({}, { get() { throw new Error('version was inspected'); } });
  const before = { packages: { 'node_modules/a': {}, 'node_modules/b': { version: v }, 'node_modules/c': { version: 0 }, 'node_modules/d': { version: v } } };
  const after = { packages: { 'node_modules/a': { version: v }, 'node_modules/b': {}, 'node_modules/c': { version: v }, 'node_modules/d': { version: '' } } };
  assert.deepEqual(lockDiff(before, after), [
    { path: 'node_modules/a', name: 'a', from: null, to: v, exposure: 'prod', type: null },
    { path: 'node_modules/b', name: 'b', from: v, to: null, exposure: 'prod', type: null },
    { path: 'node_modules/c', name: 'c', from: 0, to: v, exposure: 'prod', type: null },
    { path: 'node_modules/d', name: 'd', from: v, to: '', exposure: 'prod', type: null },
  ]);
});
