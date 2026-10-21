// The neutral report is the form every published document is a projection of, and its whole value
// is the block the target formats cannot hold. So the thing worth testing is not that it renders —
// it is that it never INVENTS. A superset that fabricates is worse than a standard that omits,
// because the fabrication arrives wearing the authority of the extra field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { buildReport, coverageOf, voidsOf, fixturesOf, vintageOf, vdbOf, SPEC_VERSION } from '../neutral-report.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRODUCT = { name: 'p', version: '1', repos: ['r1'] };
const EMPTY_ANN = { annotations: [] };
const build = (rollup) => buildReport(PRODUCT, null, rollup, [], EMPTY_ANN, '2026-08-26T00:00:00Z');

test('a rollup that carries nothing yields nulls and zeroes that SAY they are unrecorded', () => {
  const doc = build({ scanners: {}, repos: [] });
  assert.equal(doc.specVersion, SPEC_VERSION);
  assert.deepEqual(doc.looking.coverage, []);
  assert.deepEqual(doc.looking.voids, []);
  assert.equal(doc.looking.fixtures, null, 'no fixture data is null, not a zero that reads as measured');
  assert.equal(doc.looking.vdb, null);
  assert.equal(doc.looking.vintage.distinct, 0);
  assert.match(doc.looking.vintage.note, /UNRECORDED|unrecorded/,
    'an absent runner receipt must say so — "0 distinct" alone reads as agreement');
});

test('a lane with NO coverage key is omitted rather than reported full', () => {
  const cov = coverageOf({ scanners: { a: { total: 3 }, b: { total: 1, coverage: 'reduced', coverageBasis: 'signal', coverageReason: 'x did not run' } } });
  assert.deepEqual(cov.map((c) => c.lane), ['b'],
    'a lane predating the coverage field is not a lane with full coverage — that distinction is the whole point of the field');
  assert.equal(cov[0].basis, 'signal');
});

test('an unrecognised coverage value degrades to unknown, never to full', () => {
  const cov = coverageOf({ scanners: { a: { coverage: 'mostly' } } });
  assert.equal(cov[0].coverage, 'unknown', 'a word this schema does not know is a void, not a pass');
});

test('a void without a stated cause is not published as a void with an invented one', () => {
  const v = voidsOf({ scanners: { a: { noscan: 4 } }, repos: [] });
  assert.deepEqual(v, [], 'four voids and no reason recorded: the count is elsewhere, and a fabricated cause would be worse than silence here');
  const withReason = voidsOf({ scanners: { a: { noscan: 1, noscanReason: 'tool exited 128' } }, repos: [] });
  assert.deepEqual(withReason, [{ lane: 'a', repo: null, reason: 'tool exited 128' }]);
});

test('per-repo void reasons carry the repo, so a fleet-wide cause is distinguishable from one repo', () => {
  const v = voidsOf({ scanners: {}, repos: [{ name: 'r1', noscanReasons: [{ check: 'deps-osv', reason: 'no package sources' }] }] });
  assert.deepEqual(v, [{ lane: 'deps-osv', repo: 'r1', reason: 'no package sources' }]);
});

test('fixtures are summed across categories, and absent means null rather than zero', () => {
  assert.equal(fixturesOf({ scanners: { a: { detail: { rows: 5 } } } }), null,
    'a detail block with no fixture key predates the classification — not "zero fixtures"');
  const f = fixturesOf({ scanners: { a: { detail: { fixtureRows: 3, brokenOnPurposeRows: 1 } }, b: { detail: { fixtureRows: 2 } } } });
  assert.equal(f.rows, 5); assert.equal(f.brokenOnPurpose, 1);
});

test('the vdb build date is carried, and is never the document date', () => {
  const rollup = { scanners: { depsReachability: { vdb: { image: 'i', builtAt: '2026-08-23T02:25:12+00:00', pulledAt: '2026-08-25T11:21:25Z' } } } };
  const doc = build(rollup);
  assert.equal(doc.looking.vdb.builtAt, '2026-08-23T02:25:12+00:00');
  assert.notEqual(doc.looking.vdb.builtAt, doc.generated,
    'the document date and the evidence horizon are different facts; conflating them tells a reader the evidence is as fresh as the export');
});

test('mixed code vintage travels — one batch, several scanner builds', () => {
  const v = vintageOf({ vintage: { code: { distinct: 41, recorded: 100, unrecorded: 0, mixed: true, note: 'MIXED CODE VINTAGE' } } });
  assert.equal(v.distinct, 41); assert.equal(v.mixed, true);
  assert.match(v.note, /MIXED/);
});

test('the document it produces validates against its own published schema', () => {
  const rollup = {
    scanners: { a: { coverage: 'full', coverageBasis: 'none', noscan: 1, noscanReason: 'r', detail: { fixtureRows: 2, brokenOnPurposeRows: 0 } } },
    repos: [], vintage: { code: { distinct: 1, recorded: 1, unrecorded: 0, mixed: false, note: 'one runner' } },
  };
  const d = mkdtempSync(join(tmpdir(), 'cw-neutral-'));
  const f = join(d, 'report.json');
  writeFileSync(f, JSON.stringify(build(rollup), null, 2));
  // Through the real CLI, not a re-implementation: a document validated by a second validator is a
  // document validated against a second idea of the schema.
  execFileSync('node', [join(CW, 'bin', 'validate-artifact.mjs'), 'commitwork-report', f], { stdio: 'pipe' });
});

test('specVersion is PINNED by the schema — an unannounced shape change fails validation', () => {
  const schema = JSON.parse(readFileSync(join(CW, 'schema', 'commitwork-report.schema.json'), 'utf8'));
  assert.equal(schema.properties.specVersion.const, SPEC_VERSION,
    'the schema and the builder must agree on the version, or a consumer branching on it is branching on nothing');
  const d = mkdtempSync(join(tmpdir(), 'cw-neutral2-'));
  const f = join(d, 'bad.json');
  const doc = build({ scanners: {}, repos: [] });
  doc.specVersion = 'commitwork-report/2.0';
  writeFileSync(f, JSON.stringify(doc));
  assert.throws(() => execFileSync('node', [join(CW, 'bin', 'validate-artifact.mjs'), 'commitwork-report', f], { stdio: 'pipe' }),
    'a version the schema does not pin must be refused — that is how a breaking change is announced rather than discovered');
});
