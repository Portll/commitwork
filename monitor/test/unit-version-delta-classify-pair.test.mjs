// Classifies a version pair into a verdict and score (monitor/version-delta.mjs classifyPair).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPair } from '../version-delta.mjs';

test('returns unknown when no registry publish order is provided', () => {
  const prev = { version: '1.0.0', scripts: [], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.1', scripts: [], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const r = classifyPair(prev, curr);
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.relation, 'unordered');
  assert.equal(r.window, null);
});

test('returns unknown when current version precedes baseline in publish order', () => {
  const prev = { version: '2.0.0', scripts: [], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.0', scripts: [], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const r = classifyPair(prev, curr, { order: ['1.0.0', '2.0.0'] });
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.relation, 'regressed');
  assert.equal(r.window, -1);
});

test('returns clean when adjacent versions have no observable changes', () => {
  const prev = { version: '1.0.0', scripts: ['build'], capabilities: ['x'], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.1', scripts: ['build'], capabilities: ['x'], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const r = classifyPair(prev, curr, { order: ['1.0.0', '1.0.1'] });
  assert.equal(r.verdict, 'clean');
  assert.equal(r.relation, 'adjacent');
  assert.equal(r.window, 1);
});

test('returns explained when new install script is corroborated by source', () => {
  const prev = { version: '1.0.0', scripts: ['build'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.1', scripts: ['build', 'postinstall'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r', source: { scripts: ['build', 'postinstall'], capabilities: [], minified: 0 } };
  const r = classifyPair(prev, curr, { order: ['1.0.0', '1.0.1'] });
  assert.equal(r.verdict, 'explained');
  assert.equal(r.code.length, 1);
  assert.equal(r.code[0].class, 'install-script');
  assert.equal(r.code[0].corroboration, 'matching');
});

test('returns anomaly when new install script is not in source', () => {
  const prev = { version: '1.0.0', scripts: ['build'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.1', scripts: ['build', 'postinstall'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r', source: { scripts: ['build'], capabilities: [], minified: 0 } };
  const r = classifyPair(prev, curr, { order: ['1.0.0', '1.0.1'] });
  assert.equal(r.verdict, 'anomaly');
  assert.equal(r.corroboration, 'none');
  assert.equal(r.score, 0.5);
  assert.equal(r.convergence, 1);
});

test('returns anomaly with amplified score when uncorroborated script and maintainer change converge', () => {
  const prev = { version: '1.0.0', scripts: ['build'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.1', scripts: ['build', 'postinstall'], capabilities: [], minified: 0, maintainers: ['a', 'b'], declaredRepo: 'r', registryIdentity: 'r', source: { scripts: ['build'], capabilities: [], minified: 0 } };
  const r = classifyPair(prev, curr, { order: ['1.0.0', '1.0.1'] });
  assert.equal(r.verdict, 'anomaly');
  assert.equal(r.score, 0.625);
  assert.equal(r.convergence, 2);
});

test('returns anomaly with republish boost when same version string has uncorroborated change', () => {
  const prev = { version: '1.0.0', scripts: ['build'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.0', scripts: ['build', 'postinstall'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r', source: { scripts: ['build'], capabilities: [], minified: 0 } };
  const r = classifyPair(prev, curr, { order: ['1.0.0'] });
  assert.equal(r.verdict, 'anomaly');
  assert.equal(r.relation, 'republish');
  assert.equal(r.score, 0.675);
});

test('returns undetermined when only maintainer changes with no code delta', () => {
  const prev = { version: '1.0.0', scripts: ['build'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.1', scripts: ['build'], capabilities: [], minified: 0, maintainers: ['b'], declaredRepo: 'r', registryIdentity: 'r' };
  const r = classifyPair(prev, curr, { order: ['1.0.0', '1.0.1'] });
  assert.equal(r.verdict, 'undetermined');
  assert.equal(r.context.length, 1);
  assert.equal(r.context[0].class, 'maintainer-change');
});

test('returns unknown when code change exists but source view is unresolved', () => {
  const prev = { version: '1.0.0', scripts: ['build'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.1', scripts: ['build', 'postinstall'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const r = classifyPair(prev, curr, { order: ['1.0.0', '1.0.1'] });
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.code.length, 1);
  assert.equal(r.code[0].corroboration, 'unresolved');
});

test('returns anomaly with window discount when change entered across multiple versions', () => {
  const prev = { version: '1.0.0', scripts: ['build'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r' };
  const curr = { version: '1.0.2', scripts: ['build', 'postinstall'], capabilities: [], minified: 0, maintainers: ['a'], declaredRepo: 'r', registryIdentity: 'r', source: { scripts: ['build'], capabilities: [], minified: 0 } };
  const r = classifyPair(prev, curr, { order: ['1.0.0', '1.0.1', '1.0.2'] });
  assert.equal(r.verdict, 'anomaly');
  assert.equal(r.relation, 'window');
  assert.equal(r.window, 2);
  assert.equal(r.score, 0.45);
});
