// Per-lane witness, evidence credit, tallies and defects (monitor/lane-capability.mjs laneCapability).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneCapability } from '../lane-capability.mjs';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GOLDEN = fileURLToPath(new URL('./fixtures/lane-capability', import.meta.url));
const WHY = 'declared additive vulnerability, measured unable to count \u2014 a verdict\'s clothes with no voice';
const BLANK = { witness: 'no-fixture', fixture: null, creditedBy: [], capability: 'undetermined' };

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'laneCapability-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const paths = (dir) => {
  const p = { fixtures: join(dir, 'fx'), canaryDir: join(dir, 'cn'), testFixtures: join(dir, 'idx.json') };
  mkdirSync(p.fixtures);
  mkdirSync(p.canaryDir);
  return p;
};
const tallyBy = (rows, key) => rows.reduce((o, row) => ({ ...o, [row[key]]: (o[row[key]] || 0) + 1 }), {});

test('with no fixtures, canary or index every lane is undetermined and no defect is raised', () => withDir((dir) => {
  const r = laneCapability(paths(dir));
  const names = Object.keys(r.categories);
  assert.deepEqual(names, [...names].sort());
  assert.deepEqual(r.tally, { 'no-fixture': names.length });
  assert.deepEqual(r.countingBySource, {});
  assert.deepEqual(r.defects, []);
  assert.deepEqual(r.measured, {
    lanes: names.length,
    measured: 0,
    undetermined: names.length,
    byEvidence: { canary: 0, 'extractor-test': 0, golden: 0 },
    undeterminedLanes: names,
    unreadLanes: names.filter((c) => r.categories[c].unread),
  });
  assert.deepEqual(r.evidenceSources, {
    canary: { read: false, date: null, unmapped: [], uncredited: {} },
    extractorTests: { read: false, unknownCategories: [] },
  });
}));

test('a row carries its declared check, kind, additive flag, aliases and reader', () => withDir((dir) => {
  const c = laneCapability(paths(dir)).categories;
  const alias = (check) => `declared alias of ${check} (monitor/scanner-checks.mjs CHECK_ALIASES)`;
  assert.deepEqual(c.accessibility, { ...BLANK, check: 'a11y-wcag', kind: 'policy', additive: true });
  assert.deepEqual(c.actionsHealth, { ...BLANK, check: 'actions-health', kind: 'hygiene', additive: false });
  assert.deepEqual(c.apiFuzz.alsoFrom, { 'api-fuzz-schemathesis': alias('api-fuzz') });
  assert.deepEqual(c.bola.alsoFrom, { 'authz-bola': alias('dast-authz-bola'), 'bola-run': alias('dast-authz-bola') });
  assert.equal(c.authzIsolation.readBy, 'the runtime report (bin/parse-runtime.mjs)');
}));

test('a lane without a declared kind is unclassified and not additive', () => withDir((dir) => {
  const rows = Object.values(laneCapability(paths(dir)).categories);
  assert.deepEqual(rows.filter((row) => row.kind === undefined), []);
  assert.deepEqual(rows.filter((row) => row.kind === 'unclassified' && row.additive), []);
}));

test('a fixture directory reports its sorted visible files and its recorded or unrecorded source', () => withDir((dir) => {
  const p = paths(dir);
  const plan = [['accessibility', ['b.txt', 'a.txt', '.hidden']], ['actionsHealth', ['only.txt']], ['actionsLint', ['.hidden']]];
  for (const [name, files] of plan) {
    mkdirSync(join(p.fixtures, name));
    for (const f of files) writeFileSync(join(p.fixtures, name, f), 'x'.repeat(8));
  }
  writeFileSync(join(p.fixtures, 'PROVENANCE.json'), JSON.stringify({ lanes: { accessibility: { source: 'captured-run' } } }));
  const c = laneCapability(p).categories;
  assert.equal(c.accessibility.fixture, 'a.txt,b.txt');
  assert.equal(c.accessibility.source, 'captured-run');
  assert.equal(c.actionsHealth.fixture, 'only.txt');
  assert.equal(c.actionsHealth.source, 'unrecorded');
  assert.equal(c.actionsLint.fixture, null);
  assert.equal(c.actionsLint.witness, 'no-fixture');
  assert.equal(Object.hasOwn(c.actionsLint, 'source'), false);
}));

test('a fixture path that is a file is reported as unreadable with no source', () => withDir((dir) => {
  const p = paths(dir);
  writeFileSync(join(p.fixtures, 'accessibility'), 'x');
  assert.deepEqual(laneCapability(p).categories.accessibility, {
    ...BLANK, note: 'fixture dir unreadable: ENOTDIR', check: 'a11y-wcag', kind: 'policy', additive: true,
  });
}));

test('a canary credits a lane only for both directions with clean and dirty strings', () => withDir((dir) => {
  const p = paths(dir);
  const both = 'BOTH DIRECTIONS DEMONSTRATED';
  const lanes = {
    'ci-hygiene': { verdict: both, clean: 'c', dirty: 'd', date: '2026-03-04' },
    'agent-config': { verdict: 'one way', clean: 'c', dirty: 'd' },
    'agent-instructions': { verdict: both, clean: 'c' },
    'commit-provenance': {},
    mystery: { verdict: both, clean: 'c', dirty: 'd' },
  };
  writeFileSync(join(p.canaryDir, 'EXPECTED.json'), JSON.stringify({ measured: { date: '2026-01-02', lanes } }));
  const r = laneCapability(p);
  const c = r.categories;
  assert.deepEqual(c.actionsPosture.canary, [{ lane: 'ci-hygiene', date: '2026-03-04', verdict: both, credits: true }]);
  assert.deepEqual(c.actionsPosture.creditedBy, ['canary']);
  assert.equal(c.actionsPosture.capability, 'measured');
  assert.deepEqual(c.agentConfig.canary, [{ lane: 'agent-config', date: '2026-01-02', verdict: 'one way', credits: false }]);
  assert.deepEqual(c.agentInstructions.canary, [{ lane: 'agent-instructions', date: '2026-01-02', verdict: both, credits: false }]);
  assert.deepEqual(c.commitProvenance.canary, [{ lane: 'commit-provenance', date: '2026-01-02', verdict: null, credits: false }]);
  assert.deepEqual(c.agentConfig.creditedBy, []);
  assert.equal(c.agentConfig.capability, 'undetermined');
  assert.deepEqual(r.measured.byEvidence, { canary: 1, 'extractor-test': 0, golden: 0 });
  assert.equal(r.measured.measured, 1);
  assert.deepEqual(r.measured.undeterminedLanes, Object.keys(c).filter((n) => n !== 'actionsPosture'));
  assert.deepEqual(r.evidenceSources.canary, { read: true, date: '2026-01-02', unmapped: ['mystery'], uncredited: {} });
}));

test('an extractor index lists unknown categories once and a missing declared file earns no credit', () => withDir((dir) => {
  const p = paths(dir);
  const fixtures = [{ category: 'zzz', file: 'a' }, { category: 'aaa', file: 'b' }, { category: 'zzz', file: 'c' },
    { category: 'accessibility', file: 'gone.json', test: 't1' }];
  writeFileSync(p.testFixtures, JSON.stringify({ fixtures }));
  const r = laneCapability(p);
  assert.deepEqual(r.evidenceSources.extractorTests, { read: true, unknownCategories: ['aaa', 'zzz'] });
  assert.deepEqual(r.categories.accessibility.extractorTests, [
    { test: 't1', fixture: 'gone.json', witness: 'no-fixture', note: 'declared fixture file is missing', credits: false },
  ]);
  assert.deepEqual(r.categories.accessibility.creditedBy, []);
  assert.equal(r.categories.accessibility.capability, 'undetermined');
}));

test('an empty provenance, canary or index file is rethrown as a parse error', () => withDir((dir) => {
  const p = paths(dir);
  for (const file of [join(p.fixtures, 'PROVENANCE.json'), join(p.canaryDir, 'EXPECTED.json'), p.testFixtures]) {
    writeFileSync(file, '');
    assert.throws(() => laneCapability(p), { name: 'SyntaxError', message: 'Unexpected end of JSON input' });
    rmSync(file);
  }
}));

test('golden fixtures count each counting lane once per source and credit it as golden', { skip: !existsSync(GOLDEN) }, () => withDir((dir) => {
  const p = paths(dir);
  cpSync(GOLDEN, p.fixtures, { recursive: true });
  const r = laneCapability(p);
  const rows = Object.values(r.categories);
  const counting = rows.filter((row) => row.witness === 'counting');
  assert.deepEqual(r.tally, tallyBy(rows, 'witness'));
  assert.deepEqual(Object.keys(r.tally), Object.keys(r.tally).sort());
  assert.deepEqual(r.countingBySource, tallyBy(counting, 'source'));
  assert.deepEqual(counting.map((row) => row.creditedBy), counting.map(() => ['golden']));
  assert.deepEqual(r.measured.byEvidence, { canary: 0, 'extractor-test': 0, golden: counting.length });
  assert.equal(r.measured.measured, counting.length);
}));

test('an additive vulnerability lane measured unable to count is raised as a defect', { skip: !existsSync(GOLDEN) }, () => withDir((dir) => {
  const p = paths(dir);
  cpSync(GOLDEN, p.fixtures, { recursive: true });
  for (const e of readdirSync(p.fixtures, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && e.name !== 'PROVENANCE.json') writeFileSync(join(e.parentPath, e.name), '{');
  }
  const r = laneCapability(p);
  const expected = Object.entries(r.categories)
    .filter(([, row]) => row.additive && row.kind === 'vulnerability' && ['shape-only', 'zero-on-golden'].includes(row.witness))
    .map(([category, row]) => ({ category, witness: row.witness, why: WHY }));
  assert.deepEqual([...r.defects].sort((a, b) => (a.category < b.category ? -1 : 1)), expected);
}));
