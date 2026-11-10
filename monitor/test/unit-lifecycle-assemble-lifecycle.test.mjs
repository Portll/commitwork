// Per-finding lifecycle enrichment plus rollup outputs (monitor/lifecycle.mjs assembleLifecycle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleLifecycle } from '../lifecycle.mjs';
import { inspect } from 'node:util';

const rec = (over = {}) => ({
  key: 'k1', repo: 'r', tool: 't', id: 'i', package: 'p', path: 'x', severity: 'crit', state: 'open', ...over,
});

const pinned = (over, days) => {
  let computed;
  return Object.defineProperty(rec(over), 'dwell', {
    enumerable: true,
    get: () => ({ ...computed, knowableExposureDays: days }),
    set: (value) => { computed = value; },
  });
};

const one = (record, ctx = {}) => assembleLifecycle([record], ctx).records[0];

test('the nowIso clock changes what the registry and dwell record', () => {
  const snapshot = (nowIso) => {
    const out = assembleLifecycle([rec({ bugInitialReport: '2020-01-01T00:00:00.000Z' })], { nowIso });
    return inspect([out.cwxState, out.records[0].dwell], { depth: null });
  };
  assert.equal(snapshot('2024-01-01T00:00:00.000Z') === snapshot('2031-06-15T00:00:00.000Z'), false);
});

test('null records pass through and the reach join stays at zero without an index', () => {
  const empty = assembleLifecycle(null, {});
  assert.equal(empty.records, null);
  assert.deepEqual(empty.reachJoin, { set: 0, refused: 0, skipped: 0 });
  assert.deepEqual(assembleLifecycle([rec()], {}).reachJoin, { set: 0, refused: 0, skipped: 0 });
});

test('an owner map scoped to another area is ignored while every other scope applies', () => {
  const ownerMap = { $scope: { area: 'a1' }, repos: { 'sqx-billing-api': { team: 'T', technology: 'Go' } } };
  const run = (ctx) => one(rec({ repo: 'sqx-billing-api' }), ctx);
  const other = run({ ownerMap, area: 'a2' });
  assert.equal(other.bugBelongsTo, null);
  assert.equal(other.repoTechnology, 'Billing Api');
  for (const ctx of [{ ownerMap, area: 'a1' }, { ownerMap }, { ownerMap: { repos: ownerMap.repos }, area: 'a2' }]) {
    const hit = run(ctx);
    assert.equal(hit.bugBelongsTo, 'T');
    assert.equal(hit.repoTechnology, 'Go');
  }
});

test('weakness class comes from the finding, then the advisory indexes, else stays empty', () => {
  const advisoryCwe = {
    byAdvisory: { 'CVE-2021-44228': ['CWE-502'] },
    byRepoPackage: { 'r|p': { cwes: ['CWE-400'], source: 'transitive' } },
  };
  const [own, preset, advisory, pkg, none] = assembleLifecycle([
    rec({ key: 'k1', cweIds: ['CWE-79'] }),
    rec({ key: 'k2', cweIds: ['CWE-89'], weaknessClassSource: 'scanner' }),
    rec({ key: 'k3', id: 'CVE-2021-44228', repo: 'q' }),
    rec({ key: 'k4' }),
    rec({ key: 'k5', tool: 'osv', id: 'left-pad', repo: 'q' }),
  ], { advisoryCwe }).records;
  assert.deepEqual(own.weaknessClass, ['CWE-79']);
  assert.equal(own.weaknessClassSource, 'advisory');
  assert.deepEqual(preset.weaknessClass, ['CWE-89']);
  assert.equal(preset.weaknessClassSource, 'scanner');
  assert.deepEqual(advisory.weaknessClass, ['CWE-502']);
  assert.equal(advisory.weaknessClassSource, 'advisory');
  assert.equal(advisory.primaryId, 'CVE-2021-44228');
  assert.equal(advisory.cwxRef, null);
  assert.deepEqual(pkg.weaknessClass, ['CWE-400']);
  assert.equal(pkg.weaknessClassSource, 'transitive');
  assert.deepEqual(none.weaknessClass, []);
  assert.equal(none.weaknessClassSource, null);
});

test('keyless findings mint per path and a missing path equals an empty one', () => {
  const bare = (path) => rec({ key: undefined, path });
  const [missing, empty, a, b] = assembleLifecycle([bare(undefined), bare(''), bare('a.js'), bare('b.js')], {}).records;
  assert.equal(missing.primaryId, empty.primaryId);
  assert.equal(a.primaryId === b.primaryId, false);
  assert.equal(a.primaryId === missing.primaryId, false);
  assert.equal(a.cwxRef, a.primaryId);
});

test('bugVisibleTo prefers the record, then the repo entry, then the map default', () => {
  const ownerMap = { $defaults: { visibleTo: 'partners' }, repos: { r: { visibleTo: 'team' }, s: {} } };
  assert.equal(one(rec({ bugVisibleTo: 'public' }), { ownerMap }).bugVisibleTo, 'public');
  assert.equal(one(rec({ repo: 's', bugVisibleTo: 'public' }), { ownerMap }).bugVisibleTo, 'public');
  assert.equal(one(rec(), { ownerMap }).bugVisibleTo, 'team');
  assert.equal(one(rec({ repo: 's' }), { ownerMap }).bugVisibleTo, 'partners');
  assert.equal(one(rec()).bugVisibleTo, 'internal');
});

test('a ledger entry seeds the anchors and blanks only an unset squash date', () => {
  const squashed = '2024-02-02T00:00:00.000Z';
  const at = '2024-03-03T00:00:00.000Z';
  const entry = { key: 'k1', resolvedSlice: 's1', fromVersion: '1.0.0', toVersion: '1.0.1', fixCommit: 'abc', at, evidence: 'e' };
  const ledgerEntries = [null, {}, entry];
  const kept = one(rec({ bugSquashedOn: squashed }), { ledgerEntries });
  assert.equal(kept.bugSquashedOn, squashed);
  assert.equal(kept.resolvedSlice, 's1');
  assert.equal(kept.fromVersion, '1.0.0');
  assert.equal(kept.toVersion, '1.0.1');
  assert.equal(kept.fixCommit, 'abc');
  assert.equal(kept.at, at);
  assert.equal(kept.evidence, 'e');
  assert.equal(one(rec(), { ledgerEntries }).bugSquashedOn, null);
  const unresolved = one(rec(), { ledgerEntries: [{ key: 'k1' }] });
  assert.equal(unresolved.bugSquashedOn, undefined);
  assert.equal(unresolved.resolvedSlice, null);
  assert.equal(one(rec({ key: 'k2' }), { ledgerEntries }).resolvedSlice, undefined);
});

test('the SLA breaches only strictly past the tier and never for a fixed finding', () => {
  const breached = (over, days) => one(pinned(over, days)).escalation.slaBreached;
  for (const [severity, tier] of [['crit', 7], ['high', 30], ['med', 90], ['low', 180]]) {
    assert.equal(breached({ severity }, tier - 1), false);
    assert.equal(breached({ severity }, tier), false);
    assert.equal(breached({ severity }, tier + 1), true);
  }
  assert.equal(breached({ state: 'resolved-fixed' }, 8), false);
  assert.equal(breached({}, '8'), false);
  assert.equal(breached({}, null), false);
});

test('an unscored finding takes the median tier and record escalation fields win', () => {
  const basis = (severity) => `unscored (${severity}) \u2014 median tier, not lenient`;
  const escalation = (over, days) => one(pinned(over, days)).escalation;
  assert.deepEqual(escalation({ severity: undefined }, 90), {
    slaTier: 90, slaTierBasis: basis('absent'), slaBreached: false, escalated: false,
  });
  assert.deepEqual(escalation({ severity: 'odd' }, 91), {
    slaTier: 90, slaTierBasis: basis('odd'), slaBreached: true, escalated: false,
  });
  assert.deepEqual(escalation({ escalation: { slaBreached: true, escalated: true, pager: 'ops' } }, 0), {
    slaTier: 7, slaTierBasis: 'severity', slaBreached: true, escalated: true, pager: 'ops',
  });
});

test('scan provenance fills the gap from tool runs and only a missed scan sets the floor', () => {
  const at = '2024-01-02T03:04:05Z';
  const toolRuns = { r: { artifacts: { osv: 'osv.json', t: null }, checks: [{ check: 'deps-osv', at }] } };
  const ran = one(rec({ tool: 'osv' }), { toolRuns });
  assert.deepEqual(ran.scanProvenance, { ran: true, scanner: 'osv', at });
  assert.equal(ran.lifecycleStatus, 'open');
  const missed = one(rec(), { toolRuns });
  assert.deepEqual(missed.scanProvenance, { ran: false, scanner: 't' });
  assert.equal(missed.lifecycleStatus, 'unknown-not-scanned');
  const given = { ran: true, scanner: 'manual' };
  const explicit = one(rec({ scanProvenance: given, lifecycleStatus: 'born' }), { toolRuns });
  assert.deepEqual(explicit.scanProvenance, { ran: true, scanner: 'manual' });
  assert.equal(explicit.lifecycleStatus, 'born');
  const unknown = one(rec());
  assert.equal(unknown.scanProvenance, undefined);
  assert.equal(unknown.lifecycleStatus, 'open');
});
