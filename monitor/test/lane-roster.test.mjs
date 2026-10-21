// monitor/test/lane-roster.test.mjs — every bundled manifest check is in a lane or says why it is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LANE_ROSTER, OFF_SPEC_LANES, feedersOf, accountChecks, accountBundled, readBaselineChecks, readBundledChecks,
  manifestsDir, _osvCveCounts, _npmAuditCounts, _authzTestCounts } from '../lane-roster.mjs';
import { laneTrust } from '../lane-trust.mjs';
import { laneSpec, manifestCheck } from '../../bin/lane-fixture.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'cw-lane-roster-'));

// The gate. Read at test time from the bundled manifests themselves, never a pinned list: a check
// added to any of them with no lane and no notALane reason is invisible to lane-trust and
// lane-capability, and its findings would carry no fixture source, canary result or trust statement.
test('every bundled manifest check feeds a lane or is marked notALane with a reason', () => {
  const bundled = readBundledChecks();
  assert.ok(bundled, 'the bundled manifests are absent');
  const { unaccounted } = accountBundled(bundled);
  assert.deepEqual(unaccounted.map((u) => `${u.manifest}/${u.check}: ${u.why}`), [],
    'give each check a lane (a SCANNER_SPECS row, a CHECK_ALIASES entry or an OFF_SPEC_LANES row, '
    + 'with its golden fixture), or mark it `"notALane": "<reason>"` in its manifests/<name>.json '
    + 'when no reader derives a finding from its output');
});

// The gate's floor: it must read every manifest bin/commitwork.mjs and the MCP server would run, so
// a dummy check planted in each non-baseline one has to come back unaccounted from that manifest.
test('the gate reads every bundled check manifest, not only the baseline', () => {
  const real = readBundledChecks();
  const names = Object.keys(real).filter((n) => n !== 'security-baseline');
  assert.ok(names.length >= 4, `only ${names.join(', ')} declare checks besides the baseline`);
  const dir = join(scratch(), 'manifests');
  cpSync(manifestsDir(), dir, { recursive: true });
  for (const n of names) {
    const p = join(dir, `${n}.json`);
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    doc.checks.push({ id: 'planted-dummy', local: ['true'] });
    writeFileSync(p, JSON.stringify(doc));
  }
  const { unaccounted } = accountBundled(readBundledChecks({ dir }));
  assert.deepEqual(unaccounted.map((u) => u.manifest).sort(), names.sort());
  assert.ok(unaccounted.every((u) => u.check === 'planted-dummy'));
});

test('a check marked notALane writes no artifact any lane extractor reads', () => {
  const read = new Map();
  for (const [category] of LANE_ROSTER) for (const a of laneSpec(category).artifacts) read.set(a, category);
  const misfiled = Object.entries(readBundledChecks()).flatMap(([m, checks]) => checks
    .filter((c) => c.notALane && c.report && read.has(c.report.file))
    .map((c) => `${m}/${c.id} writes ${c.report.file}, which lane ${read.get(c.report.file)} reads`));
  assert.deepEqual(misfiled, []);
});

test('a check that feeds a lane it is not primary for writes that lane\'s artifact', () => {
  const wrong = [];
  for (const row of LANE_ROSTER) {
    const { artifacts } = laneSpec(row[0]);
    for (const id of Object.keys(feedersOf(row))) {
      const c = manifestCheck(id);
      if (!c) { wrong.push(`${id} is declared a feeder of ${row[0]} and no bundled manifest declares it`); continue; }
      if (!artifacts.includes(c.report && c.report.file)) wrong.push(`${id} writes ${c.report && c.report.file}; ${row[0]} reads ${artifacts.join(', ')}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('the finding-producing checks without a SCANNER_SPECS row are each in a lane', () => {
  const { lanes } = accountBundled(readBundledChecks());
  assert.deepEqual(['authz-test', 'npm-audit', 'sast-opengrep', 'yarn-audit'].map((id) => lanes['security-baseline'][id]),
    ['authzIsolation', 'depsNpmAudit', 'sastSemgrep', 'depsNpmAudit']);
  assert.equal(lanes.runtime['tls-testssl'], 'tlsTestssl');
  for (const [category, , , meta] of OFF_SPEC_LANES) {
    assert.ok(meta.kind, `${category} names its kind`);
    assert.ok(!!meta.readBy !== !!meta.unread, `${category} names its reader or says why none reads it, not both`);
  }
});

test('build-health and quality-gates write statuses, so every check in them is notALane', () => {
  const { notLanes, manifests } = accountBundled(readBundledChecks());
  for (const m of ['build-health', 'quality-gates']) {
    assert.equal(manifests[m].notLanes, manifests[m].declared, `${m}: every check carries a notALane reason`);
    for (const [id, { reason }] of Object.entries(notLanes[m])) assert.match(reason, /^Status, not findings/, `${m}/${id}`);
  }
});

const ROSTER = [['alpha', 'alpha-check', () => null], ['beta', 'beta-check', () => null, { readBy: 'r', also: { 'beta-twin': 'same file' } }],
  ['gamma', 'gamma-check', () => null, { unread: 'nothing parses it' }]];
const ALIASES = { 'alpha-alias': 'alpha-check' };

test('accountChecks: primary, alias, also, not-a-lane, and every unaccounted shape', () => {
  const r = accountChecks([
    { id: 'beta-check' }, { id: 'alpha-check' }, { id: 'alpha-alias' }, { id: 'beta-twin' },
    { id: 'inventory', notALane: '  writes an inventory  ' },
    { id: 'blank', notALane: ' ' }, { id: 'not-text', notALane: true },
    { id: 'both', notALane: 'x' }, { id: 'nothing' },
  ], [...ROSTER, ['delta', 'both', () => null]], ALIASES);
  assert.deepEqual(r.lanes, { 'alpha-alias': 'alpha', 'alpha-check': 'alpha', 'beta-check': 'beta', 'beta-twin': 'beta' });
  assert.deepEqual(r.notLanes, { inventory: { reason: 'writes an inventory' } });
  assert.deepEqual(r.unaccounted.map((u) => u.check), ['blank', 'both', 'not-text', 'nothing']);
  assert.match(r.unaccounted.find((u) => u.check === 'both').why, /also marked notALane/);
  assert.equal(r.declared, 9);
});

test('feedersOf merges declared aliases with a row\'s own feeders, sorted', () => {
  assert.deepEqual(Object.keys(feedersOf(ROSTER[0], ALIASES)), ['alpha-alias']);
  assert.deepEqual(feedersOf(ROSTER[1], ALIASES), { 'beta-twin': 'same file' });
});

test('readBaselineChecks: absent is null, torn throws, CW_BASELINE_MANIFEST is read at call time', () => {
  const d = scratch();
  assert.equal(readBaselineChecks(join(d, 'none.json')), null);
  writeFileSync(join(d, 'torn.json'), '{torn');
  assert.throws(() => readBaselineChecks(join(d, 'torn.json')), SyntaxError);
  writeFileSync(join(d, 'no-checks.json'), '{}');
  assert.throws(() => readBaselineChecks(join(d, 'no-checks.json')), /no checks array/);
  writeFileSync(join(d, 'm.json'), JSON.stringify({ checks: [{ id: 'only' }] }));
  process.env.CW_BASELINE_MANIFEST = join(d, 'm.json');
  try { assert.deepEqual(readBaselineChecks(), [{ id: 'only' }]); } finally { delete process.env.CW_BASELINE_MANIFEST; }
});

test('readBundledChecks: data files declare none, absent is null, malformed throws, both envs read at call time', () => {
  const d = scratch();
  const dir = join(d, 'manifests');
  const baseline = join(d, 'baseline.json');
  assert.equal(readBundledChecks({ dir, baseline }), null, 'no baseline');
  writeFileSync(baseline, JSON.stringify({ checks: [{ id: 'b' }] }));
  assert.equal(readBundledChecks({ dir, baseline }), null, 'no manifests directory');
  mkdirSync(dir);
  writeFileSync(join(dir, 'security-baseline.json'), JSON.stringify({ checks: [{ id: 'ignored' }] }));
  writeFileSync(join(dir, 'zeta.json'), JSON.stringify({ checks: [{ id: 'z' }] }));
  writeFileSync(join(dir, 'formats.json'), JSON.stringify({ formats: {} }));
  writeFileSync(join(dir, 'notes.txt'), 'not a manifest');
  assert.deepEqual(readBundledChecks({ dir, baseline }), { 'security-baseline': [{ id: 'b' }], zeta: [{ id: 'z' }] });
  process.env.CW_MANIFESTS_DIR = dir;
  process.env.CW_BASELINE_MANIFEST = baseline;
  try { assert.deepEqual(Object.keys(readBundledChecks()), ['security-baseline', 'zeta']); } finally {
    delete process.env.CW_MANIFESTS_DIR; delete process.env.CW_BASELINE_MANIFEST;
  }
  writeFileSync(join(dir, 'odd.json'), JSON.stringify({ checks: {} }));
  assert.throws(() => readBundledChecks({ dir, baseline }), /odd\.json: checks is not an array/);
  writeFileSync(join(dir, 'odd.json'), '{torn');
  assert.throws(() => readBundledChecks({ dir, baseline }), SyntaxError);
});

test('accountBundled: per-manifest counts, an id two manifests declare counts in each', () => {
  const r = accountBundled({
    one: [{ id: 'alpha-check' }, { id: 'inv', notALane: 'an inventory' }],
    two: [{ id: 'alpha-check' }, { id: 'stray' }],
  }, ROSTER, ALIASES);
  assert.equal(r.declared, 4);
  assert.deepEqual(r.manifests, { one: { declared: 2, inLanes: 1, notLanes: 1, unaccounted: 0 },
    two: { declared: 2, inLanes: 1, notLanes: 0, unaccounted: 1 } });
  assert.deepEqual(r.lanes, { one: { 'alpha-check': 'alpha' }, two: { 'alpha-check': 'alpha' } });
  assert.deepEqual(r.notLanes, { one: { inv: { reason: 'an inventory' } }, two: {} });
  assert.deepEqual(r.unaccounted, [{ manifest: 'two', check: 'stray', why: 'no lane reads it and it is not marked notALane' }]);
});

test('lane-trust lists a not-a-lane check with its reason and an unaccounted one by name', () => {
  const none = { state: 'not-measured', why: 'x', rollups: [] };
  const canary = { read: false, byCategory: {} };
  const r = laneTrust({ specs: ROSTER, fixtures: scratch(), canary, fleet: none,
    checks: { base: [{ id: 'alpha-check' }, { id: 'sbom-like', notALane: 'an inventory' }], other: [{ id: 'stray' }] } });
  assert.deepEqual(r.notLanes, { base: { 'sbom-like': { reason: 'an inventory' } }, other: {} });
  assert.deepEqual(r.unaccounted.map((u) => `${u.manifest}/${u.check}`), ['other/stray']);
  assert.deepEqual(r.summary.checks, { declared: 3, inLanes: 1, notLanes: 1, unaccounted: 1,
    manifests: { base: { declared: 2, inLanes: 1, notLanes: 1, unaccounted: 0 }, other: { declared: 1, inLanes: 0, notLanes: 0, unaccounted: 1 } } });
  assert.deepEqual(r.lanes.beta.alsoFrom, { 'beta-twin': 'same file' });
  const unread = laneTrust({ specs: ROSTER, fixtures: scratch(), canary, fleet: none });
  assert.equal(unread.summary.checks.state, 'not-measured', 'no manifest is not zero unaccounted');
  assert.equal(unread.notLanes, undefined);
});

test('an off-spec lane\'s undetermined column names its reader, never a share', () => {
  const fleet = { state: 'read', rollups: [{ scanners: { beta: { crit: 1, undetermined: 1 } } }], areas: {} };
  const r = laneTrust({ specs: ROSTER, fixtures: scratch(), canary: { read: false, byCategory: {} }, fleet });
  assert.equal(r.lanes.beta.undetermined.state, 'not-measured');
  assert.match(r.lanes.beta.undetermined.why, /reach r$/);
  assert.equal(r.lanes.beta.readBy, 'r');
  assert.equal(r.lanes.gamma.undetermined.state, 'not-measured');
  assert.match(r.lanes.gamma.undetermined.why, /no report reads its findings: nothing parses it$/);
  assert.equal(r.lanes.gamma.unread, 'nothing parses it');
  assert.equal(r.lanes.gamma.readBy, undefined);
});

test('off-spec extractors: absent is null, torn is unparseable, rows count', () => {
  const d = scratch();
  assert.equal(_npmAuditCounts(d, 'npm-audit.json'), null);
  assert.equal(_authzTestCounts(d, 'authz.json'), null);
  writeFileSync(join(d, 'npm-audit.json'), '{torn');
  writeFileSync(join(d, 'authz.json'), '{torn');
  assert.equal(_npmAuditCounts(d, 'npm-audit.json').unparseable, true);
  assert.equal(_authzTestCounts(d, 'authz.json').unparseable, true);
  writeFileSync(join(d, 'npm-audit.json'), JSON.stringify({ vulnerabilities: { pkg: { severity: 'high', via: [{ url: 'https://example.invalid/a', severity: 'high', title: 't' }] } } }));
  writeFileSync(join(d, 'authz.json'), JSON.stringify({ findings: [{ type: 'cross-tenant-read', severity: 'high', path: '/x' }] }));
  assert.equal(_npmAuditCounts(d, 'npm-audit.json').total, 1);
  assert.equal(_authzTestCounts(d, 'authz.json').total, 1);
});

test('depsOsv counts every osv.sarif row the dependency-CVE totals count, MAL- included', () => {
  const d = scratch();
  assert.equal(_osvCveCounts(d, 'osv.sarif'), null);
  writeFileSync(join(d, 'osv.sarif'), '{torn');
  assert.equal(_osvCveCounts(d, 'osv.sarif').unparseable, true);
  const result = (id, pkg) => ({ ruleId: id, message: { text: `Package '${pkg}' is vulnerable to '${id}'.` },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///src/package-lock.json' } } }] });
  writeFileSync(join(d, 'osv.sarif'), JSON.stringify({ version: '2.1.0', runs: [{
    tool: { driver: { name: 'osv-scanner', rules: [{ id: 'CVE-2000-0001', properties: { 'security-severity': '7.5' } }, { id: 'MAL-2000-1' }] } },
    results: [result('CVE-2000-0001', 'left-pad@1.0.0'), result('MAL-2000-1', 'evil-pkg@1.0.0')],
  }] }));
  const r = _osvCveCounts(d, 'osv.sarif');
  assert.equal(r.total, 2);
  assert.deepEqual(r.findings.map((f) => [f.id, f.malicious]), [['CVE-2000-0001', false], ['MAL-2000-1', true]]);
});
