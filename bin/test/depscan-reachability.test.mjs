// dep-scan's reachability claim is the strongest thing this fleet can say about a dependency, so
// it is the one most worth getting wrong. Both ways of getting it wrong were committed here first
// and are pinned below.
//
//   in_triage read as REACHABLE   dep-scan's DEFAULT analysis state is `in_triage` — "not
//                                 adjudicated". Matching it reported 100 of 105 findings on
//                                 vercel/satori as reachable when the true proof count was ZERO.
//   no-slices read as 0 REACHABLE the slicer writes nothing on a tree with no installed
//                                 dependencies. universal-usages.slices.json came back
//                                 {"objectSlices":[],"userDefinedTypes":[]}. "Nothing is
//                                 reachable" is the strongest false-clean this tool can emit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseReport, severityMark } from '../commitwork.mjs';
import { isSeverity } from '../../monitor/check-vocabulary.mjs';
import { _depscanCounts } from '../../monitor/extractors.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-depscan-'));
const vuln = (id, sev, state) => ({
  id, ratings: [{ severity: sev }], affects: [{ ref: `pkg:npm/${id.toLowerCase()}@1.0.0` }],
  analysis: state ? { state } : undefined,
  properties: [{ name: 'depscan:insights', value: 'Indirect dependency' }],
});
const plant = (summary, vdr) => {
  const dir = mkdtempSync(join(T, 'run-'));
  writeFileSync(join(dir, 'depscan.json'), JSON.stringify(summary));
  if (vdr) writeFileSync(join(dir, 'depscan-universal.vdr.json'), JSON.stringify(vdr));
  return dir;
};
const summary = (over = {}) => ({
  tool: 'depscan', ran: true, coverage: 'reduced', sandbox: 'container, network severed',
  detail: ['depscan-universal.vdr.json'],
  counts: { crit: 0, high: 2, med: 0, low: 0, total: 2, components: 40 },
  reachability: { state: 'analysed', exploitable: 1, notAdjudicated: 1 },
  ...over,
});

test('in_triage is UNADJUDICATED, never reachable — it is dep-scan\'s default, not a proof', () => {
  const dir = plant(summary(), { vulnerabilities: [
    vuln('CVE-2026-1', 'high', 'in_triage'),
    vuln('CVE-2026-2', 'high', 'exploitable'),
  ] });
  const c = _depscanCounts(dir, 'depscan.json');
  const byId = Object.fromEntries((c.findings || []).map((f) => [f.id, f.reachability]));
  assert.equal(byId['CVE-2026-1'], 'unadjudicated', 'in_triage must NOT be promoted to a proof');
  assert.equal(byId['CVE-2026-2'], 'exploitable');
  assert.ok(!Object.values(byId).includes('unreachable'),
    'this tool never asserts unreachable — it has no such finding');
});

test('a run whose slicer produced NOTHING carries no reachability counts at all', () => {
  const dir = plant(summary({ reachability: { state: 'not-produced', sliceObjects: 0,
    reason: 'the slicer wrote no object slices' } }),
  { vulnerabilities: [vuln('CVE-2026-3', 'high', 'in_triage')] });
  const c = _depscanCounts(dir, 'depscan.json');
  assert.equal(c.reachabilityState, 'not-produced');
  assert.equal(c.reachable, undefined, '"0 reachable" would be a claim; there is no claim to make');
  assert.equal(c.notAdjudicated, undefined);
  assert.ok(c.reachabilityReason, 'and the reader must be told why there is no answer');
  assert.equal(c.total, 2, 'the dependency findings themselves are still real and still counted');
});

test('no findings AND no slices establishes nothing — noscan, never ok', () => {
  const dir = plant(summary({
    counts: { crit: 0, high: 0, med: 0, low: 0, total: 0, components: 40 },
    reachability: { state: 'not-produced', reason: 'no slices' },
  }));
  const r = parseReport('depscan', join(dir, 'depscan.json'));
  assert.equal(r.sev, 'noscan');
  assert.match(r.summary, /no dependency claim was established/);
});

test('the verdict states whether reachability was produced — a reader cannot tell otherwise', () => {
  const produced = parseReport('depscan', join(plant(summary()), 'depscan.json'));
  assert.match(produced.summary, /1 adjudicated exploitable/);
  const not = parseReport('depscan', join(plant(summary({
    reachability: { state: 'not-produced', reason: 'no slices' } })), 'depscan.json'));
  assert.match(not.summary, /reachability NOT produced/);
});

test('a self-gated skip is a void, not a tree with no dependencies', () => {
  const dir = plant({ tool: 'depscan', ran: false, skipped: true, reason: 'docker not installed' });
  assert.equal(parseReport('depscan', join(dir, 'depscan.json')).sev, 'noscan');
  const c = _depscanCounts(dir, 'depscan.json');
  assert.equal(c.nosrc, true);
  assert.equal(c.total, 0);
});

test('the isolation the scan ran under travels with the result', () => {
  const c = _depscanCounts(plant(summary()), 'depscan.json');
  assert.equal(c.coverage, 'reduced');
  assert.match(String(c.sandbox), /network severed/,
    'a severed-network run cannot resolve transitives; a reader who does not know that reads a short list as a clean one');
});

test('the SBOMs beside the VDR are inventory, not findings — they must not become rows', () => {
  const dir = plant(summary({ detail: ['depscan-universal.vdr.json', 'sbom-build-universal.cdx.json'] }),
    { vulnerabilities: [vuln('CVE-2026-4', 'high', 'exploitable')] });
  const c = _depscanCounts(dir, 'depscan.json');
  assert.equal((c.findings || []).length, 1, 'only the .vdr.json is read for findings');
});

test('the database build date is the temporal bound of the result, and it travels — or its absence does', () => {
  const vdb = { image: 'ghcr.io/appthreat/vdbxz-app-2y:v6.7.x', builtAt: '2026-08-23T02:25:12+00:00', pulledAt: '2026-08-23T11:21:25Z',
    maxAgeDays: 7, stale: false, note: null, bound: 'advisories published after 2026-08-23T02:25:12+00:00 are not represented in this result' };
  const c = _depscanCounts(plant(summary({ vdb })), 'depscan.json');
  assert.equal(c.vdb.builtAt, '2026-08-23T02:25:12+00:00');
  assert.equal(c.vdb.pulledAt, '2026-08-23T11:21:25Z', 'pulledAt (the re-warm policy) and builtAt (the bound) are carried apart, never conflated');
  assert.match(c.vdb.bound, /advisories published after/);
  const old = _depscanCounts(plant(summary()), 'depscan.json');
  assert.equal(old.vdb.builtAt, null);
  assert.match(old.vdb.bound, /unrecorded/, 'a receipt predating the field says the bound is unknown — it does not say fresh');
});

test('medium/low-only findings are med on the canon — never an off-canon word the index paints clean', () => {
  const dir = plant(summary({
    counts: { crit: 0, high: 0, med: 4, low: 3, total: 7, components: 26 },
    reachability: { state: 'not-produced', reason: 'no slices' },
  }));
  const r = parseReport('depscan', join(dir, 'depscan.json'));
  assert.equal(r.sev, 'med');
  assert.ok(isSeverity(r.sev));
  assert.equal(severityMark(r.sev), '🟡');
});

test('the index marks a severity outside the canon as unknown, never clean', () => {
  assert.equal(severityMark('ok'), '🟢');
  for (const sev of ['warn', 'low', undefined, '']) assert.notEqual(severityMark(sev), '🟢', String(sev));
});
