// A scanner's own levels, reached proportionally from the fleet's 1-5 (monitor/perf-tuning.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladderRank, depthPlan, intensityPlan, lanePlan, loadProfiles } from '../perf-tuning.mjs';

const DOC = {
  costClasses: { light: { minDepth: 1 }, medium: { minDepth: 2 }, heavy: { minDepth: 3 }, 'very-heavy': { minDepth: 4 } },
  depthLevels: [1, 2, 3, 4, 5].map((level) => ({ level, label: `D${level}` })),
  scanners: {
    three: { cost: 'light', depthLadder: [{ label: 'light' }, { label: 'heavy' }, { label: 'exhaustive' }] },
    lateThree: { cost: 'heavy', depthLadder: ['a', 'b', 'c'] },
    binary: { cost: 'medium' },
    always: { cost: 'light' },
    runtime: { cost: 'light', runtime: true },
    threads: { cost: 'light', intensityLadder: ['1', '2', 'all'] },
  },
};

test('3 of 5 on a three-level scanner that runs from depth 1 is the middle level', () => {
  assert.equal(ladderRank(3, { from: 1, length: 3 }), 2);
  const p = depthPlan(DOC.scanners.three, DOC, 3);
  assert.deepEqual(p.level, { rank: 2, of: 3, label: 'heavy' });
  assert.equal(p.kind, 'graded');
});

test('the ends of the range are the ends of the ladder', () => {
  assert.equal(ladderRank(1, { from: 1, length: 3 }), 1);
  assert.equal(ladderRank(5, { from: 1, length: 3 }), 3);
  assert.equal(depthPlan(DOC.scanners.lateThree, DOC, 3).level.rank, 1, 'a scanner that starts at depth 3 runs its lightest level there');
  assert.equal(depthPlan(DOC.scanners.lateThree, DOC, 5).level.rank, 3);
});

test('depth 5 selects the top of every ladder, so the default changes no invocation', () => {
  for (const [id, s] of Object.entries(DOC.scanners)) {
    const p = depthPlan(s, DOC, 5);
    if (p.ladder) assert.equal(p.level.rank, p.ladder.length, id);
  }
});

test('a scanner with no levels is binary when depth can switch it off, n/a when it cannot', () => {
  assert.equal(depthPlan(DOC.scanners.binary, DOC, 3).kind, 'binary');
  assert.deepEqual(depthPlan(DOC.scanners.binary, DOC, 3).level, { rank: 1, of: 1, label: 'on' });
  assert.deepEqual(depthPlan(DOC.scanners.binary, DOC, 1).level, { rank: 0, of: 1, label: 'off' });
  assert.equal(depthPlan(DOC.scanners.always, DOC, 1).kind, 'n/a');
  assert.equal(depthPlan(DOC.scanners.always, DOC, 1).level, null);
  assert.equal(depthPlan(DOC.scanners.runtime, DOC, 4).kind, 'binary', 'a runtime lane runs at depth 5 only');
  assert.equal(depthPlan(DOC.scanners.runtime, DOC, 4).on, false);
});

test('an override forces the lane either way, and forced on below its range runs the lightest level', () => {
  assert.equal(depthPlan(DOC.scanners.lateThree, DOC, 1, 'on').level.rank, 1);
  assert.equal(depthPlan(DOC.scanners.three, DOC, 5, 'off').on, false);
  assert.equal(depthPlan(DOC.scanners.three, DOC, 5, 'off').level.label, 'off');
});

test('intensity has no off: a ladder or n/a, and the timeout factor applies either way', () => {
  assert.deepEqual(intensityPlan(DOC.scanners.threads, 3).level, { rank: 2, of: 3, label: '2' });
  assert.equal(intensityPlan(DOC.scanners.always, 1).kind, 'n/a');
  assert.equal(intensityPlan(DOC.scanners.always, 2).timeoutFactor, 1.5);
  assert.equal(intensityPlan(DOC.scanners.always, 3).timeoutFactor, 1);
});

test('lanePlan hands a graded lane its level and names why a held-back lane did not run', () => {
  const on = lanePlan('three', { depth: 3, intensity: 3, doc: DOC });
  assert.deepEqual(on.env, { CW_DEPTH_LEVEL: 'heavy', CW_DEPTH_RANK: '2' });
  const off = lanePlan('binary', { depth: 1, intensity: 3, doc: DOC });
  assert.equal(off.run, false);
  assert.equal(off.basis, 'depth');
  assert.match(off.reason, /NOT SCANNED/);
  assert.equal(lanePlan('binary', { depth: 5, intensity: 3, override: 'off', doc: DOC }).basis, 'override');
  assert.deepEqual(lanePlan('not-declared', { depth: 1, intensity: 3, doc: DOC }), { known: false, run: true, env: {}, depth: null, intensity: null });
});

test('every declared ladder in the shipped model has at least two levels and a label on each', () => {
  const doc = loadProfiles();
  for (const [id, s] of Object.entries(doc.scanners)) {
    for (const k of ['depthLadder', 'intensityLadder']) {
      if (s[k] === undefined) continue;
      assert.ok(Array.isArray(s[k]) && s[k].length >= 2, `${id}.${k} must list at least two levels`);
      for (const l of s[k]) assert.ok(typeof (l.label ?? l) === 'string' && (l.label ?? l).trim(), `${id}.${k} has an unlabelled level`);
    }
  }
});
