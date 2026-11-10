// The neutral report envelope: product, manufacturer, statements and what the scan looked at (cra/neutral-report.mjs buildReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../neutral-report.mjs';

const AT = '2024-01-01T00:00:00Z';
const ann = () => ({ annotations: [] });

test('A product without version or repos gets a null version and an empty repo list', () => {
  const r = buildReport({ name: 'p' }, null, null, [], ann(), AT);
  assert.deepEqual(r.product, { name: 'p', version: null, repos: [] });
});

test('A product with a version and repos keeps both as given', () => {
  const r = buildReport({ name: 'p', version: '1.2.0', repos: ['a', 'b'] }, null, null, [], ann(), AT);
  assert.deepEqual(r.product, { name: 'p', version: '1.2.0', repos: ['a', 'b'] });
});

test('A missing manufacturer is reported as null and a given one is passed through', () => {
  assert.equal(buildReport({ name: 'p' }, undefined, null, [], ann(), AT).manufacturer, null);
  assert.equal(buildReport({ name: 'p' }, '', null, [], ann(), AT).manufacturer, null);
  const r = buildReport({ name: 'p' }, { name: 'Acme' }, null, [], ann(), AT);
  assert.deepEqual(r.manufacturer, { name: 'Acme' });
});

test('The envelope carries the schema path, spec version and generation time', () => {
  const r = buildReport({ name: 'p' }, null, null, [], ann(), AT);
  assert.equal(r.$schema, '../schema/commitwork-report.schema.json');
  assert.equal(r.specVersion, 'commitwork-report/1.0');
  assert.equal(r.generated, AT);
});

test('A null rollup leaves corroboration, reachability and vdb null with empty coverage and voids', () => {
  const r = buildReport({ name: 'p' }, null, null, [], ann(), AT);
  assert.equal(r.looking.corroboration, null);
  assert.equal(r.looking.reachability, null);
  assert.equal(r.looking.vdb, null);
  assert.equal(r.looking.fixtures, null);
  assert.deepEqual(r.looking.coverage, []);
  assert.deepEqual(r.looking.voids, []);
});

test('Corroboration and reachability present in the rollup are passed through unchanged', () => {
  const rollup = { corroboration: { agree: 3 }, scanners: { depsReachability: { reachable: 2 } } };
  const r = buildReport({ name: 'p' }, null, rollup, [], ann(), AT);
  assert.deepEqual(r.looking.corroboration, { agree: 3 });
  assert.deepEqual(r.looking.reachability, { reachable: 2 });
});

test('A rollup without corroboration or depsReachability reports both as null', () => {
  const r = buildReport({ name: 'p' }, null, { scanners: {} }, [], ann(), AT);
  assert.equal(r.looking.corroboration, null);
  assert.equal(r.looking.reachability, null);
});

test('A rollup without a scanners map reports reachability as null', () => {
  const r = buildReport({ name: 'p' }, null, { corroboration: 0 }, [], ann(), AT);
  assert.equal(r.looking.corroboration, null);
  assert.equal(r.looking.reachability, null);
});
