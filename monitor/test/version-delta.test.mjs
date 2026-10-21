// version-delta.test.mjs — lane C. The anomaly is CONVERGENCE: a package version whose PUBLISHED
// artifact changed behaviour class with no matching change in the declared source (the xz / event-
// stream shape). These assert the four load-bearing properties: no baseline is unknown never
// "changed"; a convergence lands a RANK in the nondeterministic store (never crit/high/med/low); the
// prevalence guard SAMPLES a flood rather than disabling; and pairing is registry-adjacent so a
// windowed change is attributed to the window, never mis-pinned to an innocent single step.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from '../nondeterministic-store.mjs';
import { versionDelta, classifyPair, adjacencyOf, bornBadSignals } from '../version-delta.mjs';

// Each test gets its own store dir and its own env sandbox. Env is read at CALL time, so setting it
// here (not at import) is what the module contract requires.
function withEnv(over, fn) {
  const keys = ['CW_NONDET_STORE', 'CW_VERSION_DELTA', 'CW_VERSION_DELTA_PREVALENCE', 'CW_VERSION_DELTA_CAP', 'CW_NONDET_HOT', 'CW_NOW'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const dir = mkdtempSync(join(tmpdir(), 'cw-vd-'));
  process.env.CW_NONDET_STORE = dir;
  for (const [k, v] of Object.entries(over || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(dir); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const obs = (o) => ({ scripts: [], capabilities: [], minified: 0, maintainers: ['a'], ...o });
const snap = (packages, order) => ({ packages, order });

// ── 1. NO BASELINE ⇒ unknown, never "changed" ───────────────────────────────────────────────────
describe('no baseline', () => {
  test("a first-seen package is unknown('no-reference'), NEVER an anomaly — else day one floods the tree", () => withEnv({ CW_VERSION_DELTA_PREVALENCE: '2' }, () => {
    // 'no-baseline' is spelled `no-reference` in unknown.mjs's closed set (its text: "compared against
    // nothing — no baseline …"); coining a synonym would fragment that vocabulary.
    const prev = snap({});
    const curr = snap({ 'left-pad': obs({ version: '1.3.0' }) });
    const r = versionDelta(prev, curr);
    assert.equal(r.anomalies.length, 0, 'first sight is not a change');
    assert.equal(r.recorded.length, 0, 'nothing recorded for a package with no baseline');
    assert.equal(r.unknowns.length, 1);
    assert.equal(r.unknowns[0].unknown, true);
    assert.equal(r.unknowns[0].unknownReason, 'no-reference');
  }));

  test('a first-seen package with concerning signals is born-bad → undetermined, still not an anomaly', () => withEnv({ CW_VERSION_DELTA_PREVALENCE: '2' }, () => {
    const curr = snap({ evil: obs({ version: '1.0.0', scripts: ['postinstall'], capabilities: ['net'] }) });
    const r = versionDelta(snap({}), curr);
    assert.equal(r.anomalies.length, 0, 'born-bad is not a version-delta anomaly — there is no prior version');
    assert.equal(r.recorded.length, 0);
    assert.equal(r.undetermined.length, 1);
    assert.deepEqual(r.undetermined[0].bornBad, ['install-script', 'capability']);
    assert.deepEqual(bornBadSignals(curr.packages.evil), ['install-script', 'capability']);
  }));
});

// ── 2. CONVERGENCE ⇒ a RANK in the nondeterministic store ────────────────────────────────────────
describe('a behaviour-class change with no source diff is a ranked anomaly', () => {
  test('artifact gains a postinstall the declared source does not have → recorded to the store', () => withEnv({ CW_VERSION_DELTA_PREVALENCE: '2', CW_NOW: '2026-08-27T00:00:00.000Z' }, () => {
    const order = { pkg: ['1.1.0', '1.2.0'] };
    const prev = snap({ pkg: obs({ version: '1.1.0' }) }, order);
    // source present (the declared repo at 1.2.0) and it has NO postinstall → artifact-only = the xz shape.
    const curr = snap({ pkg: obs({ version: '1.2.0', scripts: ['postinstall'], source: { scripts: [], capabilities: [] } }) }, order);

    const r = versionDelta(prev, curr);
    assert.equal(r.prevalence.flooded, false, 'threshold raised so this exercises the NORMAL path');
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].verdict, 'anomaly');
    assert.equal(r.anomalies[0].corroboration, 'none');
    assert.ok(r.anomalies[0].score > 0 && r.anomalies[0].score <= 1, 'a rank in (0,1], never a severity');

    // the RANK actually landed in the store, under subject '<pkg>@<ver>' / dimension 'supply-anomaly'.
    const rows = store.read('pkg@1.2.0', 'supply-anomaly');
    assert.equal(rows.length, 1, 'the anomaly was recorded');
    assert.equal(rows[0].score, r.anomalies[0].score);
    assert.equal(rows[0].dimension, 'supply-anomaly');
    assert.equal(rows[0].ts, '2026-08-27T00:00:00.000Z', 'timestamp honours CW_NOW (determinism)');
    assert.deepEqual(rows[0].detail.classes, ['install-script']);
  }));

  test('the SAME change reflected in the source is explained, not an anomaly — and records nothing', () => withEnv({ CW_VERSION_DELTA_PREVALENCE: '2' }, () => {
    const order = { pkg: ['1.1.0', '1.2.0'] };
    const prev = snap({ pkg: obs({ version: '1.1.0' }) }, order);
    const curr = snap({ pkg: obs({ version: '1.2.0', scripts: ['postinstall'], source: { scripts: ['postinstall'], capabilities: [] } }) }, order);
    const r = versionDelta(prev, curr);
    assert.equal(r.anomalies.length, 0, 'the source explains it — ordinary development');
    assert.equal(r.pairs[0].verdict, 'explained');
    assert.equal(store.read('pkg@1.2.0', 'supply-anomaly').length, 0);
  }));

  test('explicit uncertainty: a code change whose source could not be resolved is unknown, never a published anomaly', () => withEnv({}, () => {
    const order = { pkg: ['1.1.0', '1.2.0'] };
    // no `source` view on curr → corroboration unresolved.
    const curr = snap({ pkg: obs({ version: '1.2.0', scripts: ['postinstall'] }) }, order);
    const r = versionDelta(snap({ pkg: obs({ version: '1.1.0' }) }, order), curr);
    assert.equal(r.anomalies.length, 0, 'unresolved source is never an anomaly (over-reporting is the costly direction)');
    assert.equal(r.recorded.length, 0);
    assert.equal(r.unknowns[0].unknownReason, 'not-adjudicated');
  }));

  test('a re-publish of the SAME version with changed bytes is a high-rank anomaly and needs no order', () => withEnv({ CW_VERSION_DELTA_PREVALENCE: '2' }, () => {
    const prev = snap({ pkg: obs({ version: '1.2.0' }) });
    const curr = snap({ pkg: obs({ version: '1.2.0', minified: 2, source: { minified: 0 } }) });
    const r = versionDelta(prev, curr);
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].relation, 'republish');
    assert.ok(r.anomalies[0].score > 0.45, 'the re-publish booster lifts the rank above the bare class weight');
  }));

  test('context-only movement (a maintainer change with no code delta) is undetermined, not recorded', () => withEnv({ CW_VERSION_DELTA_PREVALENCE: '2' }, () => {
    const order = { pkg: ['1.1.0', '1.2.0'] };
    const prev = snap({ pkg: obs({ version: '1.1.0', maintainers: ['a'] }) }, order);
    const curr = snap({ pkg: obs({ version: '1.2.0', maintainers: ['b'] }) }, order);
    const r = versionDelta(prev, curr);
    assert.equal(r.anomalies.length, 0, 'ownership churn alone is not a convergence — else it floods the store');
    assert.equal(r.pairs[0].verdict, 'undetermined');
    assert.equal(store.read('pkg@1.2.0', 'supply-anomaly').length, 0);
  }));
});

// ── 3. PREVALENCE GUARD — sample the changed subset, loudly; NEVER disable ────────────────────────
describe('prevalence guard', () => {
  test('a flood is anomaly-biased sampled to the cap and shouted about — the lane stays ON', () => withEnv({ CW_VERSION_DELTA_CAP: '2' }, () => {
    // Five packages each gain an uncorroborated postinstall → rate 100% ≫ 1% threshold. This is the
    // near-neighbour flood an attacker uses to trip a kill-switch.
    const names = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const order = Object.fromEntries(names.map((n) => [n, ['1.1.0', '1.2.0']]));
    const prev = snap(Object.fromEntries(names.map((n) => [n, obs({ version: '1.1.0' })])), order);
    const curr = snap(Object.fromEntries(names.map((n) => [n, obs({ version: '1.2.0', scripts: ['postinstall'], source: { scripts: [], capabilities: [] } })])), order);

    const r = versionDelta(prev, curr);
    assert.equal(r.prevalence.flooded, true);
    assert.equal(r.prevalence.disabled, false, 'NEVER auto-disable — that is the attacker\'s goal');
    assert.equal(r.prevalence.mode, 'anomaly-biased-sample');
    assert.equal(r.anomalies.length, 5, 'every anomaly is still computed and returned for a reader');
    assert.equal(r.recorded.length, 2, 'only the cap is written to the store');
    assert.equal(r.prevalence.suppressedFromStore, 3);
    assert.ok(r.prevalence.grey && /flood/i.test(r.prevalence.grey), 'loud grey, not silence');

    // sampling is the CHANGED/anomalous subset by rank (deterministic tie-break), never uniform.
    assert.deepEqual(r.recorded.map((x) => x.subject), ['p1@1.2.0', 'p2@1.2.0']);
    let inStore = 0;
    for (const n of names) inStore += store.read(`${n}@1.2.0`, 'supply-anomaly').length;
    assert.equal(inStore, 2, 'exactly the sampled anomalies reached the store');
  }));

  test('below the threshold nothing is sampled away — a real lone anomaly among clean pairs is fully recorded', () => withEnv({}, () => {
    // one anomaly + 199 clean adjacent pairs = 0.5% < 1% → not flooded.
    const order = { a: ['1.1.0', '1.2.0'] };
    const cleanPrev = {}; const cleanCurr = {}; const orders = { ...order };
    for (let i = 0; i < 199; i += 1) { cleanPrev[`c${i}`] = obs({ version: '1.1.0' }); cleanCurr[`c${i}`] = obs({ version: '1.2.0' }); orders[`c${i}`] = ['1.1.0', '1.2.0']; }
    const prev = snap({ a: obs({ version: '1.1.0' }), ...cleanPrev }, orders);
    const curr = snap({ a: obs({ version: '1.2.0', scripts: ['postinstall'], source: { scripts: [], capabilities: [] } }), ...cleanCurr }, orders);
    const r = versionDelta(prev, curr);
    assert.equal(r.compared, 200);
    assert.equal(r.prevalence.flooded, false);
    assert.equal(r.recorded.length, 1);
  }));
});

// ── 4. REGISTRY-ADJACENT PAIRING — non-adjacent snapshots must not mis-attribute ──────────────────
describe('registry-adjacent pairing', () => {
  test('a change across a gap is attributed to the WINDOW, never pinned to a single innocent step', () => {
    const order = ['1.0.0', '1.1.0', '1.2.0'];
    // 1.0.0 (clean) → 1.2.0 (postinstall). 1.1.0 was never observed; the change may have entered THERE.
    const r = classifyPair(obs({ version: '1.0.0' }), obs({ version: '1.2.0', scripts: ['postinstall'], source: { scripts: [] } }), { order });
    assert.equal(r.verdict, 'anomaly');
    assert.equal(r.relation, 'window');
    assert.equal(r.window, 2, 'two publishes span the pair, so it is not a single step');
    assert.match(r.detail, /window/, 'the detail attributes it to the window, not to one publish');
  });

  test('an adjacent step (gap 1) IS pinned', () => {
    const order = ['1.0.0', '1.1.0', '1.2.0'];
    const r = classifyPair(obs({ version: '1.1.0' }), obs({ version: '1.2.0', scripts: ['postinstall'], source: { scripts: [] } }), { order });
    assert.equal(r.relation, 'adjacent');
    assert.equal(r.window, 1);
  });

  test('WITHOUT a publish order, two different versions are not-adjudicated — refuse rather than mis-attribute', () => withEnv({}, () => {
    const prev = snap({ pkg: obs({ version: '1.0.0' }) });
    const curr = snap({ pkg: obs({ version: '5.0.0', scripts: ['postinstall'], source: { scripts: [] } }) }); // no `order`
    const r = versionDelta(prev, curr);
    assert.equal(r.anomalies.length, 0, 'cannot claim 1.0.0→5.0.0 is a step, so cannot claim an anomaly');
    assert.equal(r.pairs[0].relation, 'unordered');
    assert.equal(r.pairs[0].unknownReason, 'not-adjudicated');
  }));

  test('a version that precedes the baseline in publish order is unexaminable, not a backwards anomaly', () => {
    const order = ['1.0.0', '1.1.0', '1.2.0'];
    const r = classifyPair(obs({ version: '1.2.0' }), obs({ version: '1.0.0', scripts: ['postinstall'], source: { scripts: [] } }), { order });
    assert.equal(r.verdict, 'unknown');
    assert.equal(r.unknownReason, 'unexaminable');
    assert.equal(adjacencyOf('1.2.0', '1.0.0', order).relation, 'regressed');
  });
});

// ── house invariants ─────────────────────────────────────────────────────────────────────────────
describe('house invariants', () => {
  test('explicit uncertainty: a class unobserved on BOTH sides never reads as clean', () => {
    // capabilities absent on prev → the capability class is unobserved; scripts present on both → the
    // script class is comparable. The pair is judged on the observed class only, never called clean by
    // the unobserved one.
    const order = ['1.1.0', '1.2.0'];
    const r = classifyPair({ version: '1.1.0', scripts: [] }, { version: '1.2.0', scripts: ['postinstall'], source: { scripts: [] } }, { order });
    assert.equal(r.verdict, 'anomaly');
    assert.equal(r.code.length, 1);
    assert.equal(r.code[0].class, 'install-script');

    // nothing observable on both sides at all → unknown, not clean.
    const r2 = classifyPair({ version: '1.1.0' }, { version: '1.2.0' }, { order });
    assert.equal(r2.verdict, 'unknown');
    assert.equal(r2.unknownReason, 'not-adjudicated');
  });

  test('CW_VERSION_DELTA=off disables the lane cleanly (and records nothing)', () => withEnv({ CW_VERSION_DELTA: 'off' }, () => {
    const order = { pkg: ['1.1.0', '1.2.0'] };
    const r = versionDelta(snap({ pkg: obs({ version: '1.1.0' }) }, order), snap({ pkg: obs({ version: '1.2.0', scripts: ['postinstall'], source: { scripts: [] } }) }, order));
    assert.equal(r.ran, false);
    assert.equal(r.enabled, false);
    assert.equal(r.anomalies.length, 0);
    assert.equal(r.recorded.length, 0);
  }));

  test('determinism: same inputs, byte-identical anomaly ranking and detail', () => withEnv({ CW_VERSION_DELTA_PREVALENCE: '2', CW_NOW: '2026-08-27T00:00:00.000Z' }, () => {
    const order = { pkg: ['1.1.0', '1.2.0'] };
    const mk = () => versionDelta(
      snap({ pkg: obs({ version: '1.1.0' }) }, order),
      snap({ pkg: obs({ version: '1.2.0', scripts: ['postinstall'], capabilities: ['net'], source: { scripts: [], capabilities: [] } }) }, order),
      { record: false },
    );
    assert.equal(JSON.stringify(mk().anomalies), JSON.stringify(mk().anomalies));
  }));
});
