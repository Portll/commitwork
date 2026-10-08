// node --test cra/test/oscal.test.mjs — the OSCAL component-definition carries NIST 800-53 and
// SOC 2 TSC control-implementations, passes a structural check of OSCAL 1.1's required fields, and
// never presents an unsupplied SOC 2 criterion as met. Synthetic fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildOscal, oscalUUID } from '../oscal.mjs';
import { coverageFor, loadControls, ranChecksFromSweep } from '../controls.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIX = join(HERE, 'fixtures');
const NOW = '2026-07-20T00:00:00.000Z';
const read = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));

// OSCAL 1.1 metaschema datatypes, as the JSON schema states them.
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[45][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/;
const TOKEN = /^(\p{L}|_)(\p{L}|\p{N}|[.\-_])*$/u;
const DATETIME_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const IMPL_STATUS = new Set(['implemented', 'partial', 'planned', 'alternative', 'not-applicable']);

function controls() { return loadControls(join(REPO, 'cra', 'controls.json')); }
function coverage(product) {
  const c = controls();
  const cov = coverageFor(product, c, read('rollup.json'), read('ledger.json').entries, read('annotations.json'),
    ranChecksFromSweep(join(FIX, 'sweep'), product.repos));
  cov.slice = 'sweep-test';
  return { c, cov };
}
const PRODUCT = { id: 'p', name: 'P', version: '1.0', repos: ['repo-a'] };

// Every field OSCAL 1.1.x marks required on the path this document uses, plus the datatypes.
function assertStructurallyValid(doc) {
  assert.deepEqual(Object.keys(doc), ['component-definition']);
  const cd = doc['component-definition'];
  const uuids = [];
  const uuidOk = (u, where) => { assert.match(u, UUID, `${where}: uuid`); uuids.push(u); };
  const propsOk = (props, where) => {
    if (props === undefined) return;
    assert.ok(Array.isArray(props) && props.length, `${where}: props is a non-empty array`);
    for (const pr of props) {
      assert.match(pr.name, TOKEN, `${where}: prop name`);
      assert.equal(typeof pr.value, 'string', `${where}: prop value`);
      assert.ok(pr.value.trim().length, `${where}: prop value non-empty`);
      if (pr.ns !== undefined) assert.match(pr.ns, /^https?:\/\//, `${where}: prop ns is a URI`);
    }
  };
  uuidOk(cd.uuid, 'component-definition');
  for (const k of ['title', 'last-modified', 'version', 'oscal-version']) assert.ok(cd.metadata?.[k], `metadata.${k}`);
  assert.match(cd.metadata['last-modified'], DATETIME_TZ);
  assert.match(cd.metadata['oscal-version'], /^1\.1\.\d+$/);
  propsOk(cd.metadata.props, 'metadata');
  assert.ok(Array.isArray(cd.components) && cd.components.length);
  for (const comp of cd.components) {
    uuidOk(comp.uuid, 'component');
    for (const k of ['type', 'title', 'description']) assert.ok(comp[k], `component.${k}`);
    propsOk(comp.props, 'component');
    for (const ci of comp['control-implementations']) {
      uuidOk(ci.uuid, 'control-implementation');
      assert.match(ci.source, /^https?:\/\/\S+$/, 'control-implementation.source');
      assert.ok(ci.description, 'control-implementation.description');
      propsOk(ci.props, 'control-implementation');
      assert.ok(ci['implemented-requirements'].length, 'implemented-requirements is non-empty');
      for (const r of ci['implemented-requirements']) {
        uuidOk(r.uuid, r['control-id']);
        assert.match(r['control-id'], TOKEN);
        assert.ok(r.description, `${r['control-id']}: description`);
        propsOk(r.props, r['control-id']);
        const impl = r.props.filter((x) => x.name === 'implementation-status');
        assert.ok(impl.length <= 1);
        if (impl[0]) assert.ok(IMPL_STATUS.has(impl[0].value), `${r['control-id']}: implementation-status`);
      }
    }
  }
  assert.equal(new Set(uuids).size, uuids.length, 'every uuid is unique');
}

const byFramework = (doc) => Object.fromEntries(doc['component-definition'].components[0]['control-implementations']
  .map((ci) => [ci.props.find((x) => x.name === 'framework').value, ci]));
const prop = (r, name) => r.props.find((x) => x.name === name)?.value;

test('oscalUUID is content-derived and always matches the OSCAL uuid pattern', () => {
  for (let i = 0; i < 500; i++) assert.match(oscalUUID(`seed-${i}`), UUID);
  assert.equal(oscalUUID('a'), oscalUUID('a'));
  assert.notEqual(oscalUUID('a'), oscalUUID('b'));
});

test('component-definition is structurally valid OSCAL with a NIST and a SOC 2 control-implementation', () => {
  const { c, cov } = coverage(PRODUCT);
  const doc = buildOscal(cov, c, NOW);
  assertStructurallyValid(doc);
  assert.equal(doc['component-definition'].metadata['last-modified'], NOW);
  const fw = byFramework(doc);
  assert.deepEqual(Object.keys(fw), ['nist-sp-800-53-rev5', 'aicpa-tsc-2017']);
  assert.equal(fw['aicpa-tsc-2017'].source, c.frameworks.soc2.catalogSource);
});

test('SOC 2: all 33 common criteria listed; an unsupplied criterion is not-evidenced and carries no implementation-status', () => {
  const { c, cov } = coverage(PRODUCT);
  const soc = byFramework(buildOscal(cov, c, NOW))['aicpa-tsc-2017']['implemented-requirements'];
  assert.equal(soc.length, c.frameworks.soc2.commonCriteria);
  assert.equal(soc[0]['control-id'], 'cc1.1');
  assert.equal(soc.at(-1)['control-id'], 'cc9.2');

  const mapped = new Set(cov.frameworks.soc2.rows.map((r) => r.control.toLowerCase()));
  for (const r of soc) {
    const status = prop(r, 'evidence-status');
    if (!mapped.has(r['control-id'])) {
      assert.equal(status, 'not-evidenced', r['control-id']);
      assert.equal(prop(r, 'implementation-status'), undefined, `${r['control-id']} is never asserted`);
      assert.match(r.description, /Not evidenced/);
    } else {
      assert.ok(['evidenced', 'mapped'].includes(status));
      assert.equal(prop(r, 'implementation-status'), status === 'evidenced' ? 'implemented' : 'planned');
    }
  }
  // CC1.1 (control environment) is organizational: nothing in the crosswalk can supply it.
  assert.equal(prop(soc.find((r) => r['control-id'] === 'cc1.1'), 'evidence-status'), 'not-evidenced');
  // CC7.1 is supplied by checks that ran on the fixture repo, and cites them.
  const cc71 = soc.find((r) => r['control-id'] === 'cc7.1');
  assert.equal(prop(cc71, 'evidence-status'), 'evidenced');
  assert.match(cc71.description, /Evidenced by /);
  // Counts in the description agree with the requirements.
  const desc = byFramework(buildOscal(cov, c, NOW))['aicpa-tsc-2017'].description;
  const n = (s) => soc.filter((r) => prop(r, 'evidence-status') === s).length;
  assert.match(desc, new RegExp(`maps ${mapped.size} of 33 criteria; ${n('evidenced')} are currently evidenced and ${n('not-evidenced')} have no supplying`));
});

test('a product with no scanned repo implements no SOC 2 criterion', () => {
  const { c, cov } = coverage({ id: 'q', name: 'Q', version: '0.1', repos: ['repo-not-in-fixtures'] });
  const doc = buildOscal(cov, c, NOW);
  assertStructurallyValid(doc);
  for (const ci of Object.values(byFramework(doc))) {
    for (const r of ci['implemented-requirements']) assert.notEqual(prop(r, 'implementation-status'), 'implemented', r['control-id']);
  }
});

test('missing SOC 2 catalog source fails closed instead of emitting an invalid control-implementation', () => {
  const { c, cov } = coverage(PRODUCT);
  delete c.frameworks.soc2.catalogSource;
  assert.throws(() => buildOscal(cov, c, NOW), /catalogSource/);
});

test('CLI: CW_CRA_NOW pins last-modified, re-runs are byte-identical, no tmp file is left', () => {
  const T = mkdtempSync(join(tmpdir(), 'cra-oscal-'));
  try {
    mkdirSync(join(T, 'reports'), { recursive: true });
    cpSync(join(FIX, 'sweep'), join(T, 'reports', 'sweep-20260720T000000'), { recursive: true });
    const env = {
      ...process.env,
      CW_CRA_ROOT: T,
      CW_ROLLUP: join(FIX, 'rollup.json'),
      CW_PRODUCTS: join(FIX, 'products.json'),
      CW_LEDGER: join(FIX, 'ledger.json'),
      CW_ANNOTATIONS: join(FIX, 'annotations.json'),
      CW_CONTROLS: join(REPO, 'cra', 'controls.json'),
      CW_CRA_OUT: join(T, 'out'),
      CW_CRA_NOW: NOW,
    };
    const run = () => spawnSync('node', [join(REPO, 'cra', 'oscal.mjs'), '--product', 'prod-eu'], { env, encoding: 'utf8' });
    const r1 = run();
    assert.equal(r1.status, 0, r1.stderr);
    const out = join(T, 'out', 'oscal', 'prod-eu.oscal.json');
    const first = readFileSync(out, 'utf8');
    const doc = JSON.parse(first);
    assertStructurallyValid(doc);
    assert.equal(doc['component-definition'].metadata['last-modified'], NOW);
    assert.match(r1.stdout, /aicpa-tsc-2017 \d+\/33 evidenced/);
    assert.equal(run().status, 0);
    assert.equal(readFileSync(out, 'utf8'), first);
    assert.deepEqual(readdirSync(join(T, 'out', 'oscal')), ['prod-eu.oscal.json']);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});
