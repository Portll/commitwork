// node --test monitor/test/ — forensics.mjs: the orchestrator. The thing under test is the
// CONFIGURATION logic, not the lanes (each has its own file). The load-bearing assertion: a lane
// with no input reports `not-configured` and NEVER a zero, because "0 matches, forever, against no
// indicator set" is indistinguishable from a fleet that was really checked.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LANES, runForensics } from '../forensics.mjs';
import { isUnknown } from '../unknown.mjs';

// AWAITS the body before cleaning up. Written synchronously first, it removed the directory the
// instant fn() returned its promise, so every lane below saw its config file as absent and
// reported `unknown('absent')` — which is the correct behaviour for a missing file and a useless
// test. The tests failed loudly rather than passing on a technicality, which is the only reason
// this was a five-minute problem.
const withTmp = async (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-forensics-'));
  try { return await fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

/** Minimal stand-ins: the orchestration is the subject, so the lanes are trivial and fast. */
const stubDeps = (over = {}) => ({
  storeConsistency: { runConsistency: () => ({ complete: true, totals: { orphan: 0, widow: 0, mismatch: 0 }, pairsChecked: 4, pairsUnknown: 0, pairs: [] }) },
  observables: { collectFleet: () => ({ corpusSize: 2, rawObservables: 2, byType: { package: 2 }, hosts: [], voidsByKind: {}, coverage: { complete: true }, unreadable: [], corpus: [
    { type: 'package', value: 'left-pad', where: ['a/package.json'], occurrences: 1 },
    { type: 'package', value: 'reqeusts', where: ['a/package.json'], occurrences: 1 },
  ] }) },
  coincidence: {
    eventsFromIssueStore: () => ({ events: [], missing: [] }),
    eventsFromVerdictJournal: () => ({ events: [], missing: [] }),
    eventsFromGit: async () => ({ events: [], missing: [] }),
    eventsFromHistoryIndex: () => ({ events: [], missing: [] }),
    findCoincidences: () => ({ events: 0, kinds: [], pairsExamined: 0, pairsUnexaminable: 0, examinedAnything: false, leads: [] }),
  },
  hostBaseline: {
    readBaseline: () => ({ unknown: true, unknownReason: 'absent', unknownDetail: 'no baseline' }),
    diffAgainstBaseline: () => ({ usable: false }),
  },
  hostInventory: { inventory: () => ({ ok: true, entries: [], socketTable: { ok: true, bound: [] } }) },
  historyDirs: async () => [],
  repos: async () => [],
  ...over,
});

const clearEnv = () => {
  delete process.env.CW_INDICATOR_BUNDLE;
  delete process.env.CW_LEGIT_PACKAGES;
  delete process.env.CW_FORENSICS_SKIP;
};

describe('an unconfigured lane reports not-configured, NEVER zero', () => {
  test('indicators with no bundle produces no count at all', async () => {
    clearEnv();
    const r = await runForensics({ deps: stubDeps() });
    const ind = r.lanes.indicators;
    assert.equal(ind.configured, false);
    assert.equal(isUnknown(ind), true);
    assert.equal(ind.matchCount, undefined, '"0 matches" against no indicator set is the reassuring lie');
    assert.match(ind.unknownDetail, /CW_INDICATOR_BUNDLE/, 'and it says how to fix it');
    assert.match(ind.note, /not a zero/);
  });

  test('lookalike with no declared set says WHY deriving one would be wrong', async () => {
    clearEnv();
    const r = await runForensics({ deps: stubDeps() });
    const lk = r.lanes.lookalike;
    assert.equal(lk.configured, false);
    assert.equal(lk.findingCount, undefined);
    assert.match(lk.unknownDetail, /bootstrap whatever is already present into legitimacy/);
  });

  test('host-baseline before acceptance is no-reference, and says accepting is a human act', async () => {
    clearEnv();
    const r = await runForensics({ deps: stubDeps() });
    const hb = r.lanes['host-baseline'];
    assert.equal(hb.configured, false);
    assert.equal(hb.counts, undefined, 'a diff against no baseline must not report counts');
    assert.match(hb.unknownDetail, /human act/);
  });

  test('`complete` is false whenever ANY lane had no input', async () => {
    clearEnv();
    const r = await runForensics({ deps: stubDeps() });
    assert.equal(r.complete, false);
    assert.deepEqual(r.lanesUnconfigured.sort(), ['host-baseline', 'indicators', 'lookalike']);
    assert.equal(r.lanesRun, 3);
  });
});

describe('a configured lane actually runs', () => {
  test('a declared legitimate set turns lookalike on and it finds the planted squat', async () => withTmp(async (d) => {
    clearEnv();
    const legit = join(d, 'legit.json');
    writeFileSync(legit, JSON.stringify(['left-pad', 'requests']));
    process.env.CW_LEGIT_PACKAGES = legit;
    try {
      const r = await runForensics({ deps: stubDeps() });
      const lk = r.lanes.lookalike;
      assert.equal(lk.configured, true);
      assert.equal(lk.declaredSize, 2);
      assert.equal(lk.findingCount, 1, '`reqeusts` is one transposition from the declared `requests`');
      assert.equal(lk.findings[0].legitimate, 'requests');
    } finally { clearEnv(); }
  }));

  test('a declared bundle turns indicators on and the corpus is what it matches', async () => withTmp(async (d) => {
    clearEnv();
    const bundle = join(d, 'b.json');
    writeFileSync(bundle, JSON.stringify({
      type: 'bundle',
      objects: [{ type: 'indicator', id: 'indicator--1', pattern: "[software:name = 'left-pad']" }],
    }));
    process.env.CW_INDICATOR_BUNDLE = bundle;
    try {
      const r = await runForensics({ deps: stubDeps() });
      assert.equal(r.lanes.indicators.configured, true);
      assert.equal(r.lanes.indicators.matchCount, 1);
      assert.match(r.lanes.indicators.coverage, /all 1 indicator/);
    } finally { clearEnv(); }
  }));

  test('a bundle path that does not exist is `absent`, distinct from unconfigured', async () => {
    clearEnv();
    process.env.CW_INDICATOR_BUNDLE = join(tmpdir(), 'cw-forensics-no-such-bundle.json');
    try {
      const r = await runForensics({ deps: stubDeps() });
      const ind = r.lanes.indicators;
      assert.equal(ind.configured, true, 'somebody DID configure it — the file is what is missing');
      assert.equal(ind.unknownReason, 'absent');
      assert.equal(r.complete, false);
    } finally { clearEnv(); }
  });
});

describe('lane isolation', () => {
  test('a lane that throws is recorded as failed and the others still run', async () => {
    clearEnv();
    const deps = stubDeps({
      observables: { collectFleet: () => { throw new Error('boom'); } },
    });
    const r = await runForensics({ deps });
    assert.equal(r.lanes.observables.failed, true);
    assert.match(r.lanes.observables.error, /boom/);
    assert.equal(r.lanes['store-consistency'].configured, true, 'one lane failing must not take the pass down');
    assert.deepEqual(r.lanesFailed, ['observables']);
    assert.equal(r.complete, false);
  });

  test('a failed corpus makes the DOWNSTREAM lanes no-subject, not zero', async () => withTmp(async (d) => {
    clearEnv();
    const bundle = join(d, 'b.json');
    writeFileSync(bundle, JSON.stringify({ type: 'bundle', objects: [{ type: 'indicator', id: 'i--1', pattern: "[software:name = 'x']" }] }));
    process.env.CW_INDICATOR_BUNDLE = bundle;
    try {
      const r = await runForensics({ deps: stubDeps({ observables: { collectFleet: () => { throw new Error('boom'); } } }) });
      assert.equal(r.lanes.indicators.unknownReason, 'no-subject');
      assert.equal(r.lanes.indicators.matchCount, undefined);
    } finally { clearEnv(); }
  }));

  test('CW_FORENSICS_SKIP skips by name and records the skip', async () => {
    clearEnv();
    process.env.CW_FORENSICS_SKIP = 'observables,coincidence';
    try {
      const r = await runForensics({ deps: stubDeps() });
      assert.equal(r.lanes.observables.skipped, true);
      assert.equal(r.lanes.coincidence.skipped, true);
      assert.equal(r.lanes['store-consistency'].configured, true);
    } finally { clearEnv(); }
  });
});

describe('the roster is the runner', () => {
  test('every declared lane produces a result — a lane in LANES that nothing runs is a lie', async () => {
    clearEnv();
    const r = await runForensics({ deps: stubDeps() });
    for (const lane of LANES) {
      assert.ok(r.lanes[lane], `${lane} is declared in LANES and produced no entry`);
    }
    assert.equal(Object.keys(r.lanes).length, LANES.length, 'and nothing runs that is not declared');
  });

  test('the corpus is not published in the artifact — 25k rows would dwarf it', async () => {
    clearEnv();
    const r = await runForensics({ deps: stubDeps() });
    assert.equal(r.lanes.observables._corpus, undefined);
    assert.equal(r.lanes.observables.corpusSize, 2, 'the SIZE is published; the rows are not');
  });
});

describe('determinism', () => {
  test('CW_NOW pins the stamp', async () => {
    clearEnv();
    process.env.CW_NOW = '2026-08-26T00:00:00.000Z';
    try {
      const r = await runForensics({ deps: stubDeps() });
      assert.equal(r.generated, '2026-08-26T00:00:00.000Z');
    } finally { delete process.env.CW_NOW; }
  });
});
