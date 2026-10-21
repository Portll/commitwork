// monitor/test/lane-trust.test.mjs — the three trust columns, on synthetic inputs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { laneTrust, readRollups, canaryColumn, fixtureColumn, undeterminedColumn, readProvenance } from '../lane-trust.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const SPECS = [['alpha', 'alpha-check'], ['beta', 'beta-check'], ['gamma', 'gamma-check'], ['delta', 'delta-check']];

function fixtures() {
  const d = mkdtempSync(join(tmpdir(), 'cw-lane-trust-fx-'));
  for (const c of ['alpha', 'beta', 'gamma']) { mkdirSync(join(d, c)); writeFileSync(join(d, c, 'out.json'), '{}\n'); }
  writeFileSync(join(d, 'PROVENANCE.json'), JSON.stringify({ lanes: {
    alpha: { source: 'real', accepted: '2026-01-01' },
    beta: { source: 'synthetic', why: 'the tool reads a live target', accepted: '2026-01-02' },
  } }));
  return d;
}

function fleet(rollups) {
  const root = mkdtempSync(join(tmpdir(), 'cw-lane-trust-rep-'));
  const areas = [];
  rollups.forEach((r, i) => {
    const slug = `area-${i}`;
    areas.push({ slug });
    if (r === null) return;
    mkdirSync(join(root, slug));
    writeFileSync(join(root, slug, 'rollup.json'), typeof r === 'string' ? r : JSON.stringify(r));
  });
  return { reportsRoot: root, areas };
}

const CANARY = { read: true, date: '2026-01-03', byCategory: {
  alpha: [{ lane: 'synthetic-lane', date: '2026-01-03', verdict: 'BOTH DIRECTIONS DEMONSTRATED', credits: true }],
  beta: [{ lane: 'other-lane', date: '2026-01-04', verdict: 'DIRTY TREE SILENT', credits: false }],
} };

test('fixture source: real, synthetic with its reason, unrecorded, no-fixture', () => {
  const r = laneTrust({ specs: SPECS, fixtures: fixtures(), canary: CANARY, fleet: { state: 'not-measured', why: 'x', rollups: [] } });
  assert.equal(r.lanes.alpha.fixture.source, 'real');
  assert.deepEqual(r.lanes.beta.fixture, { source: 'synthetic', accepted: '2026-01-02', reason: 'the tool reads a live target' });
  assert.equal(r.lanes.gamma.fixture.source, 'unrecorded');
  assert.equal(r.lanes.delta.fixture.source, 'no-fixture');
  assert.deepEqual(r.summary.fixtureSource, { 'no-fixture': 1, real: 1, synthetic: 1, unrecorded: 1 });
});

test('an unrecognised provenance source is unrecorded, with the recorded value kept', () => {
  assert.deepEqual(fixtureColumn('x', { x: { source: 'guessed' } }, true),
    { source: 'unrecorded', recorded: 'guessed', why: 'provenance names no recognised source' });
  assert.equal(fixtureColumn('x', null, true).why, 'PROVENANCE.json is absent');
});

test('canary: both directions scored with n/of; other verdicts unscored; none is not-measured', () => {
  const r = laneTrust({ specs: SPECS, fixtures: fixtures(), canary: CANARY, fleet: { state: 'not-measured', why: 'x', rollups: [] } });
  assert.deepEqual(r.lanes.alpha.canary.falseClean, { state: 'measured', n: 0, of: 1, rate: 0 });
  assert.deepEqual(r.lanes.alpha.canary.falseAlarm, { state: 'measured', n: 0, of: 1, rate: 0 });
  assert.equal(r.lanes.beta.canary.state, 'unscored');
  assert.equal(r.lanes.beta.canary.verdicts[0].verdict, 'DIRTY TREE SILENT');
  assert.equal(r.lanes.beta.canary.falseClean, undefined, 'an unscored record carries no rate');
  assert.equal(r.lanes.gamma.canary.state, 'not-measured');
  assert.equal(canaryColumn(undefined, false).why, 'no scan-canary record');
});

test('undetermined share sums every area and divides by graded + undetermined', () => {
  const reg = fleet([
    { scanners: { alpha: { crit: 1, high: 1, undetermined: 2, total: 2 }, beta: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } },
    { scanners: { alpha: { med: 4, low: 0, undetermined: 0 } } },
    null,
  ]);
  const fl = readRollups(reg);
  assert.deepEqual(fl.areas, { declared: 3, read: 2, absent: 1 });
  const r = laneTrust({ specs: SPECS, fixtures: fixtures(), canary: CANARY, fleet: fl });
  assert.deepEqual(r.lanes.alpha.undetermined, { state: 'measured', undetermined: 2, graded: 6, of: 8, share: 0.25, areas: 2 });
  assert.equal(r.lanes.beta.undetermined.state, 'not-measured', 'zero findings is no share, never 0%');
  assert.equal(r.lanes.gamma.undetermined.state, 'not-measured');
  assert.equal(r.summary.undetermined.medianShare, 0.25);
  assert.equal(r.summary.undetermined.lanesWithAnyUndetermined, 1);
});

test('a non-count bucket makes the column unreadable, never a number', () => {
  const fl = { state: 'read', rollups: [{ scanners: { alpha: { crit: 'many', undetermined: 1 } } }] };
  assert.equal(undeterminedColumn('alpha', fl).state, 'unreadable');
});

test('fail closed: an unreadable rollup or provenance throws; only ENOENT is absence', () => {
  assert.throws(() => readRollups(fleet(['{not json'])));
  const d = fixtures();
  writeFileSync(join(d, 'PROVENANCE.json'), '{torn');
  assert.throws(() => readProvenance(d));
  assert.equal(readProvenance(mkdtempSync(join(tmpdir(), 'cw-lane-trust-empty-'))), null);
});

test('no rollup anywhere, or the example registry, is not-measured', () => {
  assert.equal(readRollups(fleet([null, null])).state, 'not-measured');
  assert.equal(readRollups({ areas: [] }, { example: true }).state, 'not-measured');
});

test('CW_LANE_FIXTURES is read at call time', () => {
  const d = fixtures();
  process.env.CW_LANE_FIXTURES = d;
  try {
    const r = laneTrust({ specs: SPECS, canary: CANARY, fleet: { state: 'not-measured', why: 'x', rollups: [] } });
    assert.equal(r.lanes.beta.fixture.source, 'synthetic');
  } finally { delete process.env.CW_LANE_FIXTURES; }
});

test('CLI: byte-identical output under CW_NOW, written where CW_LANE_TRUST_OUT says', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'cw-lane-trust-out-')), 'lane-trust.json');
  const env = { ...process.env, CW_NOW: '2026-01-05T00:00:00.000Z', CW_LANE_TRUST_OUT: out,
    CW_REGISTRY: join(CW, 'monitor', 'projects.example.json'), CW_LANE_FIXTURES: fixtures() };
  delete env.CW_REGISTRY_REQUIRE_REAL;
  const run = () => {
    const p = spawnSync(process.execPath, [join(CW, 'monitor', 'lane-trust.mjs')], { env, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    return readFileSync(out, 'utf8');
  };
  const a = run();
  assert.equal(run(), a);
  const j = JSON.parse(a);
  assert.equal(j.generated, '2026-01-05T00:00:00.000Z');
  assert.equal(j.inputs.fleet.state, 'not-measured');
  assert.ok(Object.values(j.lanes).every((l) => l.undetermined.state === 'not-measured'));
});

// ---- the band has a producer: band, positiveControl and defectSignature columns ------------------

const NOW = '2026-01-05T00:00:00.000Z';
const FLEET_SIGS = { at: NOW, scope: 'fleet', thresholds: { rate: 0.95, minRepos: 20 }, areas: { declared: 3, read: 3, absent: 0, failed: 0 }, pooledFrom: ['a', 'b', 'c'],
  population: { alpha: 21 }, detectors: [{ detector: 'alpha/approvals', lane: 'alpha', id: 'approvals', population: 21, positives: 21, rate: 1, signature: true }],
  signatures: [{ detector: 'alpha/approvals', lane: 'alpha', rate: 1, population: 21, positives: 21, signature: true }], unkeyed: {} };
const NO_FLEET = { state: 'not-measured', why: 'x', rollups: [] };

test('a lane with a current canary and a fleet signature: band unmeasured (no adjudications), control current, signature true', () => {
  const r = laneTrust({ specs: SPECS, fixtures: fixtures(), canary: CANARY, fleet: NO_FLEET, signatures: FLEET_SIGS, now: NOW });
  assert.equal(r.lanes.alpha.band.band, 'unmeasured');
  assert.equal(r.lanes.alpha.band.why, 'no adjudicated findings');
  assert.deepEqual(r.lanes.alpha.positiveControl, { state: 'current', at: '2026-01-03' });
  assert.deepEqual(r.lanes.alpha.defectSignature, { state: true, detectors: ['alpha/approvals'] });
  assert.deepEqual(r.lanes.beta.defectSignature, { state: false });
  assert.equal(r.lanes.beta.positiveControl.state, 'missed', 'a canary verdict short of both directions is a missed control');
  assert.deepEqual(r.summary.band, { unmeasured: 4 });
  assert.deepEqual(r.summary.positiveControl, { absent: 2, current: 1, missed: 1 });
  assert.deepEqual(r.summary.defectSignature, { false: 3, true: 1, flagged: ['alpha/approvals'] });
  assert.deepEqual(r.inputs.defectSignatures, { state: 'read', scope: 'fleet', at: NOW, areas: FLEET_SIGS.areas });
  assert.equal(r.laneConfidence.lanes.find((l) => l.detector === 'alpha').defectSignature, true);
  assert.ok(Object.values(r.lanes).every((l) => typeof l.band.band === 'string' && Number.isNaN(Number(l.band.band))), 'a band is a word');
});

test('a lane with no canary record shows positiveControl absent', () => {
  const r = laneTrust({ specs: SPECS, fixtures: fixtures(), canary: CANARY, fleet: NO_FLEET, signatures: FLEET_SIGS, now: NOW });
  assert.deepEqual(r.lanes.gamma.positiveControl, { state: 'absent' });
  assert.deepEqual(r.lanes.delta.positiveControl, { state: 'absent' });
  const none = laneTrust({ specs: SPECS, fixtures: fixtures(), canary: { read: false, byCategory: {} }, fleet: NO_FLEET, now: NOW });
  assert.equal(none.lanes.alpha.positiveControl.state, 'absent');
  assert.equal(none.inputs.positiveControls.read, false);
});

test('a canary older than the default max age is stale, aged against the supplied now', () => {
  const r = laneTrust({ specs: SPECS, fixtures: fixtures(), canary: CANARY, fleet: NO_FLEET, now: '2026-03-05T00:00:00.000Z' });
  assert.equal(r.lanes.alpha.positiveControl.state, 'stale');
});

test('the fleet artifact absent: no defectSignature field on any lane, and the summary says not measured', () => {
  const r = laneTrust({ specs: SPECS, fixtures: fixtures(), canary: CANARY, fleet: NO_FLEET, signatures: null, now: NOW });
  assert.ok(Object.values(r.lanes).every((l) => l.defectSignature === undefined));
  assert.deepEqual(r.summary.defectSignature, { state: 'not-measured', why: 'no fleet defect-signature artifact' });
  assert.deepEqual(r.inputs.defectSignatures, { state: 'absent' });
  assert.ok(r.laneConfidence.lanes.every((l) => l.defectSignature === undefined));
});

test('sweepResult: findings are findings; a zero under a missed control is unmeasured, never clean', () => {
  const fl = readRollups(fleet([{ scanners: { alpha: { crit: 1, undetermined: 0 }, beta: { crit: 0, high: 0, med: 0, low: 0, undetermined: 0 } } }]));
  const r = laneTrust({ specs: SPECS, fixtures: fixtures(), canary: CANARY, fleet: fl, now: NOW });
  assert.equal(r.lanes.alpha.sweepResult.result, 'findings');
  assert.equal(r.lanes.beta.sweepResult.result, 'unmeasured');
  assert.equal(r.lanes.gamma.sweepResult, undefined, 'no rollup carries the lane: no count, no result');
});

test('the join is byte-identical across two runs', () => {
  const fx = fixtures();
  const run = () => JSON.stringify(laneTrust({ specs: SPECS, fixtures: fx, canary: CANARY, fleet: NO_FLEET, signatures: FLEET_SIGS, now: NOW }));
  assert.equal(run(), run());
});

test('CLI: lane-confidence.json lands beside lane-trust.json, the fleet artifact is read from CW_DEFECT_SIGNATURES_OUT at call time, both byte-identical', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lane-trust-conf-'));
  const out = join(dir, 'lane-trust.json');
  const sigs = join(dir, 'fleet', 'defect-signatures.json');
  mkdirSync(dirname(sigs));
  writeFileSync(sigs, JSON.stringify(FLEET_SIGS));
  const canaryDir = mkdtempSync(join(tmpdir(), 'cw-lane-trust-canary-'));
  writeFileSync(join(canaryDir, 'EXPECTED.json'), JSON.stringify({ measured: { date: '2026-01-03', lanes: {
    secrets: { clean: 'exit 0', dirty: 'exit 1', verdict: 'BOTH DIRECTIONS DEMONSTRATED' },
  } } }));
  const env = { ...process.env, CW_NOW: NOW, CW_LANE_TRUST_OUT: out, CW_DEFECT_SIGNATURES_OUT: sigs, CW_CANARY_DIR: canaryDir,
    CW_REGISTRY: join(CW, 'monitor', 'projects.example.json'), CW_LANE_FIXTURES: fixtures() };
  delete env.CW_REGISTRY_REQUIRE_REAL;
  delete env.CW_POSITIVE_CONTROLS;
  const run = () => {
    const p = spawnSync(process.execPath, [join(CW, 'monitor', 'lane-trust.mjs'), '--table'], { env, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    return { trust: readFileSync(out, 'utf8'), conf: readFileSync(join(dir, 'lane-confidence.json'), 'utf8'), stdout: p.stdout };
  };
  const a = run();
  const b = run();
  assert.equal(a.trust, b.trust);
  assert.equal(a.conf, b.conf);
  const trust = JSON.parse(a.trust);
  assert.deepEqual(trust.laneConfidence, { artifact: 'lane-confidence.json' });
  assert.equal(trust.lanes.secrets.positiveControl.state, 'current');
  assert.deepEqual(trust.inputs.defectSignatures.scope, 'fleet');
  assert.ok(Object.values(trust.lanes).every((l) => l.defectSignature && l.defectSignature.state === false), 'the fleet artifact names no roster lane, so every lane is false, never absent');
  const conf = JSON.parse(a.conf);
  assert.equal(conf.at, NOW);
  assert.deepEqual(conf.vocabulary.slice(0, 2), ['unmeasured', 'anecdotal']);
  assert.equal(conf.lanes.find((l) => l.detector === 'secrets').positiveControl, 'current');
  assert.ok(conf.lanes.every((l) => l.band === 'unmeasured'), 'no adjudication source: no rung above unmeasured');
  assert.ok(!/"sev"|"severity"|"crit"/.test(a.conf), 'no severity reaches the confidence artifact');
  assert.match(a.stdout, /lane-trust: band \d+ unmeasured · positive control /);
  assert.match(a.stdout, /secrets\s+.*current\s+none/);
  assert.match(a.stdout, /-> .*lane-confidence\.json/);
});
