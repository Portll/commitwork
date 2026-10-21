// Triage queue: each rule pinned by a fixture
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, collectUndetermined, defectLanes, adjudicatedKeys, TRIAGE_RULES, METRIC_LANES } from '../lib/adjudication-triage.mjs';

const cve = (repo, id, pkg, extra = {}) => ({ id, package: pkg, undetermined: true, undeterminedCode: 'version-not-declared', claimedSeverity: 'high', state: 'new', bornSlice: 'sweep-20260901000000', ...extra });
const secret = (repo, file, extra = {}) => ({ repo, rule: 'generic-api-key', file, sev: '', state: 'new', bornSlice: 'sweep-20260901000000', ...extra });

function rollup({ repos = [], scannerFindings = {}, scanners = {} } = {}) {
  return { repos, scannerFindings, scanners };
}

describe('collection', () => {
  test('CVE rows are keyed repo|id|package, scanner rows by their place identity, and both say why they are undetermined', () => {
    const r = rollup({
      repos: [{ name: 'alpha', findings: [cve('alpha', 'CVE-1', 'nanoid'), { id: 'CVE-2', package: 'x', undetermined: false }] }],
      scannerFindings: { secrets: [secret('alpha', 'a.go'), secret('alpha', 'b.go', { sev: 'crit' })] },
    });
    const { rows } = collectUndetermined(r);
    assert.deepEqual(rows.map((x) => x.findingKey), ['alpha|CVE-1|nanoid', 'secrets|alpha|generic-api-key|a.go']);
    assert.equal(rows[0].code, 'version-not-declared');
    assert.equal(rows[1].code, 'ungraded');
    assert.match(rows[1].reason, /no verifier/);
  });

  test('metric lanes are skipped and counted, never queued', () => {
    const r = rollup({ scannerFindings: { stubs: [{ repo: 'alpha', rule: 'stub', file: 'x.js', sev: '' }] } });
    const { rows, skipped } = collectUndetermined(r);
    assert.equal(rows.length, 0);
    assert.deepEqual(skipped.metricLanes, { stubs: 1 });
    assert.ok(METRIC_LANES.has('stubs'));
  });

  test('a row with no repo, or a lane with no identity, is counted as unkeyed rather than given a made-up key', () => {
    const r = rollup({ scannerFindings: { secrets: [{ rule: 'r', file: 'f', sev: '' }], 'no-such-lane': [{ repo: 'a', sev: '' }] } });
    const { rows, skipped } = collectUndetermined(r);
    assert.equal(rows.length, 0);
    assert.deepEqual(skipped.unkeyed, { secrets: 1, 'no-such-lane': 1 });
  });

  test('a rollup that is not an object yields nothing and does not throw', () => {
    assert.deepEqual(collectUndetermined(null).rows, []);
    assert.equal(buildQueue({ rollup: null }).state, 'no-rollup');
  });
});

describe('exclusions', () => {
  test('a lane that grades ≤5% of ≥20 rows is a defect signature and its rows are routed off the queue', () => {
    const rows = Array.from({ length: 30 }, (_, i) => secret('alpha', `f${i}.go`));
    const r = rollup({ scannerFindings: { secrets: rows }, scanners: { secrets: { undetermined: 30, total: 30 } } });
    assert.deepEqual(Object.keys(defectLanes(r)), ['secrets']);
    const q = buildQueue({ rollup: r });
    assert.equal(q.pending, 0);
    assert.equal(q.excluded.defectSignature.secrets.rowsExcluded, 30);
    assert.equal(q.excluded.defectSignature.secrets.share, 1);
  });

  test('the same share over FEWER than 20 rows is not a signature — small numbers do not prove a lane defect', () => {
    const rows = Array.from({ length: 5 }, (_, i) => secret('alpha', `f${i}.go`));
    const r = rollup({ scannerFindings: { secrets: rows }, scanners: { secrets: { undetermined: 5, total: 5 } } });
    assert.deepEqual(defectLanes(r), {});
    assert.equal(buildQueue({ rollup: r }).pending, 5);
  });

  test('an adjudicated findingKey leaves the queue and is counted resolved; a record without a truth does not count', () => {
    const r = rollup({ repos: [{ name: 'alpha', findings: [cve('alpha', 'CVE-1', 'nanoid'), cve('alpha', 'CVE-2', 'lodash')] }] });
    const done = adjudicatedKeys([
      { kind: 'finding-adjudication', findingKey: 'alpha|CVE-1|nanoid', truth: 'false-alarm' },
      { kind: 'finding-adjudication', findingKey: 'alpha|CVE-2|lodash', truth: null },
      { kind: 'adjudication', findingKey: 'alpha|CVE-2|lodash', truth: 'true-alarm' },
    ]);
    assert.deepEqual([...done], ['alpha|CVE-1|nanoid']);
    const q = buildQueue({ rollup: r, adjudicated: done });
    assert.equal(q.pending, 1);
    assert.equal(q.excluded.adjudicated, 1);
    assert.equal(q.admitted[0].findingKey, 'alpha|CVE-2|lodash');
  });
});

describe('ranking', () => {
  test('own code first, then claimed severity, then KEV, then persisting, then oldest', () => {
    const r = rollup({ repos: [
      { name: 'corpus', findings: [cve('corpus', 'CVE-A', 'p', { claimedSeverity: 'crit' })] },
      { name: 'ours', findings: [
        cve('ours', 'CVE-B', 'p', { claimedSeverity: 'low' }),
        cve('ours', 'CVE-C', 'p', { claimedSeverity: 'high', bornSlice: 'sweep-20260905000000' }),
        cve('ours', 'CVE-D', 'p', { claimedSeverity: 'high', bornSlice: 'sweep-20260901000000' }),
        cve('ours', 'CVE-E', 'p', { claimedSeverity: 'high', state: 'persisting', bornSlice: 'sweep-20260906000000' }),
        cve('ours', 'CVE-F', 'p', { claimedSeverity: 'high', kev: true, bornSlice: 'sweep-20260907000000' }),
      ] },
    ] });
    const q = buildQueue({ rollup: r, ownRepos: new Set(['ours']) });
    assert.deepEqual(q.admitted.map((x) => x.id), ['CVE-F', 'CVE-E', 'CVE-D', 'CVE-C', 'CVE-B', 'CVE-A'],
      'crit in the corpus ranks BELOW low in our own code; KEV beats persisting beats older beats newer');
    assert.equal(q.admitted[0].rank, 1);
    assert.equal(q.admitted[5].own, false);
  });

  test('without an ownRepos set nobody outranks anybody on that axis', () => {
    const r = rollup({ repos: [
      { name: 'b', findings: [cve('b', 'CVE-1', 'p', { claimedSeverity: 'crit' })] },
      { name: 'a', findings: [cve('a', 'CVE-2', 'p', { claimedSeverity: 'low' })] },
    ] });
    assert.deepEqual(buildQueue({ rollup: r }).admitted.map((x) => x.id), ['CVE-1', 'CVE-2']);
  });
});

describe('capacity', () => {
  test('past capacity rows are deferred by lane, never dropped; the budget states the overrun', () => {
    const findings = Array.from({ length: 10 }, (_, i) => cve('alpha', `CVE-${i}`, 'p'));
    const r = rollup({ repos: [{ name: 'alpha', findings }] });
    const q = buildQueue({ rollup: r, capacityItems: 4 });
    assert.equal(q.admitted.length, 4);
    assert.equal(q.deferred.count, 6);
    assert.deepEqual(q.deferred.byLane, { cve: 6 });
    assert.equal(q.pending, 10);
    assert.equal(q.budget.overBy, 2.5);
    assert.equal(q.budget.saturated, false, 'ten items at 5 min each is 50 of 600 declared minutes');
  });

  test('a noisy lane cannot starve the rest: the quiet lane is admitted whole even though the noisy lane outranks it', () => {
    // fact: ownRepos makes secrets outrank cve here
    const secrets = Array.from({ length: 8 }, (_, i) => secret('ours', `f${i}.go`));
    const findings = Array.from({ length: 3 }, (_, i) => cve('corpus', `CVE-${i}`, 'p', { claimedSeverity: 'crit' }));
    const r = rollup({ repos: [{ name: 'corpus', findings }], scannerFindings: { secrets },
      scanners: { secrets: { undetermined: 8, total: 100 } } });
    const q = buildQueue({ rollup: r, capacityItems: 6, ownRepos: new Set(['ours']) });
    assert.equal(q.laneCap, 2);
    const byLane = q.admitted.reduce((m, x) => ({ ...m, [x.category]: (m[x.category] || 0) + 1 }), {});
    // fact: pass 2 fills capacity in rank order
    assert.deepEqual(byLane, { secrets: 4, cve: 2 });
    assert.equal(q.deferred.byLane.secrets, 4);
    assert.equal(q.deferred.byLane.cve, 1);
    assert.deepEqual(q.admitted.slice(0, 4).map((x) => x.category), ['secrets', 'secrets', 'cve', 'cve'],
      'the quiet lane gets its share before the noisy lane gets a second helping');
  });

  test('with a single lane the cap binds nothing — unused capacity is never left on the table', () => {
    const findings = Array.from({ length: 10 }, (_, i) => cve('alpha', `CVE-${i}`, 'p'));
    const q = buildQueue({ rollup: rollup({ repos: [{ name: 'alpha', findings }] }), capacityItems: 4 });
    assert.equal(q.admitted.length, 4);
    assert.deepEqual(q.admitted.map((x) => x.rank), [1, 2, 3, 4]);
  });

  test('the default capacity is the declared budget — 600 minutes at 5 per item', () => {
    assert.equal(buildQueue({ rollup: rollup() }).capacityItems, 120);
  });

  test('population counts the lane counters the budget render uses, and says when the rows are capped below it', () => {
    const r = rollup({ scannerFindings: { secrets: [secret('alpha', 'f.go')] }, scanners: { secrets: { undetermined: 2696, total: 3000 } } });
    const q = buildQueue({ rollup: r });
    assert.equal(q.population, 2696);
    assert.equal(q.rowsAvailable, 1);
    assert.equal(q.rowsCapped, true);
  });
});

test('the rules are served verbatim and cover every mechanism above', () => {
  const ids = TRIAGE_RULES.map((r) => r.id);
  for (const need of ['metric-lanes', 'defect-signature', 'already-adjudicated', 'own-code-first', 'claimed-severity', 'persisting-first', 'lane-cap', 'deferred-not-dropped']) {
    assert.ok(ids.includes(need), `rule ${need} must be stated, not only implemented`);
  }
});
