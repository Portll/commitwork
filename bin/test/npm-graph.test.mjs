// bin/test/npm-graph.test.mjs — package-lock graphs (chains, exposure, aliases, workspaces) and the
// npm-audit findings the local merge reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNpmGraph, resolveFrom, GRAPH_READERS } from '../lib/npm-graph.mjs';
import { auditLookup } from '../lib/npm-audit-findings.mjs';

const LOCK = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'member-repo', workspaces: ['packages/client-a'], dependencies: { 'widget-x': '^2.0.0', alias: 'npm:real-name@^1.0.0' }, devDependencies: { 'test-kit': '^1.0.0' } },
    'packages/client-a': { name: 'client-a', version: '0.1.0', dependencies: { 'only-ws': '^1.0.0' } },
    'node_modules/only-ws': { version: '1.0.0' },
    'node_modules/client-a': { resolved: 'packages/client-a', link: true },
    'node_modules/widget-x': { version: '2.0.0', dependencies: { 'child-y': '^1.0.0' } },
    'node_modules/widget-x/node_modules/child-y': { version: '1.5.0' },
    'node_modules/child-y': { version: '2.1.0' },
    'node_modules/alias': { name: 'real-name', version: '1.0.3' },
    'node_modules/test-kit': { version: '1.0.0', dev: true, dependencies: { 'child-y': '^2.0.0' } },
  },
};

test('nested resolution walks up the way node does', () => {
  assert.equal(resolveFrom(LOCK.packages, 'node_modules/widget-x', 'child-y'), 'node_modules/widget-x/node_modules/child-y');
  assert.equal(resolveFrom(LOCK.packages, 'node_modules/test-kit', 'child-y'), 'node_modules/child-y');
  assert.equal(resolveFrom(LOCK.packages, '', 'absent'), null);
});

test('a graph carries every version, its exposure and its shortest chains', () => {
  const g = readNpmGraph(JSON.stringify(LOCK));
  assert.equal(g.error, undefined);
  assert.deepEqual([...g.packages.keys()], ['child-y@1.5.0', 'child-y@2.1.0', 'only-ws@1.0.0', 'real-name@1.0.3', 'test-kit@1.0.0', 'widget-x@2.0.0']);
  assert.deepEqual(g.packages.get('child-y@1.5.0').paths, [['widget-x@2.0.0', 'child-y@1.5.0']]);
  assert.equal(g.packages.get('child-y@2.1.0').exposure, 'prod');
  assert.deepEqual(g.packages.get('only-ws@1.0.0').paths, [['client-a (workspace)', 'only-ws@1.0.0']], 'reached through the workspace link');
  assert.equal(g.packages.get('test-kit@1.0.0').exposure, 'dev');
  assert.ok(g.packages.has('real-name@1.0.3'), 'an alias is looked up under the package it installs');
  assert.ok(GRAPH_READERS['package-lock.json'].read === readNpmGraph);
});

test('an unreadable lockfile is an error, never an empty graph', () => {
  assert.match(readNpmGraph('nope').error, /not JSON/);
  assert.match(readNpmGraph('[]').error, /not a JSON object/);
  assert.match(readNpmGraph(JSON.stringify({ lockfileVersion: 1 })).error, /lockfileVersion 1/);
});

test('npm audit rows become per-version findings; a failed audit and an unreadable range are errors', async () => {
  const summary = { rows: [{ name: 'child-y', severity: 'high', advisories: [
    { title: 'prototype pollution', url: 'https://github.com/advisories/GHSA-p6mc-m468-83gw', range: '<2.0.0', severity: 'high' },
    { title: 'odd', url: 'https://example.invalid/odd', range: '>=2.1.0 <2.2.0', severity: 'info' }] }] };
  const look = auditLookup(summary, LOCK);
  const got = await look([{ name: 'child-y', version: '1.5.0' }, { name: 'child-y', version: '2.1.0' }, { name: 'widget-x', version: '2.0.0' }]);
  assert.deepEqual(got.get('child-y@1.5.0').advisories.map((a) => [a.id, a.severity]), [['GHSA-p6mc-m468-83gw', 'high']]);
  assert.deepEqual(got.get('child-y@2.1.0').advisories.map((a) => [a.id, a.severity]), [['https://example.invalid/odd', 'low']]);
  assert.deepEqual(got.get('widget-x@2.0.0').advisories, []);
  const failed = await auditLookup({ error: 'npm audit failed: ENOTFOUND' }, LOCK)([{ name: 'child-y', version: '1.5.0' }]);
  assert.match(failed.get('child-y@1.5.0').error, /ENOTFOUND/);
  const odd = await auditLookup({ rows: [{ name: 'child-y', severity: 'high', advisories: [{ url: 'u', range: 'not a range', severity: 'high' }] }] }, LOCK)([{ name: 'child-y', version: '1.5.0' }]);
  assert.match(odd.get('child-y@1.5.0').error, /could not be read/);
});
