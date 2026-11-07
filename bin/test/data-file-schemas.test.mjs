// The three manifests data files bind to schema/<stem>.schema.json by name, the rule
// monitor/test/schema-canon.test.mjs and spine's compile/config/declared.mjs both apply.
// Each schema refuses a broken copy at the broken key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from '../../monitor/registry.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STEMS = ['eol-snapshot', 'install-catalog', 'security-baseline.map'];
const schemaPath = (stem) => resolve(REPO, 'schema', `${stem}.schema.json`);
const load = (stem) => JSON.parse(readFileSync(resolve(REPO, 'manifests', `${stem}.json`), 'utf8'));
const errorsFor = (stem, doc) => validateAgainstSchema(doc, { path: schemaPath(stem) }).errors;

function refusedAt(stem, doc, where) {
  const errors = errorsFor(stem, doc);
  assert.ok(errors.some((e) => e.startsWith(`schema: ${where}`)), `expected a refusal at ${where}, got:\n${errors.join('\n')}`);
}

test('each data file has a by-name schema, the inventory names it, and the shipped file satisfies it', () => {
  const inventory = JSON.parse(readFileSync(resolve(REPO, 'monitor', 'registry-inventory.json'), 'utf8'));
  for (const stem of STEMS) {
    assert.ok(existsSync(schemaPath(stem)), `schema/${stem}.schema.json is missing`);
    const row = inventory.entries.find((e) => e.path === `manifests/${stem}.json`);
    assert.equal(row?.schema, `schema/${stem}.schema.json`, `inventory row for ${stem}`);
    assert.deepEqual(errorsFor(stem, load(stem)), [], stem);
  }
});

test('eol-snapshot refuses a non-ISO eol date, an unknown cycle key and an empty product', () => {
  const [product] = Object.keys(load('eol-snapshot').products);
  const badDate = load('eol-snapshot');
  badDate.products[product][0].eol = '2021/04/30';
  refusedAt('eol-snapshot', badDate, `products.${product}[0].eol`);

  const extra = load('eol-snapshot');
  extra.products[product][0].lts = true;
  refusedAt('eol-snapshot', extra, `products.${product}[0]: unknown key 'lts'`);

  const empty = load('eol-snapshot');
  empty.products[product] = [];
  refusedAt('eol-snapshot', empty, `products.${product}: needs at least 1`);
});

test('install-catalog refuses a misspelt manager, an unknown id state and a non-hex pin', () => {
  const cat = load('install-catalog');
  const [tool] = Object.keys(cat.tools);
  const typo = load('install-catalog');
  typo.tools[tool].brw = 'x';
  refusedAt('install-catalog', typo, `tools.${tool}: unknown key 'brw'`);

  const state = load('install-catalog');
  state.idChecksByManager = { brew: { state: 'verified', checkedAt: null, how: 'probed every id in one pass' } };
  refusedAt('install-catalog', state, 'idChecksByManager.brew.state');

  const pinned = Object.keys(cat.tools).find((n) => cat.tools[n].release?.darwin?.x64);
  assert.ok(pinned, 'precondition: a tool with a pinned darwin x64 release');
  const pin = load('install-catalog');
  pin.tools[pinned].release.darwin.x64.sha256 = 'ABC';
  refusedAt('install-catalog', pin, `tools.${pinned}.release.darwin.x64.sha256`);
});

test('install-catalog refuses a cosign block missing what lib/release-signing.mjs requires', () => {
  const cat = load('install-catalog');
  const signed = Object.keys(cat.tools).find((n) => cat.tools[n].release?.signing?.kind === 'cosign-checksums');
  assert.ok(signed, 'precondition: a tool with a cosign-checksums signing block');
  for (const key of ['checksums', 'identity', 'issuer']) {
    const doc = load('install-catalog');
    delete doc.tools[signed].release.signing[key];
    refusedAt('install-catalog', doc, `tools.${signed}.release.signing: matched 0 of 2 oneOf`);
  }
});

test('install-catalog keeps both postInstall and steps shapes, and refuses an empty argv', () => {
  const ok = load('install-catalog');
  const [tool] = Object.keys(ok.tools);
  ok.tools[tool].postInstall = [['run', 'this'], 'a note'];
  ok.tools[tool].steps = { 'check-id': 'do this' };
  assert.deepEqual(errorsFor('install-catalog', ok), []);

  const empty = load('install-catalog');
  empty.tools[tool].postInstall = [[]];
  refusedAt('install-catalog', empty, `tools.${tool}.postInstall[0]: needs at least 1`);
});

test('security-baseline.map refuses a string line and an unknown entry key', () => {
  const map = load('security-baseline.map');
  const [id] = Object.keys(map.byId);
  const line = load('security-baseline.map');
  line.byId[id].line = '12';
  refusedAt('security-baseline.map', line, `byId.${id}.line`);

  const extra = load('security-baseline.map');
  extra.byId[id].owner = 'x';
  refusedAt('security-baseline.map', extra, `byId.${id}: unknown key 'owner'`);
});
