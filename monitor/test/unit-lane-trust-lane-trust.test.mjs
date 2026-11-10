// Per-lane trust columns and their summary (monitor/lane-trust.mjs laneTrust).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneTrust } from '../lane-trust.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const row = (category, meta = null) => [category, `check-${category}`, null, meta];
const notMeasured = (why) => ({ state: 'not-measured', why });

const run = (over = {}, prepare = () => {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'laneTrust-'));
  try {
    const fixtures = join(dir, 'fixtures');
    const specs = over.specs || [row('a'), row('b')];
    for (const [category] of specs) mkdirSync(join(fixtures, category), { recursive: true });
    prepare(fixtures);
    return laneTrust({
      fixtures,
      canary: { read: true, date: '2025-01-01', byCategory: {} },
      fleet: { state: 'read', areas: 0, rollups: [] },
      controls: { source: 'canary', read: true, lanes: {} },
      now: '2025-01-01T00:00:00.000Z',
      ...over,
      specs,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('lanes come out sorted by category name', () => {
  const r = run({ specs: [row('c'), row('a'), row('b')] });
  assert.deepEqual(Object.keys(r.lanes), ['a', 'b', 'c']);
});

test('a repeated category keeps the later row because equal names stay in input order', () => {
  const r = run({ specs: [['a', 'first', null, null], ['a', 'second', null, null]] });
  assert.equal(r.lanes.a.check, 'second');
  assert.equal(r.summary.lanes, 1);
});

test('lanes with no meta and an empty fleet report every column as not measured', () => {
  const r = run();
  assert.equal('readBy' in r.lanes.a, false);
  assert.equal('unread' in r.lanes.a, false);
  assert.equal('defectSignature' in r.lanes.a, false);
  assert.deepEqual(r.lanes.a.fixture, { source: 'no-fixture' });
  assert.deepEqual(r.lanes.a.canary, notMeasured("the scan canary records no run of this lane's tool"));
  assert.deepEqual(r.lanes.a.undetermined, notMeasured('no rollup carries this lane'));
  assert.equal(r.summary.lanes, 2);
  assert.deepEqual(r.summary.checks, notMeasured('the bundled manifests are absent or were not supplied'));
  assert.deepEqual(r.summary.fixtureSource, { 'no-fixture': 2 });
  assert.deepEqual(r.summary.canary, { 'not-measured': 2 });
  assert.deepEqual(r.summary.undetermined, { 'not-measured': 2, medianShare: null, lanesWithAnyUndetermined: 0 });
  assert.deepEqual(r.summary.defectSignature, notMeasured('no fleet defect-signature artifact'));
  assert.deepEqual(r.inputs, {
    provenance: 'absent',
    canary: { read: true, date: '2025-01-01' },
    fleet: { state: 'read', areas: 0 },
    manifests: 'not-measured',
    positiveControls: { source: 'canary', read: true },
    defectSignatures: { state: 'absent' },
  });
  assert.equal('notLanes' in r, false);
  assert.equal('unaccounted' in r, false);
});

test('a lane read elsewhere or by nothing skips the rollup even when the rollup has its bucket', () => {
  const r = run({
    specs: [row('a', { readBy: 'digest' }), row('b', { unread: 'no consumer' })],
    fleet: { state: 'read', areas: 1, rollups: [{ scanners: { a: { high: 1 }, b: { high: 1 } } }] },
  });
  assert.equal(r.lanes.a.readBy, 'digest');
  assert.equal('unread' in r.lanes.a, false);
  assert.deepEqual(r.lanes.a.undetermined, notMeasured('the rollup carries no scanners bucket for this lane; its findings reach digest'));
  assert.equal(r.lanes.b.unread, 'no consumer');
  assert.equal('readBy' in r.lanes.b, false);
  assert.deepEqual(r.lanes.b.undetermined, notMeasured('the rollup carries no scanners bucket for this lane, and no report reads its findings: no consumer'));
  assert.deepEqual(r.summary.undetermined, { 'not-measured': 2, medianShare: null, lanesWithAnyUndetermined: 0 });
});

test('a fleet that was not read gives its own reason for every lane', () => {
  const r = run({ fleet: { state: 'absent', why: 'no rollup was found', areas: 0 } });
  assert.deepEqual(r.lanes.a.undetermined, notMeasured('no rollup was found'));
  assert.deepEqual(r.summary.undetermined, { 'not-measured': 2, medianShare: null, lanesWithAnyUndetermined: 0 });
  assert.deepEqual(r.inputs.fleet, { state: 'absent', areas: 0 });
});

test('the median share uses measured lanes only and a zero share is not counted as undetermined', () => {
  const fleet = { state: 'read', areas: 2, rollups: [
    { scanners: { a: { high: 2, undetermined: 1 }, b: { med: 2 }, c: { crit: 0 }, d: { low: -1 } } },
    { scanners: { a: { low: 1 } } },
    {},
    null,
  ] };
  const r = run({ specs: [row('a'), row('b'), row('c'), row('d')], fleet });
  assert.deepEqual(r.lanes.a.undetermined, { state: 'measured', undetermined: 1, graded: 3, of: 4, share: 0.25, areas: 2 });
  assert.deepEqual(r.lanes.b.undetermined, { state: 'measured', undetermined: 0, graded: 2, of: 2, share: 0, areas: 1 });
  assert.deepEqual(r.lanes.c.undetermined, { ...notMeasured('the lane published no findings, so no share exists'), areas: 1 });
  assert.deepEqual(r.lanes.d.undetermined, { state: 'unreadable', why: 'a rollup carries a non-count low for this lane' });
  assert.deepEqual(r.summary.undetermined, {
    measured: 2, 'not-measured': 1, unreadable: 1, medianShare: 0.125, lanesWithAnyUndetermined: 1,
  });
  assert.equal(run({ specs: [row('a')], fleet }).summary.undetermined.medianShare, 0.25);
});

test('a control record that was not read reports read false and a missing source reports null', () => {
  const unread = run({ controls: { source: 'file', read: false, lanes: {} } });
  assert.deepEqual(unread.inputs.positiveControls, { source: 'file', read: false });
  const bare = run({ controls: { read: true, lanes: {} } });
  assert.deepEqual(bare.inputs.positiveControls, { source: null, read: true });
});

test('an empty manifest set is read and its lane and non-lane sums start at zero', () => {
  const r = run({ checks: {} });
  assert.equal(r.summary.checks.inLanes, 0);
  assert.equal(r.summary.checks.notLanes, 0);
  assert.equal(r.inputs.manifests, 'read');
});

test('fixture provenance sorts lanes into real, synthetic, unrecorded and no-fixture', () => {
  const r = run({ specs: ['a', 'b', 'c', 'd', 'e'].map((c) => row(c)) }, (fixtures) => {
    const lanes = {
      a: { source: 'real', check: 'check-a', accepted: '2025-01-02' },
      b: { source: 'synthetic', why: 'seeded by hand' },
      c: { source: 'guessed' },
    };
    writeFileSync(join(fixtures, 'PROVENANCE.json'), JSON.stringify({ lanes }));
    for (const c of ['a', 'b', 'c', 'd']) writeFileSync(join(fixtures, c, 'case.txt'), 'x');
    writeFileSync(join(fixtures, 'e', '.keep'), '');
  });
  assert.deepEqual(r.lanes.a.fixture, { source: 'real', check: 'check-a', accepted: '2025-01-02' });
  assert.deepEqual(r.lanes.b.fixture, { source: 'synthetic', reason: 'seeded by hand' });
  assert.deepEqual(r.lanes.c.fixture, { source: 'unrecorded', recorded: 'guessed', why: 'provenance names no recognised source' });
  assert.deepEqual(r.lanes.d.fixture, { source: 'unrecorded', why: 'fixture predates provenance records' });
  assert.deepEqual(r.lanes.e.fixture, { source: 'no-fixture' });
  assert.deepEqual(r.summary.fixtureSource, { 'no-fixture': 1, real: 1, synthetic: 1, unrecorded: 2 });
  assert.deepEqual(Object.keys(r.summary.fixtureSource), ['no-fixture', 'real', 'synthetic', 'unrecorded']);
  assert.equal(r.inputs.provenance, 'read');
  const bare = run({ specs: [row('a')] }, (fixtures) => writeFileSync(join(fixtures, 'a', 'case.txt'), 'x'));
  assert.deepEqual(bare.lanes.a.fixture, { source: 'unrecorded', why: 'PROVENANCE.json is absent' });
  assert.equal(bare.inputs.provenance, 'absent');
});

test('canary evidence is measured only when every record carries credits', () => {
  const byCategory = {
    a: [{ lane: 'l1', date: '2025-01-02', credits: 1 }, { lane: 'l2', date: '2025-01-03', credits: 1 }],
    b: [{ lane: 'l3', verdict: 'clean', credits: 1 }, { lane: 'l4', verdict: 'alarm' }],
  };
  const r = run({ canary: { read: true, byCategory } });
  const zero = { state: 'measured', n: 0, of: 2, rate: 0 };
  assert.deepEqual(r.lanes.a.canary, { state: 'measured', lanes: ['l1', 'l2'], date: '2025-01-03', falseClean: zero, falseAlarm: zero });
  assert.deepEqual(r.lanes.b.canary, {
    state: 'unscored',
    lanes: ['l3', 'l4'],
    date: null,
    verdicts: [{ lane: 'l3', verdict: 'clean' }, { lane: 'l4', verdict: 'alarm' }],
    why: 'a canary record exists without a both-directions verdict and both runs recorded',
  });
  assert.deepEqual(r.summary.canary, { measured: 1, unscored: 1 });
  assert.deepEqual(r.inputs.canary, { read: true, date: null });
  const unread = run({ canary: { read: false, date: '2025-02-02', byCategory } });
  assert.deepEqual(unread.lanes.a.canary, notMeasured('no scan-canary record'));
  assert.deepEqual(unread.summary.canary, { 'not-measured': 2 });
  assert.deepEqual(unread.inputs.canary, { read: false, date: '2025-02-02' });
});
