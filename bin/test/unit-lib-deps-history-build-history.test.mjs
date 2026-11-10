// Per-project dependency release lifecycles, audit series and fleet headline built from audit and proposal events (bin/lib/deps-history.mjs buildHistory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory } from '../lib/deps-history.mjs';

const day = (d) => `${d}T00:00:00.000Z`;
const noTypes = { patch: null, minor: null, major: null };
const noBacklog = { releases: 0, applied: 0, open: 0 };

test('no events give an empty report with the default 7 and 30 day patch windows', () => {
  assert.deepEqual(buildHistory([], { nowMs: 0 }), {
    generatedAt: '1970-01-01T00:00:00.000Z', projects: [], fleetSeries: [], within: [7, 30],
    headline: { releases: 0, applied: 0, open: 0, held: 0, medianFindDays: null, medianApplyDays: null, medianApplyDaysByType: noTypes,
      patchWithin: { 7: { applied: 0, of: 0 }, 30: { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 0, byObserved: 0, backlog: noBacklog },
  });
});

test('a single audit records found releases, counts held deps, skips skipped deps and treats a release published at the audit as new', () => {
  const t0 = day('2024-01-10');
  const r = buildHistory([{ repo: '/w/app', event: 'audit', at: t0, commit: 'c1', deps: [
    { name: 'a', kind: 'dependencies', updates: [{ version: '1.0.1', type: 'patch', publishedAt: t0 }] },
    { name: 'b', kind: 'devDependencies', held: [{ version: '2.0.0', type: 'major', publishedAt: day('2024-01-09') }] },
    { name: 'c', kind: 'dependencies', skipped: true, locked: '1.0.0', updates: [{ version: '9.0.0', type: 'major', publishedAt: t0 }] },
  ] }], { nowMs: Date.parse(day('2024-01-12')) });
  const base = { proposedAt: null, appliedAt: null, appliedBy: null, proposal: null, applyLagDays: null };
  const lifecycle = [
    { ...base, name: 'a', version: '1.0.1', kind: 'dependencies', type: 'patch', publishedAt: t0, foundAt: t0, eligibleAt: t0, preexisting: false, foundLagDays: 0, openDays: 2 },
    { ...base, name: 'b', version: '2.0.0', kind: 'devDependencies', type: 'major', publishedAt: day('2024-01-09'), foundAt: t0, eligibleAt: null, preexisting: true, foundLagDays: null, openDays: 3 },
  ];
  const headline = { releases: 1, applied: 0, open: 1, held: 0, medianFindDays: 0, medianApplyDays: null, medianApplyDaysByType: noTypes,
    patchWithin: { 7: { applied: 0, of: 0 }, 30: { applied: 0, of: 0 } }, oldestOpen: { name: 'a', version: '1.0.1', type: 'patch', days: 2 },
    byMerge: 0, byObserved: 0, backlog: { releases: 1, applied: 0, open: 0 } };
  assert.deepEqual(r, { generatedAt: day('2024-01-12'), within: [7, 30], headline, fleetSeries: [{ at: t0, patch: 1, minor: 0, major: 0, projects: 1 }],
    projects: [{ repo: '/w/app', pkgPath: '.', label: 'app', audits: 1, firstAudit: t0, lastAudit: t0, proposals: 0, merges: 0, refused: 0, superseded: 0,
      series: [{ at: t0, commit: 'c1', held: 1, patch: 1, minor: 0, major: 0 }], lifecycle, headline }] });
});

test('a merged proposal applies releases up to its target version and leaves newer ones open', () => {
  const svc = (event, at, more) => ({ repo: 'svc', pkgPath: 'packages/api', event, at: day(at), ...more });
  const r = buildHistory([
    svc('merged', '2024-02-03', { proposal: 'p1' }),
    svc('audit', '2024-01-29', { deps: [] }),
    svc('proposed', '2024-02-02', { proposal: 'p1', changes: [{ name: 'a', path: 'node_modules/a', to: '1.0.1' }, { name: 'x', path: 'node_modules/y/node_modules/x', to: '9.0.0' }] }),
    svc('audit', '2024-02-01', { commit: 'c2', deps: [{ name: 'a', kind: 'dependencies', updates: [
      { version: '1.0.1', type: 'patch', publishedAt: day('2024-01-30') }, { version: '1.0.2', type: 'patch', publishedAt: day('2024-01-31') }] }] }),
  ], { nowMs: Date.parse(day('2024-02-10')) });
  const found = { kind: 'dependencies', type: 'patch', foundAt: day('2024-02-01'), eligibleAt: day('2024-02-01'), preexisting: false };
  const headline = { releases: 2, applied: 1, open: 1, held: 0, medianFindDays: 1.5, medianApplyDays: 4, medianApplyDaysByType: { ...noTypes, patch: 4 },
    patchWithin: { 7: { applied: 1, of: 2 }, 30: { applied: 0, of: 0 } }, oldestOpen: { name: 'a', version: '1.0.2', type: 'patch', days: 10 },
    byMerge: 1, byObserved: 0, backlog: noBacklog };
  assert.deepEqual(r, { generatedAt: day('2024-02-10'), within: [7, 30], headline,
    fleetSeries: [{ at: day('2024-01-29'), patch: 0, minor: 0, major: 0, projects: 1 }, { at: day('2024-02-01'), patch: 1, minor: 0, major: 0, projects: 1 }],
    projects: [{ repo: 'svc', pkgPath: 'packages/api', label: 'svc/packages/api', audits: 2, firstAudit: day('2024-01-29'), lastAudit: day('2024-02-01'),
      proposals: 1, merges: 1, refused: 0, superseded: 0, headline,
      series: [{ at: day('2024-01-29'), commit: null, held: 0, patch: 0, minor: 0, major: 0 }, { at: day('2024-02-01'), commit: 'c2', held: 0, patch: 1, minor: 0, major: 0 }],
      lifecycle: [
        { ...found, name: 'a', version: '1.0.2', publishedAt: day('2024-01-31'), proposedAt: null, appliedAt: null, appliedBy: null, proposal: null, foundLagDays: 1, applyLagDays: null, openDays: 10 },
        { ...found, name: 'a', version: '1.0.1', publishedAt: day('2024-01-30'), proposedAt: day('2024-02-02'), appliedAt: day('2024-02-03'), appliedBy: 'merge', proposal: 'p1', foundLagDays: 2, applyLagDays: 4, openDays: null },
      ] }] });
});

test('a lock at or above a release applies it as observed unless the lock passed it before it was found', () => {
  const r = buildHistory([
    { repo: 'lib', event: 'audit', at: day('2024-03-10'), deps: [
      { name: 'b', kind: 'dependencies', locked: '2.0.0', updates: [{ version: '2.1.0', type: 'minor', publishedAt: day('2024-03-08') }] },
      { name: 'c', kind: 'dependencies', locked: '3.1.0' }] },
    { repo: 'lib', event: 'audit', at: day('2024-03-14'), deps: [
      { name: 'b', kind: 'dependencies', locked: '2.1.0' },
      { name: 'c', kind: 'dependencies', locked: '3.1.0', held: [{ version: '3.0.5', type: 'patch', publishedAt: day('2024-03-12') }] }] },
  ], { nowMs: Date.parse(day('2024-03-19')) });
  const p = r.projects[0];
  assert.deepEqual(p.lifecycle, [
    { name: 'c', version: '3.0.5', kind: 'dependencies', type: 'patch', publishedAt: day('2024-03-12'), foundAt: day('2024-03-14'), eligibleAt: null, proposedAt: null,
      appliedAt: null, appliedBy: null, proposal: null, preexisting: false, foundLagDays: 2, applyLagDays: null, openDays: 7 },
    { name: 'b', version: '2.1.0', kind: 'dependencies', type: 'minor', publishedAt: day('2024-03-08'), foundAt: day('2024-03-10'), eligibleAt: day('2024-03-10'), proposedAt: null,
      appliedAt: day('2024-03-14'), appliedBy: 'observed', proposal: null, preexisting: true, foundLagDays: null, applyLagDays: 6, openDays: null },
  ]);
  assert.deepEqual(p.series, [
    { at: day('2024-03-10'), commit: null, held: 0, patch: 0, minor: 1, major: 0 },
    { at: day('2024-03-14'), commit: null, held: 1, patch: 0, minor: 0, major: 0 },
  ]);
  assert.deepEqual(r.headline, { releases: 1, applied: 0, open: 0, held: 1, medianFindDays: 2, medianApplyDays: null, medianApplyDaysByType: noTypes,
    patchWithin: { 7: { applied: 0, of: 1 }, 30: { applied: 0, of: 0 } }, oldestOpen: null, byMerge: 0, byObserved: 0, backlog: { releases: 1, applied: 1, open: 0 } });
});

test('an earlier lock observation overrides a later merge, proposals keep the earliest time and unknown merges are ignored', () => {
  const ev = (event, at, more) => ({ repo: 'r', event, at: day(at), ...more });
  const to = { changes: [{ name: 'q', path: 'node_modules/q', to: '1.0.1' }] };
  const r = buildHistory([
    ev('audit', '2024-06-01', { deps: [{ name: 'q', kind: 'dependencies', locked: '1.0.0', updates: [{ version: '1.0.1', type: 'patch', publishedAt: day('2024-06-01') }] }] }),
    ev('proposed', '2024-06-03', { proposal: 'p2', ...to }),
    ev('proposed', '2024-06-02', { proposal: 'p1', ...to }),
    ev('audit', '2024-06-04', { deps: [{ name: 'q', kind: 'dependencies', locked: '1.0.1' }] }),
    ev('merged', '2024-06-05', { proposal: 'p2' }),
    ev('merged', '2024-06-06', { proposal: 'nope' }),
  ], { nowMs: Date.parse(day('2024-06-08')), within: [3, 2] });
  const p = r.projects[0];
  assert.deepEqual([p.proposals, p.merges, r.within], [2, 2, [3, 2]]);
  assert.deepEqual(p.lifecycle, [{ name: 'q', version: '1.0.1', kind: 'dependencies', type: 'patch', publishedAt: day('2024-06-01'), foundAt: day('2024-06-01'),
    eligibleAt: day('2024-06-01'), proposedAt: day('2024-06-02'), appliedAt: day('2024-06-04'), appliedBy: 'observed', proposal: null, preexisting: false,
    foundLagDays: 0, applyLagDays: 3, openDays: null }]);
  assert.deepEqual(r.headline, { releases: 1, applied: 1, open: 0, held: 0, medianFindDays: 0, medianApplyDays: 3, medianApplyDaysByType: { ...noTypes, patch: 3 },
    patchWithin: { 3: { applied: 1, of: 1 }, 2: { applied: 0, of: 1 } }, oldestOpen: null, byMerge: 0, byObserved: 1, backlog: noBacklog });
});

test('releases are keyed by name and version joined with a NUL so a colliding pair shares the first record', () => {
  const r = buildHistory([{ repo: 'k', event: 'audit', at: day('2024-05-10'), deps: [
    { name: 'x', kind: 'dependencies', updates: [{ version: 'y\0z', type: 'patch', publishedAt: day('2024-05-01') }] },
    { name: 'x\0y', kind: 'devDependencies', updates: [{ version: 'z', type: 'major', publishedAt: day('2024-05-02') }] }] }], { nowMs: Date.parse(day('2024-05-10')) });
  assert.deepEqual(r.projects[0].lifecycle.map((l) => [l.name, l.version, l.kind, l.type, l.publishedAt]), [['x', 'y\0z', 'dependencies', 'patch', day('2024-05-01')]]);
});

test('projects are counted per repo, sorted by label, and the fleet series carries each latest audit forward', () => {
  const z = 'C:\\work\\zeta';
  const at = (d) => day(`2024-04-0${d}`);
  const r = buildHistory([
    { repo: z, pkgPath: '.', event: 'refused', at: at(4) },
    { repo: z, event: 'superseded', at: at(5) },
    { repo: z, event: 'superseded', at: at(6) },
    { repo: z, event: 'noise', at: at(7) },
    { repo: z, event: 'audit', at: at(2), deps: [{ name: 'n', kind: 'dependencies', updates: [
      { version: '2.0.0', type: 'major', publishedAt: at(1) }, { version: '1.0.1', type: 'patch', publishedAt: day('2024-03-30') }] }] },
    { repo: 'beta/', event: 'refused', at: at(8) },
    { repo: 'alpha', event: 'audit', at: at(3), deps: [] },
    { repo: 'alpha', event: 'audit', at: at(1), deps: [{ name: 'm', kind: 'dependencies', updates: [{ version: '1.1.0', type: 'minor', publishedAt: day('2024-03-31') }] }] },
  ], { nowMs: Date.parse(at(9)) });
  assert.deepEqual(r.projects.map((p) => [p.label, p.audits, p.firstAudit, p.lastAudit, p.proposals, p.merges, p.refused, p.superseded]), [
    ['alpha', 2, at(1), at(3), 0, 0, 0, 0],
    ['beta', 0, null, null, 0, 0, 1, 0],
    ['zeta', 1, at(2), at(2), 0, 0, 1, 2],
  ]);
  assert.deepEqual(r.fleetSeries, [
    { at: at(1), patch: 0, minor: 1, major: 0, projects: 1 },
    { at: at(2), patch: 1, minor: 1, major: 1, projects: 2 },
    { at: at(3), patch: 1, minor: 0, major: 1, projects: 2 },
  ]);
});
